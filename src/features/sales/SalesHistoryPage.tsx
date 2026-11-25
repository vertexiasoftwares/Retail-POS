import { useState } from 'react'
import { useAuth } from '../../app/auth/useAuth'
import { useEscapeKey } from '../../shared/hooks/useEscapeKey'
import { PageShell, type PageProps } from '../../shared/layout/PageShell'
import { TopNavHeader } from '../../shared/layout/TopNavHeader'
import { CustomSelect } from '../../shared/ui/CustomSelect'
import { DateRangeFilter } from '../../shared/ui/DateRangeFilter'
import { Icon } from '../../shared/ui/Icon'
import { exportToExcel } from '../../shared/utils/exportUtils'
import { triggerRefreshShimmer } from '../../services/retail-events'
import { useSales, type SalesController } from './useSales'

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

const statusLabel = (value: string) => value.replaceAll('_', ' ')

function BillDetailModal({ controller }: { controller: SalesController }) {
  const detail = controller.detail!
  useEscapeKey(() => controller.setDetail(null), Boolean(detail))

  return (
    <div className="medkit-modal-backdrop" onClick={() => controller.setDetail(null)}>
      <div className="medkit-modal medkit-modal-lg" onClick={e => e.stopPropagation()}>
        <div className="medkit-modal-header">
          <div>
            <h2>Bill {detail.invoiceNumber}</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {detail.businessName} · {detail.branchName}
            </p>
          </div>
          <button
            type="button"
            onClick={() => controller.setDetail(null)}
            className="text-slate-400 hover:text-slate-700 text-lg leading-none"
            aria-label="Close bill details"
          >
            ✕
          </button>
        </div>

        <div className="medkit-modal-body space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-100 text-xs">
            <div>
              <span className="text-slate-500 block">Date &amp; Time</span>
              <strong className="text-slate-800">{dateTime(detail.completedAt)}</strong>
            </div>
            <div>
              <span className="text-slate-500 block">Customer</span>
              <strong className="text-slate-800">{detail.customerName === 'Walk-in Customer' ? 'Cash Sale' : detail.customerName}</strong>
            </div>
            <div>
              <span className="text-slate-500 block">Cashier</span>
              <strong className="text-slate-800">{detail.cashierName}</strong>
            </div>
            <div>
              <span className="text-slate-500 block">Payment</span>
              <strong className="text-slate-800">{detail.paymentMethod}</strong>
            </div>
          </div>

          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm text-left table-auto">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Product</th>
                  <th className="py-3 px-3 text-right whitespace-nowrap">Sold Qty</th>
                  <th className="py-3 px-3 text-right whitespace-nowrap">Returned</th>
                  <th className="py-3 px-3 text-right whitespace-nowrap">Price</th>
                  <th className="py-3 px-3 text-right whitespace-nowrap">Discount</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">Total</th>
                </tr>
              </thead>
              <tbody>
                {detail.lines.map(line => (
                  <tr key={line.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-3 px-4 font-medium text-slate-800">{line.name}</td>
                    <td className="py-3 px-3 text-right whitespace-nowrap">{line.quantityMilli / 1000}</td>
                    <td className="py-3 px-3 text-right text-rose-600 whitespace-nowrap">
                      {line.returnedQuantityMilli > 0 ? line.returnedQuantityMilli / 1000 : '—'}
                    </td>
                    <td className="py-3 px-3 text-right whitespace-nowrap">{money(line.unitPricePaisa)}</td>
                    <td className="py-3 px-3 text-right text-slate-500 whitespace-nowrap">
                      {line.discountPaisa > 0 ? money(line.discountPaisa) : '—'}
                    </td>
                    <td className="py-3 px-4 text-right font-semibold text-slate-900 whitespace-nowrap">
                      {money(line.lineTotalPaisa)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-3 gap-3 p-3.5 rounded-xl bg-purple-50/70 border border-purple-100 text-xs">
            <div>
              <span className="text-slate-600 block">Original Total</span>
              <strong className="text-base text-slate-900">{money(detail.totalPaisa)}</strong>
            </div>
            <div>
              <span className="text-slate-600 block">Refunded</span>
              <strong className="text-base text-rose-600">{money(detail.returnedPaisa)}</strong>
            </div>
            <div>
              <span className="text-slate-600 block">Net Bill</span>
              <strong className="text-base text-[#5E0CF3]">{money(detail.netPaisa)}</strong>
            </div>
          </div>

          {detail.returns.length > 0 && (
            <div className="p-3 rounded-xl bg-amber-50/60 border border-amber-200/70 text-xs space-y-1.5">
              <strong className="text-amber-900 block">Return Records</strong>
              {detail.returns.map(r => (
                <div key={r.id} className="flex justify-between gap-3 text-amber-800">
                  <span>
                    <span className="font-mono font-semibold">{r.returnNumber}</span>
                    {r.reason ? ` · ${r.reason}` : ''}
                  </span>
                  <span className="font-bold whitespace-nowrap">
                    {money(r.totalPaisa)} ({r.refundMethod})
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="medkit-modal-footer">
          <button type="button" onClick={() => window.print()} className="medkit-btn-outline">
            <Icon name="receipt" size={15} /> Print Bill
          </button>
          <button type="button" onClick={() => controller.setDetail(null)} className="medkit-btn-primary">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export default function SalesHistoryPage(props: PageProps) {
  const { can } = useAuth()
  const controller = useSales()
  const { data } = controller
  const [pageSizeSelect, setPageSizeSelect] = useState(10)

  const handleDateChange = (range: {
    preset: 'today' | 'yesterday' | 'week' | 'month' | 'last_month' | 'custom'
    startDate: string
    endDate: string
  }) => {
    if (range.preset === 'today') controller.changePeriod('today')
    else if (range.preset === 'yesterday') controller.changePeriod('yesterday')
    else if (range.preset === 'week') controller.changePeriod('this_week')
    else if (range.preset === 'month') controller.changePeriod('this_month')
    else if (range.preset === 'last_month') controller.changePeriod('last_month')
    else if (range.preset === 'custom') controller.changePeriod('custom', range.startDate, range.endDate)
  }

  return (
    <PageShell
      {...props}
      activePage="Sales History"
      header={() => (
        <TopNavHeader
          title="Sales History"
          subtitle="Search every bill by bill number, customer, product or date"
          onNavigate={props.onNavigate}
          extraRight={
            <button
              type="button"
              disabled={controller.loading}
              onClick={() => {
                triggerRefreshShimmer()
                void controller.refresh()
              }}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                border: '1px solid #dce4ef',
                background: '#f8fafc',
                fontSize: 14,
                fontWeight: 600,
                color: '#475569',
                cursor: 'pointer',
              }}
            >
              Refresh
            </button>
          }
        />
      )}
    >
      <div className="medkit-page-container">
        <div className="medkit-top-banner">
          <div className="medkit-banner-left">
            <div className="medkit-banner-icon">
              <Icon name="receipt" size={24} />
            </div>
            <div className="medkit-banner-titles">
              <h1>Sales History</h1>
              <p>Complete chronological register of all store bills and receipts</p>
            </div>
          </div>
          <div className="medkit-banner-actions">
            <DateRangeFilter onChange={handleDateChange} />
            <button type="button" onClick={() => props.onNavigate('POS')} className="medkit-btn-primary">
              <Icon name="plus" size={16} /> New Sale
            </button>
          </div>
        </div>

        {controller.error && (
          <div className="mb-4 p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-sm font-medium flex items-center justify-between">
            <span>{controller.error}</span>
            <button type="button" onClick={() => void controller.refresh()} className="underline font-semibold text-xs">
              Retry
            </button>
          </div>
        )}

        <div className="medkit-stats-row">
          <div className="medkit-stat-card">
            <div className="medkit-stat-badge purple">
              <Icon name="receipt" size={22} />
            </div>
            <div className="medkit-stat-body">
              <div className="medkit-stat-label">Total Bills</div>
              <div className="medkit-stat-value">{data.transactionCount}</div>
              <div className="medkit-stat-meta">
                <span>{data.rangeLabel || 'Today'}</span>
              </div>
            </div>
          </div>

          <div className="medkit-stat-card">
            <div className="medkit-stat-badge green">
              <Icon name="money" size={22} />
            </div>
            <div className="medkit-stat-body">
              <div className="medkit-stat-label">Net Sales</div>
              <div className="medkit-stat-value">{money(data.totalSalesPaisa)}</div>
              <div className="medkit-stat-meta">
                <span>After returns &amp; discounts</span>
              </div>
            </div>
          </div>

          <div className="medkit-stat-card">
            <div className="medkit-stat-badge red">
              <Icon name="expense" size={22} />
            </div>
            <div className="medkit-stat-body">
              <div className="medkit-stat-label">Returns &amp; Refunds</div>
              <div className="medkit-stat-value">{money(data.returnsPaisa)}</div>
              <div className="medkit-stat-meta">
                <span>Total refunded in period</span>
              </div>
            </div>
          </div>

          <div className="medkit-stat-card">
            <div className="medkit-stat-badge blue">
              <Icon name="chart" size={22} />
            </div>
            <div className="medkit-stat-body">
              <div className="medkit-stat-label">Average Bill</div>
              <div className="medkit-stat-value">{money(data.averageOrderPaisa)}</div>
              <div className="medkit-stat-meta">
                <span>Per bill average</span>
              </div>
            </div>
          </div>
        </div>

        <div className="medkit-card">
          <div className="p-4 border-b border-slate-100 flex flex-wrap items-center gap-2.5 min-w-0">
            <div className="medkit-search-input-wrap flex-1 min-w-[200px]">
              <Icon name="search" size={16} />
              <input
                type="text"
                value={controller.search}
                onChange={e => controller.setSearch(e.target.value)}
                placeholder="Search Bill # (e.g. BILL-001), customer, or product..."
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <CustomSelect
                ariaLabel="Filter by payment method"
                value={controller.paymentMethod}
                onChange={val => controller.setPaymentMethod(val)}
                options={['all', 'Cash', 'Card', 'JazzCash', 'Easypaisa', 'Udhaar'].map(method => ({
                  value: method,
                  label: method === 'all' ? 'All Payments' : method,
                }))}
                minWidth={145}
              />

              <CustomSelect
                ariaLabel="Filter by bill status"
                value={controller.status}
                onChange={val => controller.setStatus(val as typeof controller.status)}
                options={[
                  { value: 'all', label: 'All Statuses' },
                  { value: 'completed', label: 'Completed' },
                  { value: 'partially_returned', label: 'Partially Returned' },
                  { value: 'returned', label: 'Returned' },
                ]}
                minWidth={165}
              />

              <button
                type="button"
                onClick={() => {
                  controller.setSearch('')
                  controller.setPaymentMethod('all')
                  controller.setStatus('all')
                }}
                className="medkit-btn-clear"
              >
                Clear
              </button>

              {can('data.export') && (
                <button
                  type="button"
                  disabled={controller.busy || controller.loading}
                  onClick={() =>
                    exportToExcel({
                      filename: `sales-history-${new Date().toISOString().slice(0, 10)}.xls`,
                      title: 'Sales Bill History Report',
                      subtitle: `${data.rangeLabel || 'Today'} | Net Sales: ${money(data.totalSalesPaisa)}`,
                      headers: ['Bill #', 'Date & Time', 'Customer', 'Cashier', 'Products', 'Items Count', 'Total (Rs)', 'Returned (Rs)', 'Net Amount (Rs)', 'Payment Method', 'Status'],
                      rows: data.sales.map(s => [
                        s.invoiceNumber,
                        dateTime(s.completedAt),
                        s.customerName,
                        s.cashierName,
                        s.itemNames || '',
                        s.itemCount,
                        (s.totalPaisa / 100).toFixed(2),
                        (s.returnedPaisa / 100).toFixed(2),
                        (s.netPaisa / 100).toFixed(2),
                        s.paymentMethod,
                        statusLabel(s.status),
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
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
                  </svg>
                  <span>Export Excel</span>
                </button>
              )}
            </div>
          </div>

          <div className="w-full max-w-full overflow-x-auto">
            <table className="medkit-table w-full">
              <thead>
                <tr>
                  <th>Bill #</th>
                  <th>Date &amp; Time</th>
                  <th>Customer</th>
                  <th>Products Purchased</th>
                  <th>Cashier</th>
                  <th style={{ textAlign: 'right' }}>Net Amount</th>
                  <th>Payment</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.sales.map(sale => (
                  <tr key={sale.id}>
                    <td>
                      <button
                        type="button"
                        onClick={() => void controller.openDetail(sale.id)}
                        className="font-mono text-xs font-bold text-[#5E0CF3] hover:underline bg-purple-50 px-2.5 py-1 rounded-md border border-purple-200/70"
                      >
                        {sale.invoiceNumber}
                      </button>
                    </td>
                    <td className="text-xs text-slate-600 whitespace-nowrap">{dateTime(sale.completedAt)}</td>
                    <td className="font-semibold text-slate-800">{sale.customerName === 'Walk-in Customer' ? '—' : sale.customerName}</td>
                    <td className="text-xs text-slate-600 max-w-[260px]">
                      <span className="font-semibold text-slate-700">{sale.itemCount} item(s):</span>{' '}
                      <span className="text-slate-500">{sale.itemNames || '—'}</span>
                    </td>
                    <td className="text-xs text-slate-600">{sale.cashierName}</td>
                    <td style={{ textAlign: 'right' }}>
                      <strong className="text-slate-900">{money(sale.netPaisa)}</strong>
                      {sale.returnedPaisa > 0 && (
                        <small className="block text-[10px] text-rose-600">
                          Returned {money(sale.returnedPaisa)}
                        </small>
                      )}
                    </td>
                    <td>
                      <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 text-[11px] font-semibold">
                        {sale.paymentMethod}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`medkit-status-pill ${
                          sale.status === 'completed'
                            ? 'active'
                            : sale.status === 'returned'
                            ? 'inactive'
                            : ''
                        }`}
                      >
                        {statusLabel(sale.status)}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={controller.busy}
                          onClick={() => void controller.openDetail(sale.id)}
                          className="medkit-btn-secondary py-1 px-2.5 text-xs"
                        >
                          View / Print
                        </button>
                        {can('sales.return') && sale.status !== 'returned' && sale.status !== 'voided' && (
                          <button
                            type="button"
                            onClick={() => {
                              try {
                                sessionStorage.setItem('vertexia_return_bill', sale.invoiceNumber)
                              } catch {}
                              props.onNavigate('Returns')
                            }}
                            className="medkit-btn-outline py-1 px-2.5 text-xs"
                          >
                            Return
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!data.sales.length && !controller.loading && (
                  <tr>
                    <td colSpan={9} className="py-10 text-center text-sm text-slate-400">
                      No bills found for the selected date range and filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="medkit-pagination">
            <div>
              Showing {data.sales.length ? (data.page - 1) * data.pageSize + 1 : 0} to{' '}
              {data.sales.length ? (data.page - 1) * data.pageSize + data.sales.length : 0} of {data.total} bills
            </div>
            <div className="medkit-pagination-btns">
              <button
                type="button"
                disabled={controller.page <= 1}
                onClick={() => controller.setPage(controller.page - 1)}
                className="medkit-page-btn"
              >
                &lt;
              </button>
              <button type="button" className="medkit-page-btn active">
                {data.page}
              </button>
              <button
                type="button"
                disabled={controller.page >= data.pageCount}
                onClick={() => controller.setPage(controller.page + 1)}
                className="medkit-page-btn"
              >
                &gt;
              </button>
            </div>
            <div>
              <select
                value={pageSizeSelect}
                onChange={e => {
                  const n = Number(e.target.value)
                  setPageSizeSelect(n)
                  controller.setPageSize(n)
                }}
                className="medkit-select py-1 text-xs"
              >
                <option value={10}>10 / page</option>
                <option value={25}>25 / page</option>
                <option value={50}>50 / page</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {controller.detail && <BillDetailModal controller={controller} />}
    </PageShell>
  )
}
