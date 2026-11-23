/**
 * Vertexia Retail POS - Browser Compatibility Adapter
 * Adapts window.vertexia IPC interface to HTTP REST & WebSocket endpoints
 * when running in standard browser environments (e.g. Chrome, Edge, Safari, LAN clients).
 */

import type { VertexiaDesktopApi } from '../types/desktop-api';
import { apiClient, realtimeSyncClient, type RealtimeEventMessage } from './apiClient';
import { notifyRetailDataChanged } from './retail-events';

function downloadCsv(content: string, filename: string): void {
  if (typeof window === 'undefined') return;
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function createBrowserAdapter(): VertexiaDesktopApi {
  // Start realtime WebSocket sync
  realtimeSyncClient.connect();

  // Listen to server events and dispatch local React event triggers
  realtimeSyncClient.onEvent((event: RealtimeEventMessage) => {
    if (typeof window === 'undefined') return;
    switch (event.type) {
      case 'inventory:changed':
      case 'product:updated':
      case 'sale:completed':
      case 'sale:returned':
      case 'purchase:received':
      case 'transfer:dispatched':
      case 'transfer:received':
      case 'transfer:cancelled':
        notifyRetailDataChanged();
        break;
      case 'shift:opened':
      case 'shift:closed':
      case 'cash:updated':
        window.dispatchEvent(new Event('vertexia:cash-changed'));
        notifyRetailDataChanged();
        break;
      case 'branch:created':
      case 'branch:updated':
        window.dispatchEvent(new Event('vertexia:auth-refresh'));
        break;
    }
  });

  return {
    licensing: {
      status: async () => apiClient.get('/licensing/status'),
      activate: async (key: string) => apiClient.post('/licensing/activate', { key }),
      refresh: async () => apiClient.post('/licensing/refresh'),
    },
    cloudLicense: {
      status: async () => apiClient.get('/licensing/status'),
      register: async (reg: any) => apiClient.post('/licensing/activate', reg),
      activate: async (key: string, businessId?: string) => apiClient.post('/licensing/activate', { key, businessId }),
      refresh: async () => apiClient.post('/licensing/refresh'),
    },
    branches: {
      list: async () => apiClient.get('/branches/list'),
      create: async (request: any) => apiClient.post('/branches/create', request),
      update: async (request: any) => apiClient.put('/branches/update', request),
      setActive: async (request: any) => apiClient.post('/branches/set-active', request),
    },
    transfers: {
      list: async (query: any) => apiClient.post('/transfers/list', query),
      detail: async (branchId: string, id: string) => apiClient.get(`/transfers/detail?branchId=${encodeURIComponent(branchId)}&id=${encodeURIComponent(id)}`),
      dispatch: async (request: any) => apiClient.post('/transfers/dispatch', request),
      receive: async (request: any) => apiClient.post('/transfers/receive', request),
      cancel: async (request: any) => apiClient.post('/transfers/cancel', request),
    },
    reports: {
      snapshot: async (query: any) => apiClient.post('/reports/snapshot', query),
      valuation: async (branchId: string) => apiClient.get(`/reports/valuation?branchId=${encodeURIComponent(branchId)}`),
      exportCsv: async (query: any) => {
        const res = await apiClient.post<{ canceled: boolean; csv: string; filename: string }>('/reports/export-csv', query);
        if (res.csv) {
          downloadCsv(res.csv, res.filename || 'reports.csv');
          return { canceled: false, path: 'Downloads' };
        }
        return { canceled: true };
      },
    },
    customers: {
      list: async (query: any) => apiClient.post('/customers/list', query),
      detail: async (branchId: string, customerId: string, page?: number) =>
        apiClient.get(`/customers/detail?branchId=${encodeURIComponent(branchId)}&customerId=${encodeURIComponent(customerId)}&page=${page || 1}`),
      receipt: async (branchId: string, receiptId: string) =>
        apiClient.get(`/customers/receipt?branchId=${encodeURIComponent(branchId)}&receiptId=${encodeURIComponent(receiptId)}`),
      create: async (request: any) => apiClient.post('/customers/create', request),
      update: async (request: any) => apiClient.put('/customers/update', request),
      collect: async (request: any) => apiClient.post('/customers/collect', request),
    },
    expenses: {
      list: async (query: any) => apiClient.post('/expenses/list', query),
      post: async (request: any) => apiClient.post('/expenses/post', request),
      reverse: async (request: any) => apiClient.post('/expenses/reverse', request),
    },
    cash: {
      getSnapshot: async (branchId: string) => apiClient.get(`/cash/snapshot?branchId=${encodeURIComponent(branchId)}`),
      closeShift: async (request: any) => apiClient.post('/cash/close-shift', request),
      move: async (request: any) => apiClient.post('/cash/move', request),
    },
    backup: {
      getStatus: async () => apiClient.get('/backup/status'),
      create: async () => apiClient.post('/backup/create'),
      export: async () => ({ canceled: true }),
      previewRestore: async () => ({ canceled: true }),
      cancelRestore: async () => {},
      restore: async () => ({ safetyBackupPath: '' }),
    },
    auth: {
      status: async () => apiClient.get('/auth/status'),
      setup: async (input: any) => {
        const res = await apiClient.post<{ ok: boolean; session: any }>('/auth/setup', input);
        return res.session;
      },
      login: async (username: string, password: string) => {
        const res = await apiClient.post<{ ok: boolean; session: any }>('/auth/login', { username, password });
        return res.session;
      },
      logout: async () => {
        await apiClient.post('/auth/logout');
      },
      selectBranch: async (branchId: string) => {
        const res = await apiClient.post<{ ok: boolean; session: any }>('/auth/select-branch', { branchId });
        return res.session;
      },
      listUsers: async () => apiClient.get('/auth/users'),
      createUser: async (input: any) => apiClient.post('/auth/users', input),
      updateUser: async (input: any) => apiClient.put('/auth/users', input),
      resetPassword: async (userId: string, password: string) => {
        await apiClient.post('/auth/users/reset-password', { userId, password });
      },
      changePassword: async (currentPassword: string, newPassword: string) => {
        const res = await apiClient.post<{ ok: boolean; session: any }>('/auth/change-password', { currentPassword, newPassword });
        return res.session;
      },
      onSessionExpired: (callback: () => void) => {
        const listener = () => callback();
        window.addEventListener('vertexia:session-expired', listener);
        return () => window.removeEventListener('vertexia:session-expired', listener);
      },
    },
    retail: {
      getSnapshot: async (branchId: string) => apiClient.get(`/retail/snapshot?branchId=${encodeURIComponent(branchId)}`),
      adjustStock: async (request: any) => apiClient.post('/retail/adjust-stock', request),
      receivePurchase: async (request: any) => apiClient.post('/retail/receive-purchase', request),
      paySupplier: async (request: any) => apiClient.post('/retail/pay-supplier', request),
    },
    dashboard: {
      getSnapshot: async (query: any) => apiClient.post('/dashboard/snapshot', query),
      search: async (term: string, branchId: string) =>
        apiClient.get(`/dashboard/search?term=${encodeURIComponent(term)}&branchId=${encodeURIComponent(branchId)}`),
    },
    pos: {
      getBootstrap: async (branchId: string) => apiClient.get(`/pos/bootstrap?branchId=${encodeURIComponent(branchId)}`),
      completeSale: async (request: any) => apiClient.post('/pos/sale', request),
      holdSale: async (branchId: string, customerId: string, lines: any) =>
        apiClient.post('/pos/hold', { branchId, customerId, lines }),
      resumeHeldSale: async (id: string) => apiClient.post('/pos/resume-held', { id }),
      deleteHeldSale: async (id: string) => apiClient.delete(`/pos/held/${encodeURIComponent(id)}`),
      openShift: async (branchId: string, openingCashPaisa: number, operationId?: string) => {
        const res = await apiClient.post<{ shiftId: string }>('/pos/open-shift', { branchId, openingCashPaisa, operationId });
        return res.shiftId;
      },
      createProduct: async (branchId: string, input: any) => apiClient.post('/pos/product', { branchId, input }),
      createCustomer: async (input: any) => apiClient.post('/pos/customer', input),
    },
    products: {
      list: async (query: any) => apiClient.post('/products/list', query),
      save: async (branchId: string, input: any) => apiClient.post('/products/save', { branchId, input }),
      toggleStatus: async (branchId: string, id: string) => apiClient.post('/products/toggle-status', { branchId, id }),
      importCsv: async (branchId: string, csv: string) => apiClient.post('/products/import-csv', { branchId, csv }),
      exportCsv: async (branchId: string) => {
        const res = await apiClient.post<{ canceled: boolean; csv: string; filename: string }>('/products/export-csv', { branchId });
        if (res.csv) {
          downloadCsv(res.csv, res.filename || `products-${branchId}.csv`);
          return { canceled: false, path: 'Downloads' };
        }
        return { canceled: true };
      },
    },
    sales: {
      getSnapshot: async (query: any) => apiClient.post('/sales/snapshot', query),
      getDetail: async (branchId: string, saleId: string) =>
        apiClient.get(`/sales/detail?branchId=${encodeURIComponent(branchId)}&saleId=${encodeURIComponent(saleId)}`),
      createReturn: async (request: any) => apiClient.post('/sales/return', request),
      exportCsv: async (query: any) => {
        const res = await apiClient.post<{ canceled: boolean; csv: string; filename: string }>('/sales/export-csv', query);
        if (res.csv) {
          downloadCsv(res.csv, res.filename || `sales-${query.branchId}.csv`);
          return { canceled: false, path: 'Downloads' };
        }
        return { canceled: true };
      },
    },
    system: {
      getDatabasePath: async () => {
        const res = await apiClient.get<{ path: string }>('/system/database-path');
        return res.path;
      },
    },
    zoom: {
      setZoomFactor: (factor: number) => {
        if (typeof document !== 'undefined') {
          (document.body.style as any).zoom = factor;
        }
      },
      getZoomFactor: () => {
        if (typeof document !== 'undefined') {
          return Number((document.body.style as any).zoom) || 1.0;
        }
        return 1.0;
      },
      onZoomFactorChange: () => () => {},
    },
  };
}

/**
 * Initializes the browser adapter if not already running in Electron desktop.
 * Electron preload script defines window.vertexia before page scripts load.
 */
export function initBrowserEnvironment(): void {
  if (typeof window === 'undefined') return;

  if (!window.vertexia) {
    window.vertexia = createBrowserAdapter();
  }
}
