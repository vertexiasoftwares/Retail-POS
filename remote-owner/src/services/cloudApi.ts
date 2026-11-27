export interface CloudOwnerSession {
  userId: string
  shopUuid: string
  branchId: string
  shopName?: string
  username: string
  name: string
  role: string
  permissions: string[]
  mustChangePassword?: boolean
  credentialVersion?: number
}

export interface DashboardPayload {
  shopUuid: string
  businessName: string
  branchName: string
  city: string
  mainPcLastSyncAt: string | null
  todayBusinessDate: string
  summary: {
    grossSalesPaisa: number
    returnsPaisa: number
    netSalesPaisa: number
    grossProfitPaisa: number
    invoiceCount: number
    lowStockCount: number
    todaySalesPaisa: number
    todaySalesCount: number
    todayProfitPaisa: number
    totalExpensesPaisa: number
    todayExpensesPaisa: number
    openShiftsCount: number
    remoteOwnerEventsCount: number
  }
  counters: Array<{
    counterId: string
    counterNumber: number
    name: string
    status: string
    lastSeenAt: string | null
    invoiceCount: number
    salesPaisa: number
  }>
  recentSales: Array<{
    id: string
    invoiceNumber: string
    counterId: string
    customerName: string
    totalPaisa: number
    status: string
    completedAt: string
  }>
  recentExpenses: Array<{
    id: string
    expenseNumber: string
    businessDate: string
    category: string
    description: string
    method: string
    amountPaisa: number
    occurredAt: string
  }>
  lowStockProducts: Array<{
    id: string
    sku: string
    name: string
    unit: string
    quantityMilli: number
    minimumStockMilli: number
  }>
}

export interface SaleRecord {
  id: string
  invoice_number: string
  business_date: string
  counter_id: string
  counter_name?: string | null
  cashier_id: string
  cashier_name?: string | null
  customer_id: string | null
  customer_name?: string | null
  status: string
  payment_method: string
  subtotal_paisa: number
  discount_paisa: number
  tax_paisa: number
  total_paisa: number
  cost_paisa: number
  paid_paisa: number
  completed_at: string
  note?: string | null
}

export interface SaleDetailResponse {
  sale: SaleRecord & { customer_phone?: string | null }
  items: Array<{
    id: string
    product_id: string
    product_name_snapshot: string
    sku_snapshot: string
    unit_snapshot: string
    quantity_milli: number
    unit_price_paisa: number
    cost_price_paisa: number
    tax_rate_bps: number
    line_total_paisa: number
  }>
  payments: Array<{
    id: string
    method: string
    amount_paisa: number
    reference: string
    occurred_at: string
  }>
  returns: Array<{
    id: string
    return_number: string
    refund_method: string
    total_paisa: number
    note: string
    occurred_at: string
  }>
}

export interface ProductRecord {
  id: string
  sku: string
  barcode: string | null
  name: string
  category: string
  unit: string
  cost_price_paisa: number
  sale_price_paisa: number
  low_stock_milli: number
  quantity_milli: number
  is_active: boolean
  sync_version: number
  updated_at: string
}

export interface CustomerRecord {
  id: string
  name: string
  phone: string
  is_active: boolean
  balance_paisa: number
  updated_at: string
}

export interface SupplierRecord {
  id: string
  name: string
  phone: string
  is_active: boolean
  balance_paisa: number
  updated_at: string
}

export interface PurchaseRecord {
  id: string
  supplier_id: string
  supplier_name_snapshot: string
  purchase_number: string
  business_date: string
  total_paisa: number
  paid_paisa: number
  note: string
  created_by_name?: string | null
  occurred_at: string
}

export interface ExpenseRecord {
  id: string
  expense_number: string
  business_date: string
  category: string
  description: string
  method: string
  amount_paisa: number
  note: string
  occurred_at: string
}

export interface CashShiftRecord {
  id: string
  counter_id: string
  counter_name?: string | null
  cashier_id: string
  cashier_name?: string | null
  status: string
  opening_cash_paisa: number
  expected_cash_paisa: number | null
  counted_cash_paisa: number | null
  variance_paisa: number | null
  note: string | null
  opened_at: string
  closed_at: string | null
  movements: Array<{
    id: string
    movement_type: string
    amount_paisa: number
    reason: string
    created_by_name?: string | null
    occurred_at: string
  }>
}

