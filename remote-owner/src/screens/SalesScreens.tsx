import { useCallback, useEffect, useState } from 'react'
import { cloudApi, type CounterRecord, type SaleDetailResponse, type SaleRecord } from '../services/cloudApi'
import { formatDateTime, formatPkr, formatQty } from '../utils/format'
import { ErrorBanner, EmptyState, PageHeader, StatusBadge } from '../components/UiPrimitives'

export function SalesScreen({
  refreshTick,
  onSelectSale,
}: {
  refreshTick: number
  onSelectSale: (saleId: string) => void
}) {
  const [sales, setSales] = useState<SaleRecord[]>([])
  const [counters, setCounters] = useState<CounterRecord[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [counterId, setCounterId] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const pageSize = 25

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [salesRes, countersRes] = await Promise.all([
        cloudApi.getSales({ page, pageSize, search, counterId: counterId || undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined }),
        counters.length ? Promise.resolve({ counters }) : cloudApi.getCounters(),
      ])
      setSales(salesRes.sales)
      setTotal(salesRes.total)
      if (!counters.length) setCounters(countersRes.counters)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sales.')
    } finally {
      setLoading(false)
    }
  }, [page, search, counterId, dateFrom, dateTo, counters])

  useEffect(() => {
    void load()
  }, [load, refreshTick])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div>
      <PageHeader
        title="Sales Invoices"
        subtitle={`${total} synced invoice(s) • Click any invoice for complete line items and payment details`}
      />
      <ErrorBanner message={error} onRetry={load} />

      <div className="mb-4 grid grid-cols-1 gap-2.5 rounded-2xl border border-[#dce6f4] bg-white p-3.5 sm:grid-cols-2 lg:grid-cols-5">
        <input
          type="search"
          value={search}
          onChange={e => {
            setPage(1)
            setSearch(e.target.value)
          }}
          placeholder="Search invoice, customer, phone..."
          className="rounded-xl border border-[#dce6f4] px-3 py-2 text-sm outline-none focus:border-[#6d4aff] lg:col-span-2"
        />
        <select
          value={counterId}
          onChange={e => {
            setPage(1)
            setCounterId(e.target.value)
          }}
          className="rounded-xl border border-[#dce6f4] px-3 py-2 text-sm outline-none focus:border-[#6d4aff]"
        >
          <option value="">All Counters</option>
          {counters.map(c => (
            <option key={c.id} value={c.id}>
              #{c.counter_number} {c.name}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={e => {
            setPage(1)
            setDateFrom(e.target.value)
          }}
          aria-label="Date From"
          className="rounded-xl border border-[#dce6f4] px-3 py-2 text-sm outline-none focus:border-[#6d4aff]"
        />
        <input
          type="date"
          value={dateTo}
          onChange={e => {
            setPage(1)
            setDateTo(e.target.value)
          }}
          aria-label="Date To"
          className="rounded-xl border border-[#dce6f4] px-3 py-2 text-sm outline-none focus:border-[#6d4aff]"
        />
      </div>

      {!loading && sales.length === 0 ? (
        <EmptyState title="No invoices match your filter" description="Adjust search terms or date filters to view synced sales." />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[#dce6f4] bg-white shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#dce6f4] bg-[#f8fbff] text-xs font-semibold uppercase text-[#55667d]">
                <tr>
                  <th className="px-4 py-3">Invoice</th>
                  <th className="px-4 py-3">Date &amp; Time</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Counter / Cashier</th>
                  <th className="px-4 py-3">Payment</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#edf2fa]">
                {sales.map(s => (
                  <tr
                    key={s.id}
                    onClick={() => onSelectSale(s.id)}
                    className="cursor-pointer transition hover:bg-[#f2f7fd]"
                  >
                    <td className="px-4 py-3 font-semibold text-[#6d4aff]">{s.invoice_number}</td>
                    <td className="px-4 py-3 text-xs text-[#55667d]">{formatDateTime(s.completed_at)}</td>
                    <td className="px-4 py-3 font-medium text-[#10243f]">{s.customer_name || 'Walk-in Customer'}</td>
                    <td className="px-4 py-3 text-xs text-[#55667d]">
                      {s.counter_name || s.counter_id}
                      {s.cashier_name ? ` • ${s.cashier_name}` : ''}
                    </td>
                    <td className="px-4 py-3 text-xs">{s.payment_method}</td>
                    <td className="px-4 py-3 text-right font-semibold text-[#10243f]">{formatPkr(s.total_paisa)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge
                        variant={s.status === 'voided' ? 'danger' : s.status === 'completed' ? 'success' : 'warning'}
                        label={s.status}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between border-t border-[#dce6f4] px-4 py-3 text-xs text-[#55667d]">
            <span>
              Page {page} of {totalPages} ({total} total)
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
                className="rounded-lg border border-[#dce6f4] px-3 py-1 font-semibold text-[#10243f] disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                className="rounded-lg border border-[#dce6f4] px-3 py-1 font-semibold text-[#10243f] disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function SaleDetailScreen({
  saleId,
  onBack,
}: {
  saleId: string
  onBack: () => void
}) {
  const [detail, setDetail] = useState<SaleDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await cloudApi.getSaleDetail(saleId)
      setDetail(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load invoice details.')
    } finally {
      setLoading(false)
    }
  }, [saleId])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div>
      <PageHeader
        title={detail ? `Invoice ${detail.sale.invoice_number}` : 'Invoice Details'}
        subtitle={detail ? `Completed ${formatDateTime(detail.sale.completed_at)}` : 'Loading synced invoice...'}
        action={
          <button
            type="button"
            onClick={onBack}
            className="rounded-xl border border-[#dce6f4] bg-white px-3.5 py-2 text-xs font-semibold text-[#10243f] hover:bg-slate-50"
          >
            ← Back to Sales
          </button>
        }
      />

      <ErrorBanner message={error} onRetry={load} />

      {loading && !detail ? (
        <div className="h-64 animate-pulse rounded-2xl border border-[#dce6f4] bg-white" />
      ) : detail ? (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 rounded-2xl border border-[#dce6f4] bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-xs font-semibold uppercase text-[#55667d]">Customer</p>
              <p className="mt-1 font-semibold text-[#10243f]">{detail.sale.customer_name || 'Walk-in Customer'}</p>
              {detail.sale.customer_phone && <p className="text-xs text-[#55667d]">{detail.sale.customer_phone}</p>}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-[#55667d]">Counter &amp; Cashier</p>
              <p className="mt-1 font-semibold text-[#10243f]">{detail.sale.counter_name || detail.sale.counter_id}</p>
              <p className="text-xs text-[#55667d]">{detail.sale.cashier_name || detail.sale.cashier_id}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-[#55667d]">Payment Method</p>
              <p className="mt-1 font-semibold text-[#10243f]">{detail.sale.payment_method}</p>
              <StatusBadge variant={detail.sale.status === 'voided' ? 'danger' : 'success'} label={detail.sale.status} />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-[#55667d]">Invoice Total</p>
              <p className="font-display mt-1 text-xl font-bold text-[#6d4aff]">{formatPkr(detail.sale.total_paisa)}</p>
              <p className="text-xs text-[#55667d]">Paid: {formatPkr(detail.sale.paid_paisa)}</p>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-[#dce6f4] bg-white">
            <div className="border-b border-[#dce6f4] px-4 py-3">
              <h2 className="font-display text-sm font-bold text-[#10243f]">Line Items ({detail.items.length})</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-[#dce6f4] bg-[#f8fbff] text-xs font-semibold uppercase text-[#55667d]">
                  <tr>
                    <th className="px-4 py-2.5">Product</th>
                    <th className="px-4 py-2.5">SKU</th>
                    <th className="px-4 py-2.5 text-right">Qty</th>
                    <th className="px-4 py-2.5 text-right">Unit Price</th>
                    <th className="px-4 py-2.5 text-right">Line Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#edf2fa]">
                  {detail.items.map(item => (
                    <tr key={item.id}>
                      <td className="px-4 py-2.5 font-medium text-[#10243f]">{item.product_name_snapshot}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-[#55667d]">{item.sku_snapshot}</td>
                      <td className="px-4 py-2.5 text-right">{formatQty(item.quantity_milli, item.unit_snapshot)}</td>
                      <td className="px-4 py-2.5 text-right">{formatPkr(item.unit_price_paisa)}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-[#10243f]">{formatPkr(item.line_total_paisa)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col items-end gap-1 border-t border-[#dce6f4] bg-[#f8fbff] px-4 py-3 text-xs">
              <div className="flex w-52 justify-between">
                <span className="text-[#55667d]">Subtotal</span>
                <span className="font-semibold">{formatPkr(detail.sale.subtotal_paisa)}</span>
              </div>
              <div className="flex w-52 justify-between">
                <span className="text-[#55667d]">Discount</span>
                <span className="font-semibold">{formatPkr(detail.sale.discount_paisa)}</span>
              </div>
              <div className="flex w-52 justify-between">
                <span className="text-[#55667d]">Tax</span>
                <span className="font-semibold">{formatPkr(detail.sale.tax_paisa)}</span>
              </div>
              <div className="flex w-52 justify-between border-t border-[#dce6f4] pt-1 text-sm font-bold text-[#10243f]">
                <span>Total</span>
                <span>{formatPkr(detail.sale.total_paisa)}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-[#dce6f4] bg-white p-4">
              <h3 className="font-display mb-2 text-sm font-bold text-[#10243f]">Payments</h3>
              {detail.payments.length === 0 ? (
                <p className="text-xs text-[#55667d]">No split payment records synced.</p>
              ) : (
                <div className="space-y-2">
                  {detail.payments.map(p => (
                    <div key={p.id} className="flex items-center justify-between rounded-xl bg-[#f8fbff] px-3 py-2 text-xs">
                      <span>
                        <strong className="text-[#10243f]">{p.method}</strong> {p.reference ? `(${p.reference})` : ''}
                      </span>
                      <span className="font-semibold text-[#10243f]">{formatPkr(p.amount_paisa)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-[#dce6f4] bg-white p-4">
              <h3 className="font-display mb-2 text-sm font-bold text-[#10243f]">Main PC Hardware Actions</h3>
              <p className="mb-3 text-xs text-[#55667d]">
                Thermal receipt printing and physical cash drawer kick require local USB/LAN hardware attached to the shop Main PC.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled
                  title="Requires shop Main PC hardware"
                  className="cursor-not-allowed rounded-xl border border-[#dce6f4] bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-400"
                >
                  Print Receipt (Main PC Only)
                </button>
                <button
                  type="button"
                  disabled
                  title="Requires shop Main PC hardware"
                  className="cursor-not-allowed rounded-xl border border-[#dce6f4] bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-400"
                >
                  Open Cash Drawer (Main PC Only)
                </button>
              </div>
            </div>
          </div>

          {detail.returns.length > 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
              <h3 className="font-display mb-2 text-sm font-bold text-amber-900">Recorded Sale Returns</h3>
              <div className="space-y-1.5 text-xs">
                {detail.returns.map(r => (
                  <div key={r.id} className="flex justify-between">
                    <span>
                      {r.return_number} ({r.refund_method}) {r.note ? `— ${r.note}` : ''}
                    </span>
                    <span className="font-semibold">{formatPkr(r.total_paisa)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
