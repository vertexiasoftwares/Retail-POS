import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { createHash } from 'node:crypto';
import type { AuthRepository } from '../electron/database/auth.mjs';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export type RealtimeEvent = {
  type: string;
  branchId?: string;
  businessId?: string;
  payload?: Record<string, unknown>;
  timestamp?: string;
};

interface ConnectedClient {
  socket: Socket;
  token: string;
  counterId: string;
  userId: string;
  branchId: string;
  businessId: string;
  role: string;
  branches: string[];
  lastSeenAt: number;
}

export class RealtimeSyncServer {
  private clients = new Set<ConnectedClient>();
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(private readonly auth: AuthRepository) {
    // Periodic WS Ping heartbeat to clean up silently dropped Wi-Fi / LAN counters
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      for (const client of this.clients) {
        if (now - client.lastSeenAt > 75_000 || !this.auth.authenticateToken(client.token, false)) {
          this.clients.delete(client);
          try {
            client.socket.destroy();
          } catch {}
          continue;
        }
        try {
          client.socket.write(Buffer.from([0x89, 0x00])); // WebSocket PING frame
        } catch {
          this.clients.delete(client);
        }
      }
    }, 25_000);
    this.heartbeatTimer.unref?.();
  }

  public handleUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): void {
    const url = req.url || '';
    if (!url.startsWith('/api/events')) {
      socket.destroy();
      return;
    }

    // Extract session token from Cookie header
    const cookieHeader = req.headers.cookie;
    let token: string | null = null;
    if (cookieHeader) {
      const parts = cookieHeader.split(';');
      for (const part of parts) {
        const [k, v] = part.trim().split('=');
        if (k === 'vertexia_session' && v) {
          token = decodeURIComponent(v);
          break;
        }
      }
    }

    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    const session = this.auth.authenticateToken(token, false);
    if (!session) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    // Accept WebSocket handshake (RFC 6455)
    const acceptKey = createHash('sha1').update(key + GUID).digest('base64');
    const responseHeaders = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey}`,
      '\r\n',
    ];
    socket.write(responseHeaders.join('\r\n'));

    const client: ConnectedClient = {
      socket,
      token,
      counterId: this.auth.getTokenCounterId(token),
      userId: session.userId,
      branchId: session.branchId,
      businessId: session.businessId,
      role: session.role,
      branches: session.branches.map(b => b.id),
      lastSeenAt: Date.now(),
    };

    this.clients.add(client);

    // Initial connected message
    this.sendToClient(client, {
      type: 'connected',
      branchId: session.branchId,
      businessId: session.businessId,
      payload: { userId: session.userId, branchId: session.branchId },
      timestamp: new Date().toISOString(),
    });

    socket.on('data', (buffer: Buffer) => {
      this.handleSocketData(client, buffer);
    });

    socket.on('close', () => {
      this.clients.delete(client);
    });

    socket.on('error', () => {
      this.clients.delete(client);
      socket.destroy();
    });
  }

  private handleSocketData(client: ConnectedClient, buffer: Buffer): void {
    client.lastSeenAt = Date.now();
    if (buffer.length < 2) return;
    const firstByte = buffer[0];
    const opcode = firstByte & 0x0f;

    // Pong frame (0x0A)
    if (opcode === 0x0a) {
      return;
    }

    // Ping frame (0x09) -> Respond with Pong (0x0A)
    if (opcode === 0x09) {
      const pongFrame = Buffer.from([0x8a, 0x00]);
      try { client.socket.write(pongFrame); } catch {}
      return;
    }

    // Close frame (0x08)
    if (opcode === 0x08) {
      const closeFrame = Buffer.from([0x88, 0x00]);
      try { client.socket.write(closeFrame); } catch {}
      this.clients.delete(client);
      client.socket.destroy();
      return;
    }
  }

  public disconnectCounter(counterId: string): void {
    for (const client of this.clients) {
      if (client.counterId === counterId) {
        this.clients.delete(client);
        try {
          client.socket.write(Buffer.from([0x88, 0x00]));
          client.socket.destroy();
        } catch {}
      }
    }
  }

  public broadcast(event: RealtimeEvent): void {
    const payloadJson = JSON.stringify({
      ...event,
      timestamp: event.timestamp || new Date().toISOString(),
    });
    const payloadBuf = Buffer.from(payloadJson, 'utf8');

    let frame: Buffer;
    if (payloadBuf.length < 126) {
      frame = Buffer.concat([Buffer.from([0x81, payloadBuf.length]), payloadBuf]);
    } else if (payloadBuf.length < 65536) {
      frame = Buffer.concat([
        Buffer.from([0x81, 126, (payloadBuf.length >> 8) & 0xff, payloadBuf.length & 0xff]),
        payloadBuf,
      ]);
    } else {
      const lenBuf = Buffer.alloc(8);
      lenBuf.writeBigUInt64BE(BigInt(payloadBuf.length), 0);
      frame = Buffer.concat([Buffer.from([0x81, 127]), lenBuf, payloadBuf]);
    }

    for (const client of this.clients) {
      // Validate session is still valid
      const session = this.auth.authenticateToken(client.token, false);
      if (!session) {
        this.clients.delete(client);
        try {
          const closeFrame = Buffer.from([0x88, 0x00]);
          client.socket.write(closeFrame);
          client.socket.destroy();
        } catch {}
        continue;
      }

      // Update client's active branch in case they switched
      client.branchId = session.branchId;

      // Filter by businessId
      if (event.businessId && event.businessId !== client.businessId) {
        continue;
      }

      // Filter by branchId:
      // If event is scoped to a specific branch, only cashiers/staff at that branch receive it,
      // unless user is Owner/Manager with access to that branch.
      if (event.branchId && event.branchId !== client.branchId) {
        const canViewOtherBranch = (client.role === 'Owner' || client.role === 'Manager') && client.branches.includes(event.branchId);
        if (!canViewOtherBranch) {
          continue;
        }
      }

      try {
        client.socket.write(frame);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  private sendToClient(client: ConnectedClient, event: RealtimeEvent): void {
    const payloadJson = JSON.stringify(event);
    const payloadBuf = Buffer.from(payloadJson, 'utf8');
    const header = Buffer.from([0x81, payloadBuf.length < 126 ? payloadBuf.length : 126]);
    const frame = payloadBuf.length < 126
      ? Buffer.concat([header, payloadBuf])
      : Buffer.concat([
          Buffer.from([0x81, 126, (payloadBuf.length >> 8) & 0xff, payloadBuf.length & 0xff]),
          payloadBuf,
        ]);
    try {
      client.socket.write(frame);
    } catch {
      this.clients.delete(client);
    }
  }

  public getConnectedClientCount(): number {
    return this.clients.size;
  }

  public closeAll(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const client of this.clients) {
      try {
        const closeFrame = Buffer.from([0x88, 0x00]);
        client.socket.write(closeFrame);
        client.socket.destroy();
      } catch {}
    }
    this.clients.clear();
  }
}