export interface StaffRecord {
  id: string
  name: string
  username: string | null
  role: string
  isActive: boolean
  mustChangePassword: boolean
  credentialVersion: number | null
  syncVersion: number
  updatedAt: string
}

export interface CounterRecord {
  id: string
  counter_number: number
  name: string
  status: string
  is_primary: boolean
  app_version: string | null
  last_ip: string | null
  last_seen_at: string | null
  revoked_at: string | null
}

export interface ReportsPayload {
  dateFrom: string
  dateTo: string
  salesTrend: Array<{
    date: string
    invoices: number
    salesPaisa: number
    grossProfitPaisa: number
  }>
  byCounter: Array<{
    counterId: string
    counterNumber: number
    name: string
    invoiceCount: number
    salesPaisa: number
  }>
  expensesByCategory: Array<{
    category: string
    netPaisa: number
  }>
}

export interface SyncStatusPayload {
  shopUuid: string
  installations: Array<{
    nodeId: string
    nodeType: string
    deviceName: string
    appVersion: string
    status: string
    lastSyncAt: string | null
    registeredAt: string
  }>
  processedEventsCount: number
  lastProcessedAt: string | null
  cloudOwnerEventsCount: number
  latestCloudSeq: number
  conflictsCount: number
}

export interface ConflictRecord {
  id: string
  entity_type: string
  entity_id: string
  counter_id: string
  cloud_seq: number | null
  conflict_type: string
  local_summary: string
  cloud_summary: string
  resolution: string
  resolved_at: string
}

export interface BackupRecord {
  fileName: string
  sizeBytes: number
  checksum: string
  createdAt: string
}

const URL_STORAGE_KEY = 'vertexia_remote_cloud_url'
const TOKEN_STORAGE_KEY = 'vertexia_remote_session_token'
const SESSION_STORAGE_KEY = 'vertexia_remote_session_meta'
const DEFAULT_CLOUD_URL = String(import.meta.env.VITE_CLOUD_API_URL || '').trim().replace(/\/+$/, '')

export class CloudApiError extends Error {
  statusCode: number
  code: string
  constructor(message: string, statusCode: number, code = 'CloudApiError') {
    super(message)
    this.statusCode = statusCode
    this.code = code
  }
}

export function getSavedCloudUrl(): string {
  try {
    const saved = localStorage.getItem(URL_STORAGE_KEY)?.trim()
    if (saved) return saved.replace(/\/+$/, '')
  } catch {}
  return DEFAULT_CLOUD_URL
}

export function saveCloudUrl(url: string): string {
  const clean = url.trim().replace(/\/+$/, '')
  try {
    if (clean) localStorage.setItem(URL_STORAGE_KEY, clean)
    else localStorage.removeItem(URL_STORAGE_KEY)
  } catch {}
  return clean
}

export function getSessionToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY)
  } catch {
    return null
  }
}

export function getSavedSessionMeta(): CloudOwnerSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as CloudOwnerSession) : null
  } catch {
    return null
  }
}

export function storeSession(token: string, session: CloudOwnerSession): void {
  try {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, token)
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
  } catch {}
}

export function clearStoredSession(): void {
  try {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY)
    sessionStorage.removeItem(SESSION_STORAGE_KEY)
  } catch {}
}

let unauthorizedHandler: (() => void) | null = null
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn
}

function resolveApiUrl(path: string, overrideBase?: string): string {
  const base = (overrideBase ?? getSavedCloudUrl()).replace(/\/+$/, '')
  if (!base) {
    throw new CloudApiError('Set your Vertexia Cloud API URL first.', 0, 'MissingGatewayUrl')
  }
  return `${base}${path}`
}

