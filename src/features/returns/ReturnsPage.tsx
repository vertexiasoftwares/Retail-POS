import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../app/auth/useAuth'
import { useRetailData } from '../../app/data/useRetailData'
import { notifyRetailDataChanged, RETAIL_DATA_CHANGED } from '../../services/retail-events'
import { useOperationIdentity } from '../../shared/hooks/useOperationIdentity'
import { useEscapeKey } from '../../shared/hooks/useEscapeKey'
import { PageShell, type PageProps } from '../../shared/layout/PageShell'
import { TopNavHeader } from '../../shared/layout/TopNavHeader'
import { CustomSelect } from '../../shared/ui/CustomSelect'
import { DateRangeFilter, type DateRange } from '../../shared/ui/DateRangeFilter'
import { Icon } from '../../shared/ui/Icon'
import { exportToExcel } from '../../shared/utils/exportUtils'
import type {
  PosCustomer,
  PosPaymentMethod,
  ReturnHistoryRow,
  ReturnsSnapshot,
  SalesDetail,
  SalesListRow,
  SalesPeriod,
} from '../../types/desktop-api'

const money = (paisa: number) =>
  'Rs ' + (paisa / 100).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const dateTime = (value: string) =>
  new Date(value).toLocaleString('en-PK', {
    timeZone: 'Asia/Karachi',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

const quickReasons = [
  'Customer changed mind',
  'Wrong item purchased',
  'Defective / Damaged',
  'Size / Quantity issue',
]

type ManualDraftLine = {
  productId: string
  name: string
  sku: string
  unit: string
  quantity: string
  unitPriceRupees: string
}

export default function ReturnsPage(props: PageProps) {
  const { session, can } = useAuth()
  const branchId = session!.branchId
  const { products } = useRetailData()

  const [mode, setMode] = useState<'bill' | 'manual'>('bill')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // Date & table filters for Returns History (default Today)
  const [historyPeriod, setHistoryPeriod] = useState<SalesPeriod>('today')
  const [historyStart, setHistoryStart] = useState<string | undefined>(undefined)
  const [historyEnd, setHistoryEnd] = useState<string | undefined>(undefined)
  const [historySearch, setHistorySearch] = useState('')
  const [historyTypeFilter, setHistoryTypeFilter] = useState<'all' | 'bill' | 'manual'>('all')
  const [historyMethodFilter, setHistoryMethodFilter] = useState('all')
  const [returnsSnapshot, setReturnsSnapshot] = useState<ReturnsSnapshot | null>(null)
  const [recentBills, setRecentBills] = useState<SalesListRow[]>([])
  const [customers, setCustomers] = useState<PosCustomer[]>([])
  const [slipModal, setSlipModal] = useState<ReturnHistoryRow | null>(null)

  // Mode 1: By Bill Number state
  const [initialPrefillBill] = useState<string>(() => {
    try {
      const value = sessionStorage.getItem('vertexia_return_bill') || ''
      if (value) sessionStorage.removeItem('vertexia_return_bill')
      return value
    } catch {
      return ''
    }
  })
  const [billInput, setBillInput] = useState(initialPrefillBill)
  const [loadedBill, setLoadedBill] = useState<SalesDetail | null>(null)
  const [billQuantities, setBillQuantities] = useState<Record<string, string>>({})
  const [billReason, setBillReason] = useState('')
  const billReturnOp = useOperationIdentity('bill-return-tab')

  // Mode 2: Manual Return state
  const [productSearch, setProductSearch] = useState('')
  const [manualLines, setManualLines] = useState<ManualDraftLine[]>([])
  const [manualCustomerId, setManualCustomerId] = useState('customer-walk-in')
  const [manualRefundMethod, setManualRefundMethod] = useState<PosPaymentMethod>('Cash')
  const [manualReason, setManualReason] = useState('')
  const manualReturnOp = useOperationIdentity('manual-return-tab')

  useEscapeKey(() => setSlipModal(null), Boolean(slipModal))

  const loadData = useCallback(async () => {
    if (!window.vertexia) return
    try {
      const [retSnap, salesSnap, posBoot] = await Promise.all([
        window.vertexia.sales.listReturns({
          branchId,
          period: historyPeriod,
          dateFrom: historyStart,
          dateTo: historyEnd,
          search: historySearch,
          returnType: historyTypeFilter,
          refundMethod: historyMethodFilter,
        }),
        window.vertexia.sales.getSnapshot({
          branchId,
          period: 'this_month',
          search: '',
          paymentMethod: 'all',
          status: 'all',
          page: 1,
          pageSize: 10,
        }),
        window.vertexia.pos.getBootstrap(branchId).catch(() => null),
      ])
      setReturnsSnapshot(retSnap)
      setRecentBills(salesSnap.sales.filter(s => s.status !== 'returned' && s.status !== 'voided'))
      if (posBoot?.customers) {
        setCustomers(posBoot.customers)
        if (!posBoot.customers.some(c => c.id === manualCustomerId) && posBoot.customers.length > 0) {
          setManualCustomerId(posBoot.customers[0].id)
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load returns data.')
    }
  }, [branchId, historyPeriod, historyStart, historyEnd, historySearch, historyTypeFilter, historyMethodFilter, manualCustomerId])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData()
      if (initialPrefillBill) {
        void window.vertexia?.sales.findByInvoice(branchId, initialPrefillBill).then(found => {
          if (found) setLoadedBill(found)
        })
      }
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadData, branchId, initialPrefillBill])

  useEffect(() => {
    const reload = () => void loadData()
    window.addEventListener(RETAIL_DATA_CHANGED, reload)
    return () => window.removeEventListener(RETAIL_DATA_CHANGED, reload)
  }, [loadData])

  useEffect(() => {
    if (!notice) return
    const t = window.setTimeout(() => setNotice(''), 4000)
    return () => window.clearTimeout(t)
  }, [notice])

  const findBill = async (queryText?: string) => {
    const q = (queryText ?? billInput).trim()
    if (!q || !window.vertexia) return
    setBusy(true)
    setError('')
    try {
      const found = await window.vertexia.sales.findByInvoice(branchId, q)
      if (!found) {
        setLoadedBill(null)
        setError(`No bill found matching "${q}". Please check the bill number.`)
      } else {
        setLoadedBill(found)
        setBillInput(found.invoiceNumber)
        setBillQuantities({})
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to find bill.')
    } finally {
      setBusy(false)
    }
  }

  const stepBillQty = (lineId: string, delta: number, maxQty: number) => {
    setBillQuantities(curr => {
      const current = Number(curr[lineId] || 0)
      const next = Math.max(0, Math.min(maxQty, Math.round((current + delta) * 1000) / 1000))
      return { ...curr, [lineId]: next > 0 ? String(next) : '' }
    })
  }

  const selectAllBillItems = () => {
    if (!loadedBill) return
    const next: Record<string, string> = {}
    for (const line of loadedBill.lines) {
      if (line.returnableQuantityMilli > 0) {
        next[line.id] = String(line.returnableQuantityMilli / 1000)
      }
    }
    setBillQuantities(next)
  }

  const billEstimatedRefundPaisa = useMemo(() => {
    if (!loadedBill) return 0
    return loadedBill.lines.reduce((sum, line) => {
      const qty = Number(billQuantities[line.id] || 0)
      if (!Number.isFinite(qty) || qty <= 0) return sum
      const qtyMilli = Math.round(qty * 1000)
      if (qtyMilli <= 0 || line.quantityMilli <= 0) return sum
      return sum + Math.round((line.lineTotalPaisa * qtyMilli) / line.quantityMilli)
    }, 0)
  }, [loadedBill, billQuantities])

  const billSelectedItemCount = useMemo(() => {
    if (!loadedBill) return 0
    return loadedBill.lines.filter(line => Number(billQuantities[line.id] || 0) > 0).length
  }, [loadedBill, billQuantities])

  const submitBillReturn = async () => {
    if (!window.vertexia || !loadedBill || busy) return
    setError('')
    const lines = loadedBill.lines
      .filter(line => Number(billQuantities[line.id]) > 0)
      .map(line => ({
        saleItemId: line.id,
        quantityMilli: Math.round(Number(billQuantities[line.id]) * 1000),
      }))
    if (!lines.length) {
      setError('Select at least one item quantity to return.')
      return
    }
    for (const line of loadedBill.lines) {
      const q = Number(billQuantities[line.id] || 0)
      if (!Number.isFinite(q) || q < 0 || Math.round(q * 1000) > line.returnableQuantityMilli) {
        setError(`Return quantity for ${line.name} exceeds available quantity.`)
        return
      }
    }

    setBusy(true)
    try {
      const req = {
        branchId,
        saleId: loadedBill.id,
        reason: billReason.trim(),
        lines,
      }
      const res = await window.vertexia.sales.createReturn({
        ...req,
        operationId: billReturnOp.idFor(req),
      })
      billReturnOp.reset()
      setNotice(`Return ${res.returnNumber} completed! Refunded ${money(res.totalPaisa)} (${res.refundMethod}).`)
      setBillQuantities({})
      setBillReason('')
      const updatedBill = await window.vertexia.sales.getDetail(branchId, loadedBill.id)
      setLoadedBill(updatedBill)
      notifyRetailDataChanged()
      await loadData()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Bill return could not be completed.')
    } finally {
      setBusy(false)
    }
  }

  // Manual Return helpers
  const filteredCatalog = useMemo(() => {
    const active = products.filter(p => p.status === 'active')
    const q = productSearch.trim().toLowerCase()
    if (!q) return active.slice(0, 6)
    return active.filter(p => `${p.name} ${p.sku} ${p.barcode}`.toLowerCase().includes(q)).slice(0, 9)
  }, [products, productSearch])

  const addManualProduct = (p: (typeof products)[number]) => {
    setError('')
    setManualLines(curr => {
      const existing = curr.find(l => l.productId === p.id)
      if (existing) {
        return curr.map(l =>
          l.productId === p.id ? { ...l, quantity: String(Math.round((Number(l.quantity || 0) + 1) * 1000) / 1000) } : l
        )
      }
      return [
        ...curr,
        {
          productId: p.id,
          name: p.name,
          sku: p.sku,
          unit: p.unit,
          quantity: '1',
          unitPriceRupees: p.sellingPriceRupees.toFixed(2),
        },
      ]
    })
  }

  const stepManualQty = (productId: string, delta: number) => {
    setManualLines(curr =>
      curr.map(l => {
        if (l.productId !== productId) return l
        const next = Math.max(0.001, Math.round(((Number(l.quantity) || 0) + delta) * 1000) / 1000)
        return { ...l, quantity: String(next) }
      })
    )
  }

  const manualTotalPaisa = useMemo(() => {
    return manualLines.reduce((sum, l) => {
      const qtyMilli = Math.round((Number(l.quantity) || 0) * 1000)
      const pricePaisa = Math.round((Number(l.unitPriceRupees) || 0) * 100)
      if (qtyMilli <= 0 || pricePaisa < 0) return sum
      return sum + Math.round((pricePaisa * qtyMilli) / 1000)
    }, 0)
  }, [manualLines])

  const submitManualReturn = async () => {
    if (!window.vertexia || busy) return
    setError('')
    if (!manualLines.length) {
      setError('Add at least one product to process a manual return.')
      return
    }
    const parsedLines = manualLines.map(l => ({
      productId: l.productId,
      quantityMilli: Math.round((Number(l.quantity) || 0) * 1000),
      unitPricePaisa: Math.round((Number(l.unitPriceRupees) || 0) * 100),
    }))
    if (parsedLines.some(l => l.quantityMilli <= 0 || l.unitPricePaisa < 0)) {
      setError('All returned products must have quantity above zero and valid refund price.')
      return
    }

    setBusy(true)
    try {
      const req = {
        branchId,
        customerId: manualCustomerId,
        refundMethod: manualRefundMethod,
        reason: manualReason.trim(),
        lines: parsedLines,
      }
      const res = await window.vertexia.sales.createManualReturn({
        ...req,
        operationId: manualReturnOp.idFor(req),
      })
      manualReturnOp.reset()
      setNotice(`Manual return ${res.returnNumber} completed! Refunded ${money(res.totalPaisa)} (${res.refundMethod}).`)
      setManualLines([])
      setManualReason('')
      notifyRetailDataChanged()
      await loadData()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Manual return could not be completed.')
    } finally {
      setBusy(false)
    }
  }

  const handleDateFilter = (range: DateRange) => {
    if (range.preset === 'today') {
      setHistoryPeriod('today')
      setHistoryStart(undefined)
      setHistoryEnd(undefined)
    } else if (range.preset === 'yesterday') {
      setHistoryPeriod('yesterday')
      setHistoryStart(undefined)
      setHistoryEnd(undefined)
    } else if (range.preset === 'week') {
      setHistoryPeriod('this_week')
      setHistoryStart(undefined)
      setHistoryEnd(undefined)
    } else if (range.preset === 'month') {
      setHistoryPeriod('this_month')
      setHistoryStart(undefined)
      setHistoryEnd(undefined)
    } else if (range.preset === 'last_month') {
      setHistoryPeriod('last_month')
      setHistoryStart(undefined)
      setHistoryEnd(undefined)
    } else if (range.preset === 'custom') {
      setHistoryPeriod('custom')
      setHistoryStart(range.startDate)
      setHistoryEnd(range.endDate)
    }
  }

  const canProcessReturn = can('sales.return')

  return (
    <PageShell
      {...props}
      activePage="Returns"
      header={() => (
        <TopNavHeader
          title="Returns & Refunds"
          subtitle="Simple 3-step return processing & refund register"
          onNavigate={props.onNavigate}
        />
      )}
    >
      <div className="medkit-page-container space-y-5">
        <div className="medkit-top-banner">
          <div className="medkit-banner-left">
            <div className="medkit-banner-icon">
              <Icon name="returnOrder" size={24} />
            </div>
            <div className="medkit-banner-titles">
              <h1>Returns &amp; Refunds</h1>
              <p>Process returns by Bill # or manually without a bill — stock updates automatically</p>
            </div>
          </div>
          <div className="medkit-banner-actions">
            <DateRangeFilter onChange={handleDateFilter} />
          </div>
        </div>

        {error && (
          <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-sm font-medium flex items-center justify-between gap-3">
            <span>{error}</span>
            <button type="button" onClick={() => setError('')} className="text-xs font-bold underline">
              Dismiss
            </button>
          </div>
        )}
        {notice && (
          <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 text-sm font-medium">
            {notice}
          </div>
        )}

        {/* Summary KPI Cards */}
        <div className="medkit-stats-row">
          <div className="medkit-stat-card">
            <div className="medkit-stat-badge purple">
              <Icon name="returnOrder" size={22} />
            </div>
            <div className="medkit-stat-body">
              <div className="medkit-stat-label">Total Returns</div>
              <div className="medkit-stat-value">{returnsSnapshot?.totalReturnsCount ?? 0}</div>
              <div className="medkit-stat-meta">
                <span>{returnsSnapshot?.rangeLabel || 'Today'}</span>
              </div>
            </div>
          </div>

          <div className="medkit-stat-card">
            <div className="medkit-stat-badge red">
              <Icon name="money" size={22} />
            </div>
            <div className="medkit-stat-body">
              <div className="medkit-stat-label">Total Refunded</div>
              <div className="medkit-stat-value">{money(returnsSnapshot?.totalRefundedPaisa ?? 0)}</div>
              <div className="medkit-stat-meta">
                <span>Cash, digital &amp; credit</span>
              </div>
            </div>
          </div>

          <div className="medkit-stat-card">
            <div className="medkit-stat-badge blue">
              <Icon name="receipt" size={22} />
            </div>
            <div className="medkit-stat-body">
              <div className="medkit-stat-label">Bill Returns</div>
              <div className="medkit-stat-value">{returnsSnapshot?.billReturnCount ?? 0}</div>
              <div className="medkit-stat-meta">
                <span>Via Bill #</span>
              </div>
            </div>
          </div>

          <div className="medkit-stat-card">
            <div className="medkit-stat-badge green">
              <Icon name="box" size={22} />
            </div>
            <div className="medkit-stat-body">
              <div className="medkit-stat-label">Manual Returns</div>
              <div className="medkit-stat-value">{returnsSnapshot?.manualReturnCount ?? 0}</div>
              <div className="medkit-stat-meta">
                <span>Without Bill #</span>
              </div>
            </div>
          </div>
        </div>

        {/* Guided Return Card */}
        {canProcessReturn ? (
          <div className="medkit-card">
            {/* Simple Mode Selector Cards */}
            <div className="p-4 sm:p-5 border-b border-slate-100 bg-slate-50/50">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setMode('bill')
                    setError('')
                  }}
                  className={`flex items-center gap-3.5 p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                    mode === 'bill'
                      ? 'bg-white border-[#5E0CF3] ring-2 ring-[#5E0CF3]/15 shadow-sm'
                      : 'bg-white/70 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                      mode === 'bill' ? 'bg-[#5E0CF3] text-white' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    <Icon name="receipt" size={20} />
                  </div>
                  <div className="min-w-0">
                    <div className={`text-sm font-bold ${mode === 'bill' ? 'text-[#5E0CF3]' : 'text-slate-800'}`}>
                      1. Return with Bill Number
                    </div>
                    <div className="text-xs text-slate-500">
                      Customer has a receipt (e.g. BILL-001). Find bill and choose qty.
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMode('manual')
                    setError('')
                  }}
                  className={`flex items-center gap-3.5 p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                    mode === 'manual'
                      ? 'bg-white border-[#5E0CF3] ring-2 ring-[#5E0CF3]/15 shadow-sm'
                      : 'bg-white/70 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                      mode === 'manual' ? 'bg-[#5E0CF3] text-white' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    <Icon name="box" size={20} />
                  </div>
                  <div className="min-w-0">
                    <div className={`text-sm font-bold ${mode === 'manual' ? 'text-[#5E0CF3]' : 'text-slate-800'}`}>
                      2. Manual Return (No Bill)
                    </div>
                    <div className="text-xs text-slate-500">
                      Customer lost receipt. Select any product and issue direct refund.
                    </div>
                  </div>
                </button>
              </div>
            </div>

            {mode === 'bill' ? (
              <div className="p-4 sm:p-6 space-y-5 min-w-0">
                {/* Step 1: Find Bill */}
                <div className="space-y-3 min-w-0">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className="text-sm font-bold uppercase tracking-wide text-slate-700">
                      Step 1 · Enter Bill Number or Pick Recent Bill
                    </span>
                    {loadedBill && (
                      <button
                        type="button"
                        onClick={() => {
                          setLoadedBill(null)
                          setBillInput('')
                          setBillQuantities({})
                        }}
                        className="text-sm font-semibold text-slate-600 hover:text-slate-900 underline cursor-pointer"
                      >
                        Clear Selected Bill
                      </button>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5 min-w-0">
                    <div className="medkit-search-input-wrap flex-1" style={{ minWidth: 180 }}>
                      <Icon name="search" size={16} />
                      <input
                        type="text"
                        value={billInput}
                        onChange={e => setBillInput(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            void findBill()
                          }
                        }}
                        placeholder="Type Bill # (e.g. BILL-001 or 001)..."
                      />
                    </div>
                    <button
                      type="button"
                      disabled={busy || !billInput.trim()}
                      onClick={() => void findBill()}
                      className="medkit-btn-primary shrink-0"
                    >
                      {busy ? 'Searching…' : 'Find Bill'}
                    </button>
                  </div>

                  {recentBills.length > 0 && (
                    <div className="space-y-2.5 pt-1 min-w-0">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <span className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                          <Icon name="receipt" size={16} />
                          Recent Bills
                        </span>
                        <span className="text-sm text-slate-600">
                          Click any bill row below to load items
                        </span>
                      </div>
                      <div className="border border-slate-200 rounded-xl overflow-hidden bg-white divide-y divide-slate-100">
                        {recentBills.slice(0, 6).map(b => {
                          const isSelected = loadedBill?.id === b.id
                          const customerLabel = b.customerName === 'Walk-in Customer' ? 'Cash Sale' : b.customerName
                          return (
                            <button
                              key={b.id}
                              type="button"
                              onClick={() => {
                                setBillInput(b.invoiceNumber)
                                void findBill(b.invoiceNumber)
                              }}
                              className={`w-full px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-left transition-colors cursor-pointer ${
                                isSelected
                                  ? 'bg-purple-50 text-[#5E0CF3]'
                                  : 'bg-white hover:bg-slate-50 text-slate-800'
                              }`}
                            >
                              <div className="flex flex-wrap items-center gap-3 min-w-0">
                                <span
                                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg font-mono text-sm font-bold whitespace-nowrap ${
                                    isSelected
                                      ? 'bg-[#5E0CF3] text-white'
                                      : 'bg-slate-100 text-slate-900 border border-slate-200/80'
                                  }`}
                                >
                                  <Icon name="receipt" size={14} />
                                  {b.invoiceNumber}
                                </span>
                                <div className="min-w-0">
                                  <div className="text-sm font-semibold text-slate-900">{customerLabel}</div>
                                  <div className="text-sm text-slate-600">{dateTime(b.completedAt)}</div>
                                </div>
                              </div>
                              <div className="flex items-center gap-3 sm:gap-4 ml-auto">
                                <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 text-sm font-medium whitespace-nowrap">
                                  {b.paymentMethod}
                                </span>
                                <span className="text-sm font-bold text-slate-900 tabular-nums whitespace-nowrap min-w-[92px] text-right">
                                  {money(b.netPaisa)}
                                </span>
                                <span
                                  className={`text-sm font-semibold whitespace-nowrap ${
                                    isSelected ? 'text-[#5E0CF3]' : 'text-slate-600'
                                  }`}
                                >
                                  {isSelected ? 'Selected' : 'Select'}
                                </span>
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Step 2 & 3: Loaded Bill Details */}
                {loadedBill ? (
                  <div className="space-y-4 pt-4 border-t border-slate-100 min-w-0">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <span className="text-sm font-bold uppercase tracking-wide text-slate-700">
                        Step 2 · Choose Items to Return from {loadedBill.invoiceNumber}
                      </span>
                      {loadedBill.lines.some(l => l.returnableQuantityMilli > 0) && (
                        <button
                          type="button"
                          onClick={selectAllBillItems}
                          className="medkit-btn-outline py-1.5 px-3 text-sm"
                        >
                          Return All Remaining Items
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200/80 text-sm">
                      <div>
                        <span className="text-slate-600 block">Bill #</span>
                        <strong className="font-mono text-[#5E0CF3]">{loadedBill.invoiceNumber}</strong>
                      </div>
                      <div>
                        <span className="text-slate-600 block">Customer</span>
                        <strong className="text-slate-900">
                          {loadedBill.customerName === 'Walk-in Customer' ? 'Cash Sale' : loadedBill.customerName}
                        </strong>
                      </div>
                      <div>
                        <span className="text-slate-600 block">Date</span>
                        <strong className="text-slate-900">{dateTime(loadedBill.completedAt)}</strong>
                      </div>
                      <div>
                        <span className="text-slate-600 block">Payment</span>
                        <strong className="text-slate-900">{loadedBill.paymentMethod}</strong>
                      </div>
                      <div>
                        <span className="text-slate-600 block">Net Bill</span>
                        <strong className="text-slate-900">{money(loadedBill.netPaisa)}</strong>
                      </div>
                    </div>

                    <div className="w-full max-w-full overflow-x-auto border border-slate-200 rounded-xl">
                      <table className="w-full text-sm text-left table-auto">
                        <thead className="bg-slate-50 text-slate-700 border-b border-slate-200">
                          <tr>
                            <th className="py-2.5 px-3">Product</th>
                            <th className="py-2.5 px-3 text-right whitespace-nowrap">Sold</th>
                            <th className="py-2.5 px-3 text-right whitespace-nowrap">Available</th>
                            <th className="py-2.5 px-3 text-right whitespace-nowrap">Unit Price</th>
                            <th className="py-2.5 px-3 text-center whitespace-nowrap">Return Qty</th>
                            <th className="py-2.5 px-3 text-right whitespace-nowrap">Refund</th>
                          </tr>
                        </thead>
                        <tbody>
                          {loadedBill.lines.map(line => {
                            const maxQty = line.returnableQuantityMilli / 1000
                            const enteredQty = Number(billQuantities[line.id] || 0)
                            const rowRefund =
                              enteredQty > 0 && line.quantityMilli > 0
                                ? Math.round((line.lineTotalPaisa * Math.round(enteredQty * 1000)) / line.quantityMilli)
                                : 0
                            return (
                              <tr key={line.id} className="border-b border-slate-100 last:border-0">
                                <td className="py-2.5 px-3 font-semibold text-slate-900">{line.name}</td>
                                <td className="py-2.5 px-3 text-right whitespace-nowrap">
                                  {line.quantityMilli / 1000}
                                </td>
                                <td className="py-2.5 px-3 text-right font-bold text-emerald-700 whitespace-nowrap">
                                  {maxQty}
                                </td>
                                <td className="py-2.5 px-3 text-right whitespace-nowrap">
                                  {money(line.unitPricePaisa)}
                                </td>
                                <td className="py-2.5 px-3 text-center">
                                  {maxQty > 0 ? (
                                    <div className="inline-flex items-center gap-1 justify-center">
                                      <button
                                        type="button"
                                        onClick={() => stepBillQty(line.id, -1, maxQty)}
                                        className="w-7 h-7 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-sm cursor-pointer"
                                        aria-label={`Decrease return qty for ${line.name}`}
                                      >
                                        −
                                      </button>
                                      <input
                                        type="number"
                                        min="0"
                                        max={maxQty}
                                        step="0.001"
                                        placeholder="0"
                                        value={billQuantities[line.id] ?? ''}
                                        onChange={e =>
                                          setBillQuantities(curr => ({ ...curr, [line.id]: e.target.value }))
                                        }
                                        className="w-16 px-2 py-1 border border-slate-300 rounded-md text-center text-sm font-bold text-slate-900"
                                      />
                                      <button
                                        type="button"
                                        onClick={() => stepBillQty(line.id, 1, maxQty)}
                                        className="w-7 h-7 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-sm cursor-pointer"
                                        aria-label={`Increase return qty for ${line.name}`}
                                      >
                                        +
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setBillQuantities(curr => ({ ...curr, [line.id]: String(maxQty) }))
                                        }
                                        className="px-2.5 py-1 rounded-md bg-purple-50 text-[#5E0CF3] border border-purple-200 text-sm font-semibold cursor-pointer ml-1"
                                      >
                                        All
                                      </button>
                                    </div>
                                  ) : (
                                    <span className="text-sm text-slate-500">Fully returned</span>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 text-right font-bold text-[#5E0CF3] whitespace-nowrap">
                                  {rowRefund > 0 ? money(rowRefund) : '—'}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>

                    {loadedBill.lines.some(l => l.returnableQuantityMilli > 0) && (
                      <div className="space-y-4 pt-2">
                        <div className="space-y-2">
                          <label className="block text-xs font-semibold text-slate-700">
                            Return Note / Reason <span className="text-slate-400 font-normal">(Optional)</span>
                          </label>
                          <input
                            type="text"
                            maxLength={250}
                            value={billReason}
                            onChange={e => setBillReason(e.target.value)}
                            placeholder="Optional note (leave empty if not needed)..."
                            className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-xs bg-white"
                          />
                          <div className="flex flex-wrap gap-1.5">
                            {quickReasons.map(r => (
                              <button
                                key={r}
                                type="button"
                                onClick={() => setBillReason(curr => (curr === r ? '' : r))}
                                className={`px-2.5 py-1 rounded-full text-[11px] font-medium cursor-pointer transition-colors ${
                                  billReason === r
                                    ? 'bg-[#5E0CF3] text-white'
                                    : 'bg-slate-100 hover:bg-purple-50 text-slate-600 hover:text-[#5E0CF3]'
                                }`}
                              >
                                {r}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="p-4 rounded-xl bg-purple-50/70 border border-purple-200 flex flex-wrap items-center justify-between gap-4">
                          <div className="flex flex-wrap items-center gap-6">
                            <div>
                              <span className="text-[11px] text-slate-600 block">Items Selected</span>
                              <strong className="text-base font-bold text-slate-900">
                                {billSelectedItemCount} item(s)
                              </strong>
                            </div>
                            <div>
                              <span className="text-[11px] text-slate-600 block">Refund Method</span>
                              <strong className="text-base font-bold text-slate-800">{loadedBill.paymentMethod}</strong>
                            </div>
                            <div>
                              <span className="text-[11px] text-slate-600 block">Total Refund Amount</span>
                              <strong className="text-xl font-bold text-[#5E0CF3]">
                                {money(billEstimatedRefundPaisa)}
                              </strong>
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={busy || billEstimatedRefundPaisa <= 0}
                            onClick={() => void submitBillReturn()}
                            className="medkit-btn-primary"
                          >
                            {busy ? 'Processing…' : 'Complete Bill Return'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="py-8 px-4 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-xl bg-slate-50/40">
                    Type a Bill # above or click a recent bill badge to load its products.
                  </div>
                )}
              </div>
            ) : (
              /* MODE 2: MANUAL RETURN (CLEAN STACKED STEPS) */
              <div className="p-4 sm:p-6 space-y-5">
                {/* Step 1: Search & Add Product */}
                <div className="space-y-3">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block">
                    Step 1 · Search &amp; Tap Products Customer is Returning
                  </span>
                  <div className="medkit-search-input-wrap bg-white">
                    <Icon name="search" size={16} />
                    <input
                      type="text"
                      value={productSearch}
                      onChange={e => setProductSearch(e.target.value)}
                      placeholder="Search product by name, barcode or SKU..."
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                    {filteredCatalog.map(p => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between gap-2.5 p-3 rounded-xl bg-slate-50/70 border border-slate-200 hover:border-[#5E0CF3]/50 transition-all"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-slate-800 truncate">{p.name}</div>
                          <div className="text-[11px] text-slate-500 truncate">
                            Rs {p.sellingPriceRupees.toLocaleString('en-PK')} · Stock: {p.stock} {p.unit}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => addManualProduct(p)}
                          className="px-3 py-1.5 rounded-lg bg-purple-50 text-[#5E0CF3] border border-purple-200 text-xs font-bold hover:bg-[#5E0CF3] hover:text-white transition-colors cursor-pointer flex-shrink-0"
                        >
                          + Add
                        </button>
                      </div>
                    ))}
                    {filteredCatalog.length === 0 && (
                      <div className="col-span-full py-5 text-center text-xs text-slate-400">
                        No matching active products found.
                      </div>
                    )}
                  </div>
                </div>

                {/* Step 2: Review Return Items */}
                <div className="space-y-2.5 pt-4 border-t border-slate-100">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block">
                    Step 2 · Return Quantities &amp; Refund Price
                  </span>
                  <div className="w-full overflow-x-auto border border-slate-200 rounded-xl">
                    <table className="w-full text-xs text-left table-auto">
                      <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                        <tr>
                          <th className="py-2.5 px-3">Product</th>
                          <th className="py-2.5 px-3 text-center whitespace-nowrap">Return Qty</th>
                          <th className="py-2.5 px-3 whitespace-nowrap">Refund Rate (Rs)</th>
                          <th className="py-2.5 px-3 text-right whitespace-nowrap">Subtotal</th>
                          <th className="py-2.5 px-2 text-center" style={{ width: 44 }} />
                        </tr>
                      </thead>
                      <tbody>
                        {manualLines.map(line => {
                          const lineRefund = Math.round(
                            ((Number(line.unitPriceRupees) || 0) * 100 * ((Number(line.quantity) || 0) * 1000)) / 1000
                          )
                          return (
                            <tr key={line.productId} className="border-b border-slate-100 last:border-0">
                              <td className="py-2.5 px-3 font-semibold text-slate-800">{line.name}</td>
                              <td className="py-2.5 px-3 text-center">
                                <div className="inline-flex items-center gap-1 justify-center">
                                  <button
                                    type="button"
                                    onClick={() => stepManualQty(line.productId, -1)}
                                    className="w-7 h-7 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm cursor-pointer"
                                  >
                                    −
                                  </button>
                                  <input
                                    type="number"
                                    min="0.001"
                                    step="0.001"
                                    value={line.quantity}
                                    onChange={e =>
                                      setManualLines(curr =>
                                        curr.map(item =>
                                          item.productId === line.productId
                                            ? { ...item, quantity: e.target.value }
                                            : item
                                        )
                                      )
                                    }
                                    className="w-16 px-2 py-1 border border-slate-300 rounded-md text-center text-xs font-bold"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => stepManualQty(line.productId, 1)}
                                    className="w-7 h-7 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm cursor-pointer"
                                  >
                                    +
                                  </button>
                                </div>
                              </td>
                              <td className="py-2.5 px-3">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={line.unitPriceRupees}
                                  onChange={e =>
                                    setManualLines(curr =>
                                      curr.map(item =>
                                        item.productId === line.productId
                                          ? { ...item, unitPriceRupees: e.target.value }
                                          : item
                                      )
                                    )
                                  }
                                  className="w-24 px-2.5 py-1 border border-slate-300 rounded-md text-xs font-semibold"
                                />
                              </td>
                              <td className="py-2.5 px-3 text-right font-bold text-slate-900 whitespace-nowrap">
                                {money(Math.max(0, lineRefund))}
                              </td>
                              <td className="py-2.5 px-2 text-center">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setManualLines(curr => curr.filter(item => item.productId !== line.productId))
                                  }
                                  className="text-rose-500 hover:text-rose-700 font-bold text-base cursor-pointer px-1"
                                  title="Remove item"
                                >
                                  ×
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                        {manualLines.length === 0 && (
                          <tr>
                            <td colSpan={5} className="py-7 text-center text-slate-400 text-xs">
                              Click <strong>+ Add</strong> on any product above to include it in this return.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Step 3: Refund Details & Confirm */}
                <div className="space-y-4 pt-4 border-t border-slate-100">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block">
                    Step 3 · Refund Method &amp; Optional Note
                  </span>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Customer</label>
                      <CustomSelect
                        ariaLabel="Return Customer"
                        value={manualCustomerId}
                        onChange={setManualCustomerId}
                        options={customers.map(c => ({
                          value: c.id,
                          label: `${c.isWalkIn ? 'Cash Return (No Customer)' : c.name}${c.phone ? ` (${c.phone})` : ''}`,
                        }))}
                        fullWidth
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Refund Method</label>
                      <CustomSelect
                        ariaLabel="Refund Method"
                        value={manualRefundMethod}
                        onChange={val => setManualRefundMethod(val as PosPaymentMethod)}
                        options={(['Cash', 'Card', 'JazzCash', 'Easypaisa', 'Udhaar'] as PosPaymentMethod[]).map(m => ({
                          value: m,
                          label: m,
                        }))}
                        fullWidth
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Return Note <span className="text-slate-400 font-normal">(Optional)</span>
                      </label>
                      <input
                        type="text"
                        maxLength={250}
                        value={manualReason}
                        onChange={e => setManualReason(e.target.value)}
                        placeholder="Optional note..."
                        className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-xs bg-white"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {quickReasons.map(r => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setManualReason(curr => (curr === r ? '' : r))}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-medium cursor-pointer transition-colors ${
                          manualReason === r
                            ? 'bg-[#5E0CF3] text-white'
                            : 'bg-slate-100 hover:bg-purple-50 text-slate-600 hover:text-[#5E0CF3]'
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>

                  <div className="p-4 rounded-xl bg-purple-50/70 border border-purple-200 flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <span className="text-[11px] text-slate-600 block">
                        Total Refund ({manualLines.length} item{manualLines.length === 1 ? '' : 's'} · {manualRefundMethod})
                      </span>
                      <strong className="text-xl font-bold text-[#5E0CF3]">{money(manualTotalPaisa)}</strong>
                    </div>
                    <button
                      type="button"
                      disabled={busy || !manualLines.length || manualTotalPaisa <= 0}
                      onClick={() => void submitManualReturn()}
                      className="medkit-btn-primary"
                    >
                      {busy ? 'Processing…' : 'Complete Manual Return'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="medkit-card p-6 text-center text-sm text-slate-500">
            You do not have permission to post returns. Contact your manager or owner.
          </div>
        )}

        {/* Returns History Register */}
        <div className="medkit-card">
          <div className="p-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">Returns History</h2>
              <p className="text-xs text-slate-500">All processed bill returns and manual returns</p>
            </div>
            {can('data.export') && (
              <button
                type="button"
                onClick={() =>
                  exportToExcel({
                    filename: `returns-report-${new Date().toISOString().slice(0, 10)}.xls`,
                    title: 'Returns & Refunds Report',
                    subtitle: `${returnsSnapshot?.rangeLabel || 'Today'} | Total Refunded: ${money(returnsSnapshot?.totalRefundedPaisa ?? 0)}`,
                    headers: [
                      'Return #',
                      'Type',
                      'Original Bill #',
                      'Date & Time',
                      'Customer',
                      'Products',
                      'Refund Method',
                      'Note / Reason',
                      'Amount (Rs)',
                    ],
                    rows: (returnsSnapshot?.returns ?? []).map(r => [
                      r.returnNumber,
                      r.returnType === 'bill' ? 'Bill Return' : 'Manual Return',
                      r.invoiceNumber || 'Manual',
                      dateTime(r.occurredAt),
                      r.customerName,
                      r.items.map(i => `${i.productName} (x${i.quantityMilli / 1000})`).join(', '),
                      r.refundMethod,
                      r.reason || '—',
                      (r.totalPaisa / 100).toFixed(2),
                    ]),
                  })
                }
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  height: '38px',
                  padding: '0 13px',
                  border: '1px solid #dce4ef',
                  borderRadius: '8px',
                  background: '#ffffff',
                  color: '#1e293b',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#16a34a"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
                </svg>
                <span>Export Excel</span>
              </button>
            )}
          </div>

          <div className="p-3.5 bg-slate-50/60 border-b border-slate-100 flex flex-wrap items-center gap-2.5">
            <div className="medkit-search-input-wrap flex-1 min-w-[200px]">
              <Icon name="search" size={15} />
              <input
                type="text"
                value={historySearch}
                onChange={e => setHistorySearch(e.target.value)}
                placeholder="Search return #, bill #, customer..."
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <CustomSelect
                ariaLabel="Filter by return type"
                value={historyTypeFilter}
                onChange={val => setHistoryTypeFilter(val as 'all' | 'bill' | 'manual')}
                options={[
                  { value: 'all', label: 'All Return Types' },
                  { value: 'bill', label: 'Bill Returns' },
                  { value: 'manual', label: 'Manual Returns' },
                ]}
                minWidth={160}
              />
              <CustomSelect
                ariaLabel="Filter by refund method"
                value={historyMethodFilter}
                onChange={setHistoryMethodFilter}
                options={[
                  { value: 'all', label: 'All Refund Methods' },
                  ...['Cash', 'Card', 'JazzCash', 'Easypaisa', 'Udhaar'].map(m => ({ value: m, label: m })),
                ]}
                minWidth={170}
              />
            </div>
          </div>

          <div className="w-full max-w-full overflow-x-auto">
            <table className="medkit-table w-full">
              <thead>
                <tr>
                  <th>Return #</th>
                  <th>Type</th>
                  <th>Bill #</th>
                  <th>Date &amp; Time</th>
                  <th>Customer</th>
                  <th>Returned Items</th>
                  <th>Method</th>
                  <th style={{ textAlign: 'right' }}>Refund</th>
                  <th style={{ textAlign: 'center' }}>Slip</th>
                </tr>
              </thead>
              <tbody>
                {(returnsSnapshot?.returns ?? []).map(row => (
                  <tr key={row.id}>
                    <td className="font-mono text-xs font-bold text-[#5E0CF3] whitespace-nowrap">{row.returnNumber}</td>
                    <td>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${
                          row.returnType === 'bill' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-800'
                        }`}
                      >
                        {row.returnType === 'bill' ? 'Bill Return' : 'Manual'}
                      </span>
                    </td>
                    <td className="font-mono text-xs text-slate-700 whitespace-nowrap">{row.invoiceNumber || '—'}</td>
                    <td className="text-xs text-slate-600 whitespace-nowrap">{dateTime(row.occurredAt)}</td>
                    <td className="font-semibold text-slate-800">{row.customerName === 'Walk-in Customer' ? '—' : row.customerName}</td>
                    <td className="text-xs text-slate-600 max-w-[240px]">
                      {row.items.map(i => `${i.productName} × ${i.quantityMilli / 1000}`).join(', ')}
                    </td>
                    <td>
                      <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[11px] font-semibold">
                        {row.refundMethod}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }} className="font-bold text-rose-600 whitespace-nowrap">
                      {money(row.totalPaisa)}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button
                        type="button"
                        onClick={() => setSlipModal(row)}
                        className="medkit-btn-secondary py-1 px-2.5 text-xs whitespace-nowrap"
                      >
                        View Slip
                      </button>
                    </td>
                  </tr>
                ))}
                {(!returnsSnapshot?.returns || returnsSnapshot.returns.length === 0) && (
                  <tr>
                    <td colSpan={9} className="py-10 text-center text-sm text-slate-400">
                      No return transactions found for the selected period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Return Slip Modal */}
      {slipModal && (
        <div className="medkit-modal-backdrop" onClick={() => setSlipModal(null)}>
          <div className="medkit-modal medkit-modal-lg" style={{ maxWidth: 680 }} onClick={e => e.stopPropagation()}>
            <div className="medkit-modal-header">
              <h2>Return Receipt · {slipModal.returnNumber}</h2>
              <button
                type="button"
                onClick={() => setSlipModal(null)}
                className="text-slate-400 hover:text-slate-700 text-lg leading-none"
              >
                ✕
              </button>
            </div>
            <div className="medkit-modal-body space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2 p-3 rounded-xl bg-slate-50">
                <span className="text-slate-500">Return Type:</span>
                <strong className="text-right">
                  {slipModal.returnType === 'bill' ? `Bill Return (${slipModal.invoiceNumber})` : 'Manual Return'}
                </strong>
                <span className="text-slate-500">Customer:</span>
                <strong className="text-right">
                  {slipModal.customerName === 'Walk-in Customer' ? 'Cash Return' : slipModal.customerName}
                </strong>
                <span className="text-slate-500">Date &amp; Time:</span>
                <strong className="text-right">{dateTime(slipModal.occurredAt)}</strong>
                <span className="text-slate-500">Processed By:</span>
                <strong className="text-right">{slipModal.cashierName}</strong>
                <span className="text-slate-500">Refund Method:</span>
                <strong className="text-right">{slipModal.refundMethod}</strong>
              </div>
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="py-2 px-3 text-left">Item</th>
                      <th className="py-2 px-3 text-right">Qty</th>
                      <th className="py-2 px-3 text-right">Refund</th>
                    </tr>
                  </thead>
                  <tbody>
                    {slipModal.items.map((item, idx) => (
                      <tr key={idx} className="border-t border-slate-100">
                        <td className="py-2 px-3 font-medium text-slate-800">{item.productName}</td>
                        <td className="py-2 px-3 text-right">{item.quantityMilli / 1000}</td>
                        <td className="py-2 px-3 text-right font-semibold">{money(item.refundPaisa)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-between items-center p-3 rounded-xl bg-rose-50 text-rose-800 font-bold text-sm">
                <span>Total Refunded</span>
                <span>{money(slipModal.totalPaisa)}</span>
              </div>
              <p className="text-slate-500">Note / Reason: {slipModal.reason || '—'}</p>
            </div>
            <div className="medkit-modal-footer">
              <button type="button" onClick={() => window.print()} className="medkit-btn-outline">
                Print Return Slip
              </button>
              <button type="button" onClick={() => setSlipModal(null)} className="medkit-btn-primary">
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  )
}
