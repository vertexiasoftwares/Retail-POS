import { useCallback, useEffect, useState } from 'react'
import { cloudApi, type DashboardPayload } from '../services/cloudApi'
import { formatDateTime, formatPkr, formatQty, formatRelativeSync } from '../utils/format'
import { ErrorBanner, KpiCard, PageHeader, StatusBadge, SyncBanner } from '../components/UiPrimitives'

export type NavTarget =
  | 'dashboard'
  | 'sales'
  | 'products'
  | 'inventory'
  | 'customers'
  | 'suppliers'
  | 'purchases'
  | 'expenses'
  | 'cash-shifts'
  | 'staff'
  | 'counters'
  | 'reports'
  | 'sync-status'
  | 'conflicts'
  | 'backups'
  | 'account'

export function DashboardScreen({
  refreshTick,
  onNavigate,
  onOpenSale,
}: {
  refreshTick: number
  onNavigate: (tab: NavTarget) => void
  onOpenSale: (saleId: string) => void
}) {
  const [data, setData] = useState<DashboardPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await cloudApi.getDashboard()
      setData(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshTick])

  const s = data?.summary

  return (
    <div>
      <PageHeader
        title={data ? `${data.businessName} — Cloud Overview` : 'Cloud Dashboard'}
        subtitle={
          data
            ? `${data.branchName}${data.city ? ` • ${data.city}` : ''} • Business Date ${data.todayBusinessDate}`
            : 'Synced summary available even when Main PC is offline'
        }
      />

      <SyncBanner mainPcLastSyncAt={data?.mainPcLastSyncAt} onRefresh={load} loading={loading} />
      <ErrorBanner message={error} onRetry={load} />

      {!data && loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div key={idx} className="h-24 animate-pulse rounded-2xl border border-[#dce6f4] bg-white" />
          ))}
        </div>
      ) : data && s ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <KpiCard
              tone="accent"
              label="Today's Sales"
              value={formatPkr(s.todaySalesPaisa)}
              hint={`${s.todaySalesCount} invoice(s) today`}
            />
            <KpiCard
              label="Today's Est. Profit"
              value={formatPkr(s.todayProfitPaisa)}
              hint="Synced revenue minus cost"
            />
            <KpiCard
              label="Total Net Sales"
              value={formatPkr(s.netSalesPaisa)}
              hint={`${s.invoiceCount} total invoices`}
            />
            <KpiCard
              label="Total Expenses"
              value={formatPkr(s.totalExpensesPaisa)}
              hint={`Today: ${formatPkr(s.todayExpensesPaisa)}`}
            />
            <KpiCard
              label="Open Shifts"
              value={String(s.openShiftsCount)}
              hint="Active cash drawers"
            />
            <KpiCard
              tone={s.lowStockCount > 0 ? 'warning' : 'success'}
              label="Low Stock Items"
              value={String(s.lowStockCount)}
              hint={s.lowStockCount > 0 ? 'Requires reorder review' : 'All stock above threshold'}
            />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-3">
            {/* Recent Sales */}
            <div className="rounded-2xl border border-[#dce6f4] bg-white p-4 shadow-xs lg:col-span-2">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-display text-base font-bold text-[#10243f]">Recent Synced Invoices</h2>
                <button
                  type="button"
                  onClick={() => onNavigate('sales')}
                  className="text-xs font-semibold text-[#6d4aff] hover:text-[#5835eb]"
                >
                  View All Sales →
                </button>
              </div>
              {data.recentSales.length === 0 ? (
                <p className="py-6 text-center text-xs text-[#55667d]">No synced invoices available yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-[#dce6f4] text-xs font-semibold uppercase text-[#55667d]">
                        <th className="py-2 pr-3">Invoice</th>
                        <th className="py-2 pr-3">Customer</th>
                        <th className="py-2 pr-3">Counter</th>
                        <th className="py-2 pr-3">Amount</th>
                        <th className="py-2">Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#edf2fa]">
                      {data.recentSales.map(sale => (
                        <tr
                          key={sale.id}
                          onClick={() => onOpenSale(sale.id)}
                          className="cursor-pointer transition hover:bg-[#f2f7fd]"
                        >
                          <td className="py-2.5 pr-3 font-semibold text-[#6d4aff]">{sale.invoiceNumber}</td>
                          <td className="py-2.5 pr-3 text-[#10243f]">{sale.customerName}</td>
                          <td className="py-2.5 pr-3 text-xs text-[#55667d]">{sale.counterId}</td>
                          <td className="py-2.5 pr-3 font-semibold text-[#10243f]">{formatPkr(sale.totalPaisa)}</td>
                          <td className="py-2.5 text-xs text-[#55667d]">{formatDateTime(sale.completedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Low Stock & Quick Counter Health */}
            <div className="space-y-5">
              <div className="rounded-2xl border border-[#dce6f4] bg-white p-4 shadow-xs">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="font-display text-base font-bold text-[#10243f]">Low Stock Alerts</h2>
                  <button
                    type="button"
                    onClick={() => onNavigate('inventory')}
                    className="text-xs font-semibold text-[#6d4aff]"
                  >
                    Adjust Stock →
                  </button>
                </div>
                {data.lowStockProducts.length === 0 ? (
                  <p className="py-4 text-center text-xs text-[#55667d]">No products at or below low-stock threshold.</p>
                ) : (
                  <div className="space-y-2.5">
                    {data.lowStockProducts.map(item => (
                      <div key={item.id} className="flex items-center justify-between rounded-xl bg-[#f8fbff] px-3 py-2">
                        <div className="min-w-0 pr-2">
                          <p className="truncate text-xs font-semibold text-[#10243f]">{item.name}</p>
                          <p className="text-[11px] text-[#55667d]">{item.sku}</p>
                        </div>
                        <StatusBadge
                          variant={item.quantityMilli <= 0 ? 'danger' : 'warning'}
                          label={formatQty(item.quantityMilli, item.unit)}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-[#dce6f4] bg-white p-4 shadow-xs">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="font-display text-base font-bold text-[#10243f]">Counters</h2>
                  <button
                    type="button"
                    onClick={() => onNavigate('counters')}
                    className="text-xs font-semibold text-[#6d4aff]"
                  >
                    Manage →
                  </button>
                </div>
                <div className="space-y-2">
                  {data.counters.map(c => {
                    const seen = formatRelativeSync(c.lastSeenAt)
                    return (
                      <div key={c.counterId} className="flex items-center justify-between rounded-xl border border-[#edf2fa] px-3 py-2 text-xs">
                        <div>
                          <p className="font-semibold text-[#10243f]">
                            #{c.counterNumber} {c.name}
                          </p>
                          <p className="text-[11px] text-[#55667d]">
                            {c.invoiceCount} sales • Seen {seen.label}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-[#10243f]">{formatPkr(c.salesPaisa)}</p>
                          <StatusBadge
                            variant={c.status === 'active' ? 'success' : 'danger'}
                            label={c.status}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>

          {data.recentExpenses.length > 0 && (
            <div className="mt-5 rounded-2xl border border-[#dce6f4] bg-white p-4 shadow-xs">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-display text-base font-bold text-[#10243f]">Recent Expenses</h2>
                <button
                  type="button"
                  onClick={() => onNavigate('expenses')}
                  className="text-xs font-semibold text-[#6d4aff]"
                >
                  All Expenses →
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
                {data.recentExpenses.map(exp => (
                  <div key={exp.id} className="rounded-xl border border-[#edf2fa] bg-[#f8fbff] p-3">
                    <p className="text-[11px] font-semibold uppercase text-[#6d4aff]">{exp.category}</p>
                    <p className="mt-0.5 truncate text-xs font-semibold text-[#10243f]">{exp.description || exp.expenseNumber}</p>
                    <p className="font-display mt-1 text-sm font-bold text-[#10243f]">{formatPkr(exp.amountPaisa)}</p>
                    <p className="mt-0.5 text-[11px] text-[#55667d]">{exp.businessDate}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  )
}