async function requestJson<T>(
  path: string,
  init: RequestInit = {},
  options: { skipAuthRedirect?: boolean; baseUrl?: string } = {},
): Promise<T> {
  const url = resolveApiUrl(path, options.baseUrl)
  const token = getSessionToken()
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  let res: Response
  try {
    res = await fetch(url, { ...init, headers })
  } catch {
    throw new CloudApiError('Cannot reach Vertexia Cloud API. Check your internet connection or Cloud API URL.', 0, 'NetworkError')
  }

  let body: Record<string, unknown> = {}
  const text = await res.text().catch(() => '')
  if (text) {
    try {
      body = JSON.parse(text) as Record<string, unknown>
    } catch {
      body = { message: text }
    }
  }

  if (!res.ok) {
    if (res.status === 401 && !options.skipAuthRedirect) {
      clearStoredSession()
      unauthorizedHandler?.()
    }
    throw new CloudApiError(
      String(body.message || body.error || `Request failed with HTTP ${res.status}`),
      res.status,
      String(body.error || 'HttpError'),
    )
  }

  return body as T
}

export function buildWebSocketUrl(token: string, baseUrl = getSavedCloudUrl()): string | null {
  if (!baseUrl || !token) return null
  const wsBase = baseUrl.replace(/^https:\/\//i, 'wss://').replace(/^http:\/\//i, 'ws://').replace(/\/+$/, '')
  return `${wsBase}/api/cloud/events?token=${encodeURIComponent(token)}`
}

export const cloudApi = {
  async checkHealth(baseUrl: string): Promise<{ status: string; timestamp: string }> {
    return requestJson('/api/cloud/health', { method: 'GET' }, { skipAuthRedirect: true, baseUrl })
  },

  async login(params: {
    baseUrl: string
    username: string
    password: string
    shopUuid?: string
  }): Promise<{ ok: boolean; token: string; session: CloudOwnerSession }> {
    const deviceType = /android|mobile/i.test(navigator.userAgent) ? 'owner_android_pwa' : 'owner_web'
    const res = await requestJson<{ ok: boolean; token: string; session: CloudOwnerSession }>(
      '/api/cloud/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({
          username: params.username.trim(),
          password: params.password,
          shopUuid: params.shopUuid?.trim() || undefined,
          deviceType,
        }),
      },
      { skipAuthRedirect: true, baseUrl: params.baseUrl },
    )
    saveCloudUrl(params.baseUrl)
    storeSession(res.token, res.session)
    return res
  },

  async me(): Promise<{ session: CloudOwnerSession }> {
    return requestJson('/api/cloud/auth/me')
  },

  async logout(): Promise<void> {
    try {
      await requestJson('/api/cloud/auth/logout', { method: 'POST' }, { skipAuthRedirect: true })
    } catch {
      // ignore network failure during sign-out cleanup
    } finally {
      clearStoredSession()
    }
  },

  async changePassword(currentPassword: string, newPassword: string): Promise<{ ok: boolean; credentialVersion: number }> {
    return requestJson('/api/cloud/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    })
  },

  async getDashboard(): Promise<DashboardPayload> {
    return requestJson('/api/cloud/owner/dashboard')
  },

  async getSales(params: {
    page?: number
    pageSize?: number
    counterId?: string
    dateFrom?: string
    dateTo?: string
    search?: string
  }): Promise<{ total: number; page: number; pageSize: number; sales: SaleRecord[] }> {
    const q = new URLSearchParams()
    if (params.page) q.set('page', String(params.page))
    if (params.pageSize) q.set('pageSize', String(params.pageSize))
    if (params.counterId) q.set('counterId', params.counterId)
    if (params.dateFrom) q.set('dateFrom', params.dateFrom)
    if (params.dateTo) q.set('dateTo', params.dateTo)
    if (params.search?.trim()) q.set('search', params.search.trim())
    return requestJson(`/api/cloud/owner/sales?${q.toString()}`)
  },

  async getSaleDetail(id: string): Promise<SaleDetailResponse> {
    return requestJson(`/api/cloud/owner/sales/${encodeURIComponent(id)}`)
  },

  async getProducts(search?: string): Promise<{ products: ProductRecord[] }> {
    const q = search?.trim() ? `?search=${encodeURIComponent(search.trim())}` : ''
    return requestJson(`/api/cloud/owner/products${q}`)
  },

  async createProduct(input: {
    name: string
    sku?: string
    barcode?: string
    category?: string
    unit?: string
    costPricePaisa: number
    salePricePaisa: number
    minimumStockMilli?: number
    openingStockMilli?: number
  }): Promise<{ ok: boolean; id: string; sku: string; cloudSeq: number }> {
    return requestJson('/api/cloud/owner/products', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },

  async updateProduct(
    id: string,
    input: {
      name?: string
      salePricePaisa?: number
      costPricePaisa?: number
      minimumStockMilli?: number
      isActive?: boolean
    },
  ): Promise<{ ok: boolean; cloudSeq: number }> {
    return requestJson(`/api/cloud/owner/products/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    })
  },

  async adjustInventory(input: {
    productId: string
    quantityDeltaMilli: number
    reason?: string
  }): Promise<{ ok: boolean; movementId: string; balanceAfterMilli: number; cloudSeq: number }> {
    return requestJson('/api/cloud/owner/inventory/adjust', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },

  async getCustomers(): Promise<{ customers: CustomerRecord[] }> {
    return requestJson('/api/cloud/owner/customers')
  },

  async getSuppliers(): Promise<{ suppliers: SupplierRecord[] }> {
    return requestJson('/api/cloud/owner/suppliers')
  },

  async getPurchases(params: { page?: number; search?: string; dateFrom?: string; dateTo?: string } = {}): Promise<{
    total: number
    page: number
    pageSize: number
    purchases: PurchaseRecord[]
  }> {
    const q = new URLSearchParams()
    if (params.page) q.set('page', String(params.page))
    if (params.search?.trim()) q.set('search', params.search.trim())
    if (params.dateFrom) q.set('dateFrom', params.dateFrom)
    if (params.dateTo) q.set('dateTo', params.dateTo)
    return requestJson(`/api/cloud/owner/purchases?${q.toString()}`)
  },

  async getExpenses(): Promise<{ expenses: ExpenseRecord[] }> {
    return requestJson('/api/cloud/owner/expenses')
  },

  async getCashShifts(): Promise<{
    shifts: CashShiftRecord[]
    recentMovements: CashShiftRecord['movements']
  }> {
    return requestJson('/api/cloud/owner/cash-shifts')
  },

  async getStaff(): Promise<{ staff: StaffRecord[] }> {
    return requestJson('/api/cloud/owner/staff')
  },

  async getCounters(): Promise<{ counters: CounterRecord[] }> {
    return requestJson('/api/cloud/owner/counters')
  },

  async revokeCounter(id: string): Promise<{ ok: boolean; cloudSeq: number }> {
    return requestJson(`/api/cloud/owner/counters/${encodeURIComponent(id)}/revoke`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
  },

  async getReports(dateFrom?: string, dateTo?: string): Promise<ReportsPayload> {
    const q = new URLSearchParams()
    if (dateFrom) q.set('dateFrom', dateFrom)
    if (dateTo) q.set('dateTo', dateTo)
    return requestJson(`/api/cloud/owner/reports?${q.toString()}`)
  },

  async getSyncStatus(): Promise<SyncStatusPayload> {
    return requestJson('/api/cloud/owner/sync-status')
  },

  async getConflicts(): Promise<{ conflicts: ConflictRecord[] }> {
    return requestJson('/api/cloud/owner/conflicts')
  },

  async listBackups(): Promise<{ records: BackupRecord[] }> {
    return requestJson('/api/cloud/owner/backups')
  },

  async createBackup(): Promise<{ ok: boolean; fileName: string; checksum: string; sizeBytes: number; createdAt: string }> {
    return requestJson('/api/cloud/owner/backups/create', {
      method: 'POST',
      body: JSON.stringify({}),
    })
  },

  async verifyBackup(fileName: string): Promise<{ valid: boolean; checksum: string; expectedChecksum: string }> {
    return requestJson(`/api/cloud/owner/backups/${encodeURIComponent(fileName)}/verify`)
  },

  async downloadBackup(fileName: string): Promise<void> {
    const url = resolveApiUrl(`/api/cloud/owner/backups/${encodeURIComponent(fileName)}/download`)
    const token = getSessionToken()
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) {
      if (res.status === 401) {
        clearStoredSession()
        unauthorizedHandler?.()
      }
      throw new CloudApiError(`Download failed (HTTP ${res.status})`, res.status)
    }
    const blob = await res.blob()
    const blobUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(blobUrl)
  },
}
