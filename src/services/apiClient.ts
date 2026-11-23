/**
 * Vertexia Retail POS - Typed Browser HTTP & Realtime WebSocket Client
 * Communicates with the Fastify central server over same-origin HTTP and WebSockets.
 */

export interface ApiErrorResponse {
  error: string;
  message: string;
  statusCode: number;
}

export class ApiClientError extends Error {
  public readonly statusCode: number;
  public readonly errorType: string;

  constructor(message: string, statusCode = 500, errorType = 'ServerError') {
    super(message);
    this.name = 'ApiClientError';
    this.statusCode = statusCode;
    this.errorType = errorType;
  }
}

export interface RequestOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export interface RealtimeEventMessage {
  type: string;
  branchId?: string;
  businessId?: string;
  payload?: Record<string, unknown>;
  timestamp?: string;
}

class ApiClient {
  private inFlightOperations = new Set<string>();

  /**
   * Resolves relative /api URL ensuring no hardcoded hosts
   */
  private resolveUrl(path: string): string {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return cleanPath.startsWith('/api') ? cleanPath : `/api${cleanPath}`;
  }

  /**
   * Executes typed HTTP requests with same-origin credentials, structured error handling,
   * timeout cancellation, and idempotency protection.
   */
  public async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    path: string,
    body?: unknown,
    options: RequestOptions = {}
  ): Promise<T> {
    const url = this.resolveUrl(path);
    const timeoutMs = options.timeoutMs ?? 30000;

    // Duplicate submission prevention for non-idempotent operations
    const operationKey = method !== 'GET' && body && typeof body === 'object' && 'operationId' in (body as any)
      ? `${method}:${url}:${(body as any).operationId}`
      : null;

    if (operationKey) {
      if (this.inFlightOperations.has(operationKey)) {
        throw new ApiClientError('An identical transaction is already in progress. Please wait.', 409, 'ConflictError');
      }
      this.inFlightOperations.add(operationKey);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const mergedSignal = options.signal
      ? (anySignal([controller.signal, options.signal]))
      : controller.signal;

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...options.headers,
    };

    let bodyData: BodyInit | undefined;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      bodyData = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: bodyData,
        credentials: 'same-origin', // Sends HttpOnly session cookies automatically
        signal: mergedSignal,
      });

      clearTimeout(timeoutId);

      const contentType = response.headers.get('content-type') || '';
      const isJson = contentType.includes('application/json');

      if (!response.ok) {
        let errMessage = `HTTP request failed with status ${response.status}`;
        let errType = 'RequestError';

        if (isJson) {
          try {
            const errData = (await response.json()) as ApiErrorResponse;
            if (errData?.message) errMessage = errData.message;
            if (errData?.error) errType = errData.error;
          } catch {}
        } else {
          try {
            const text = await response.text();
            if (text) errMessage = text.slice(0, 300);
          } catch {}
        }

        // Notify session expiry if unauthorized
        if (response.status === 401) {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new Event('vertexia:session-expired'));
          }
        }

        throw new ApiClientError(errMessage, response.status, errType);
      }

      if (response.status === 204) {
        return undefined as unknown as T;
      }

      if (isJson) {
        return (await response.json()) as T;
      }

      return (await response.text()) as unknown as T;
    } catch (err: any) {
      clearTimeout(timeoutId);

      if (err instanceof ApiClientError) {
        throw err;
      }

      if (err.name === 'AbortError') {
        throw new ApiClientError('Request timed out or was cancelled.', 408, 'TimeoutError');
      }

      // Network or connection failure
      const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
      const networkMessage = isOffline
        ? 'No network connection detected. Ensure you are connected to the store network.'
        : 'Cannot reach the central Vertexia POS server. Verify the server is running.';

      throw new ApiClientError(networkMessage, 503, 'NetworkError');
    } finally {
      if (operationKey) {
        this.inFlightOperations.delete(operationKey);
      }
    }
  }

  public get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('GET', path, undefined, options);
  }

  public post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('POST', path, body, options);
  }

  public put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('PUT', path, body, options);
  }

  public delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('DELETE', path, undefined, options);
  }
}

/**
 * Polyfill helper for combining AbortSignals across browsers
 */
function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      return signal;
    }
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller.signal;
}

export const apiClient = new ApiClient();

/**
 * Real-time WebSocket connection manager for LAN counter sync
 */
export class RealtimeSyncClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: any = null;
  private pingTimer: any = null;
  private shouldReconnect = true;
  private listeners = new Set<(event: RealtimeEventMessage) => void>();

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.connect());
    }
  }

  public connect(): void {
    if (typeof window === 'undefined') return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.shouldReconnect = true;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/events`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        // Start ping heartbeat every 25 seconds
        clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            try { this.ws.send(JSON.stringify({ type: 'ping' })); } catch {}
          }
        }, 25000);
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as RealtimeEventMessage;
          for (const listener of this.listeners) {
            try { listener(data); } catch {}
          }
        } catch {}
      };

      this.ws.onclose = () => {
        clearInterval(this.pingTimer);
        if (this.shouldReconnect) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = setTimeout(() => this.connect(), 3000);
        }
      };

      this.ws.onerror = () => {
        try { this.ws?.close(); } catch {}
      };
    } catch {
      if (this.shouldReconnect) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => this.connect(), 5000);
      }
    }
  }

  public onEvent(callback: (event: RealtimeEventMessage) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  public disconnect(): void {
    this.shouldReconnect = false;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.pingTimer);
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
  }
}

export const realtimeSyncClient = new RealtimeSyncClient();
