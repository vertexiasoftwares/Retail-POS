import { useCallback, useMemo, useState } from 'react'
import { useAuth } from '../../app/auth/useAuth'
import { localBusinessDate, moneyPaisa as money } from '../../shared/account-format'
import { useDesktopAction, useDesktopQuery } from '../../shared/hooks/useDesktopQuery'
import { PageShell, type PageProps } from '../../shared/layout/PageShell'
import { TopNavHeader } from '../../shared/layout/TopNavHeader'
import { Icon } from '../../shared/ui/Icon'
import { ExportDropdown } from '../../shared/ui/ExportDropdown'
import { DateRangeFilter, type DateRange } from '../../shared/ui/DateRangeFilter'
import { notifyRetailDataChanged, triggerRefreshShimmer } from '../../services/retail-events'
import type { ReportSection, ReportTable, ReportTrendGranularity, ReportTrendPoint } from '../../types/reports'

const reportTabs = [
  'Overview',
  'Sales',
  'Profit & Loss',
  'Inventory',
  'Purchases',
  'Customers',
  'Suppliers',
  'Expenses',
  'Staff / Shifts',
] as const

type ReportTab = (typeof reportTabs)[number]

const tabToSection: Record<ReportTab, ReportSection> = {
  Overview: 'overview',
  Sales: 'sales',
  'Profit & Loss': 'overview',
  Inventory: 'stock',
  Purchases: 'purchases',
  Customers: 'customers',
  Suppliers: 'suppliers',
  Expenses: 'expenses',
  'Staff / Shifts': 'shifts',
}

const CHART_COLORS = ['#5E0CF3', '#F59E0B', '#EC4899', '#10B981', '#3B82F6', '#8B5CF6', '#EF4444']

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(p => p[0] ?? '')
    .join('')
    .toUpperCase() || '?'

const formatQtyMilli = (qtyMilli: number, unit?: string) => {
  const num = Number((qtyMilli / 1000).toFixed(3))
  return unit ? `${num} ${unit}` : String(num)
}

const formatCompactPaisa = (paisa: number) => {
  const rupees = paisa / 100
  if (Math.abs(rupees) >= 1_000_000) return `${(rupees / 1_000_000).toFixed(1)}M`
  if (Math.abs(rupees) >= 1_000) return `${(rupees / 1_000).toFixed(0)}k`
  return String(Math.round(rupees))
}

function SalesTrendChart({
  points,
  granularity,
  onGranularityChange,
}: {
  points: ReportTrendPoint[]
  granularity: ReportTrendGranularity
  onGranularityChange: (g: ReportTrendGranularity) => void
}) {
  const maxVal = useMemo(() => {
    let peak = 0
    for (const p of points) {
      if (p.netSalesPaisa > peak) peak = p.netSalesPaisa
      if (p.salesPaisa > peak) peak = p.salesPaisa
    }
    return peak > 0 ? peak : 10000
  }, [points])

  const plotted = useMemo(() => {
    const left = 20
    const right = 480
    const top = 24
    const bottom = 166
    const height = bottom - top
    return points.map((p, index) => {
      const x = points.length === 1 ? (left + right) / 2 : left + (index / (points.length - 1)) * (right - left)
      const val = Math.max(0, p.netSalesPaisa)
      const y = bottom - (val / maxVal) * height
      return { ...p, x, y }
    })
  }, [points, maxVal])

  const linePath = useMemo(() => {
    if (plotted.length === 0) return ''
    return plotted.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  }, [plotted])

  const areaPath = useMemo(() => {
    if (plotted.length < 2) return ''
    return `${linePath} L ${plotted[plotted.length - 1].x.toFixed(1)} 166 L ${plotted[0].x.toFixed(1)} 166 Z`
  }, [linePath, plotted])

  const yTicks = [maxVal, Math.round(maxVal * 0.75), Math.round(maxVal * 0.5), Math.round(maxVal * 0.25), 0]

  const xLabels = useMemo(() => {
    if (plotted.length <= 7) return plotted
    const picks = 6
    const result: typeof plotted = []
    for (let i = 0; i < picks; i++) {
      const idx = Math.round((i / (picks - 1)) * (plotted.length - 1))
      result.push(plotted[idx])
    }
    return result
  }, [plotted])

  return (
    <div className="medkit-card">
      <div className="medkit-card-header">
        <h2>Sales Trend</h2>
        <select
          aria-label="Sales trend grouping"
          value={granularity}
          onChange={e => onGranularityChange(e.target.value as ReportTrendGranularity)}
          className="medkit-select py-1.5 text-sm"
        >
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </div>
      <div className="medkit-card-body">
        {points.length === 0 ? (
          <div className="h-56 flex flex-col items-center justify-center text-center gap-2">
            <Icon name="report" size={28} className="text-slate-500" />
            <p className="text-sm font-medium text-slate-700 m-0">
              No sales data recorded in the selected period.
            </p>
          </div>
        ) : (
          <div className="relative h-56 w-full flex gap-3">
            <div className="flex flex-col justify-between text-sm text-slate-700 font-mono pb-6 text-right min-w-[48px]">
              {yTicks.map((tick, idx) => (
                <span key={idx}>{formatCompactPaisa(tick)}</span>
              ))}
            </div>
            <div className="flex-1 flex flex-col min-w-0">
              <svg className="w-full flex-1" viewBox="0 0 500 185" preserveAspectRatio="none" aria-label="Sales trend chart">
                <defs>
                  <linearGradient id="realSalesGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#5E0CF3" stopOpacity="0.24" />
                    <stop offset="100%" stopColor="#5E0CF3" stopOpacity="0.0" />
                  </linearGradient>
                </defs>
                {[24, 60, 95, 130, 166].map(y => (
                  <line key={y} x1="10" y1={y} x2="490" y2={y} stroke="#e2e8f0" strokeWidth="1" />
                ))}
                {areaPath && <path d={areaPath} fill="url(#realSalesGrad)" />}
                {linePath && <path d={linePath} fill="none" stroke="#5E0CF3" strokeWidth="3" />}
                {plotted.map(p => (
                  <circle key={p.periodKey} cx={p.x} cy={p.y} r="4.5" fill="#5E0CF3">
                    <title>{`${p.label}: Net ${money(p.netSalesPaisa)} (Profit ${money(p.grossProfitPaisa)})`}</title>
                  </circle>
                ))}
              </svg>
              <div className="flex justify-between text-sm text-slate-700 font-mono pt-1 px-2">
                {xLabels.map(p => (
                  <span key={p.periodKey} className="truncate">{p.label}</span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function BreakdownDonut({
  title,
  centerLabel,
  totalPaisa,
  segments,
  emptyMessage,
}: {
  title: string
  centerLabel: string
  totalPaisa: number
  segments: Array<{ label: string; amountPaisa: number }>
  emptyMessage: string
}) {
  const positive = useMemo(
    () => segments.filter(s => s.amountPaisa > 0).slice(0, 6),
    [segments]
  )
  const positiveSum = useMemo(
    () => positive.reduce((acc, s) => acc + s.amountPaisa, 0),
    [positive]
  )

  return (
    <div className="medkit-card">
      <div className="medkit-card-header">
        <h2>{title}</h2>
      </div>
      <div className="medkit-card-body">
        {positive.length === 0 || positiveSum <= 0 ? (
          <div className="py-8 flex flex-col items-center justify-center text-center gap-2">
            <div className="text-base font-bold text-slate-900">{money(totalPaisa)}</div>
            <p className="text-sm text-slate-700 m-0">{emptyMessage}</p>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-5 w-full min-w-0">
            <div className="relative w-32 h-32 flex-shrink-0">
              <svg className="w-full h-full transform -rotate-90 overflow-visible" viewBox="0 0 42 42">
                <circle
                  className="text-slate-100"
                  cx="21"
                  cy="21"
                  r="15.9155"
                  strokeWidth="4.6"
                  stroke="currentColor"
                  fill="none"
                />
                {(() => {
                  let offset = 0
                  return positive.map((seg, idx) => {
                    const pct = (seg.amountPaisa / positiveSum) * 100
                    const dashOffset = -offset
                    offset += pct
                    return (
                      <circle
                        key={seg.label}
                        cx="21"
                        cy="21"
                        r="15.9155"
                        strokeWidth="4.6"
                        stroke={CHART_COLORS[idx % CHART_COLORS.length]}
                        strokeDasharray={`${pct} ${Math.max(0, 100 - pct)}`}
                        strokeDashoffset={dashOffset}
                        fill="none"
                      />
                    )
                  })
                })()}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-3">
                <span className="text-sm font-bold text-slate-900 font-heading leading-tight">
                  {money(totalPaisa)}
                </span>
                <span className="text-sm text-slate-600 leading-tight">{centerLabel}</span>
              </div>
            </div>

            <div className="flex-1 space-y-2 text-sm min-w-[180px]">
              {positive.map((seg, idx) => {
                const pct = Math.round((seg.amountPaisa / positiveSum) * 100)
                return (
                  <div key={seg.label} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <span className="flex items-center gap-2 text-slate-700 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }}
                      />
                      <span className="truncate">{seg.label}</span>
                    </span>
                    <span className="font-semibold text-slate-900 shrink-0">
                      {pct}% ({money(seg.amountPaisa)})
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ReportDataTable({
  table,
  loading,
  page,
  onPageChange,
}: {
  table: ReportTable | undefined
  loading: boolean
  page: number
  onPageChange: (nextPage: number) => void
}) {
  return (
    <div className="medkit-card">
      <div className="medkit-card-header">
        <h2>{table?.title ?? 'Report Records'}</h2>
        <span className="text-sm text-slate-700 font-medium">
          {table?.total ?? 0} {(table?.total ?? 0) === 1 ? 'record' : 'records'}
        </span>
      </div>
      <div className="medkit-table-wrap">
        <table className="medkit-table">
          <thead>
            <tr>
              {(table?.columns ?? []).map(col => (
                <th
                  key={col.key}
                  style={{
                    fontSize: 14,
                    textAlign: col.kind === 'money' || col.kind === 'quantity' ? 'right' : 'left',
                  }}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={Math.max(1, table?.columns.length ?? 1)} className="text-center py-8 text-sm text-slate-700">
                  Loading report data…
                </td>
              </tr>
            )}
            {!loading && (!table || table.rows.length === 0) && (
              <tr>
                <td colSpan={Math.max(1, table?.columns.length ?? 1)} className="text-center py-8 text-sm text-slate-700">
                  No records match the selected dates and branch scope.
                </td>
              </tr>
            )}
            {!loading &&
              table?.rows.map((row, rowIdx) => (
                <tr key={rowIdx} className="hover:bg-slate-50">
                  {table.columns.map(col => {
                    const raw = row[col.key]
                    const isNum = col.kind === 'money' || col.kind === 'quantity'
                    let display = String(raw ?? '-')
                    if (col.kind === 'money' && typeof raw === 'number') display = money(raw)
                    else if (col.kind === 'quantity' && typeof raw === 'number') display = formatQtyMilli(raw)
                    return (
                      <td
                        key={col.key}
                        className={`text-sm text-slate-800 ${isNum ? 'text-right font-semibold' : ''}`}
                      >
                        {display}
                      </td>
                    )
                  })}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {table && table.pageCount > 1 && (
        <div className="medkit-pagination" style={{ fontSize: 14, color: '#334155' }}>
          <div>
            Page {table.page} of {table.pageCount} ({table.total} entries)
          </div>
          <div className="medkit-pagination-btns">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => onPageChange(page - 1)}
              className="medkit-page-btn"
              aria-label="Previous report page"
            >
              &lt;
            </button>
            <button
              type="button"
              disabled={page >= table.pageCount || loading}
              onClick={() => onPageChange(page + 1)}
              className="medkit-page-btn"
              aria-label="Next report page"
            >
              &gt;
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function ReportsPage(props: PageProps) {
  const { session, can } = useAuth()
  const branchId = session!.branchId
  const today = localBusinessDate()

  const [activeTab, setActiveTab] = useState<ReportTab>('Overview')
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const start = today.slice(0, 7) + '-01'
    return { preset: 'month', startDate: start, endDate: today, label: 'This Month' }
  })
  const [trendGranularity, setTrendGranularity] = useState<ReportTrendGranularity>('daily')
  const [page, setPage] = useState(1)

  const dateFrom = dateRange.startDate
  const dateTo = dateRange.endDate
  const allBranches = false

  const section = tabToSection[activeTab]

  const result = useDesktopQuery(
    useCallback(
      () =>
        window.vertexia!.reports.snapshot({
          branchId,
          dateFrom,
          dateTo,
          section,
          allBranches,
          page,
          pageSize: 25,
          trendGranularity,
        }),
      [branchId, dateFrom, dateTo, section, allBranches, page, trendGranularity]
    )
  )

  const action = useDesktopAction()
  const data = result.data
  const summary = data?.summary

  const totalSalesPaisa = summary?.salesPaisa ?? 0
  const returnsPaisa = summary?.returnsPaisa ?? 0
  const netSalesPaisa = summary?.netSalesPaisa ?? 0
  const costPaisa = summary?.costPaisa ?? 0
  const grossProfitPaisa = summary?.grossProfitPaisa ?? 0
  const totalExpensesPaisa = summary?.expensesPaisa ?? 0
  const netProfitPaisa = summary?.operatingProfitPaisa ?? 0
  const invoiceCount = summary?.invoiceCount ?? 0
  const itemsSoldMilli = summary?.itemsSoldMilli ?? 0
  const averageInvoicePaisa = summary?.averageInvoicePaisa ?? 0
  const newCustomersCount = summary?.newCustomersCount ?? 0

  const grossMarginPercent = netSalesPaisa > 0 ? ((grossProfitPaisa / netSalesPaisa) * 100).toFixed(1) : '0.0'
  const expensePercent = netSalesPaisa > 0 ? ((totalExpensesPaisa / netSalesPaisa) * 100).toFixed(1) : '0.0'
  const netMarginPercent = netSalesPaisa > 0 ? ((netProfitPaisa / netSalesPaisa) * 100).toFixed(1) : '0.0'

  return (
    <PageShell
      {...props}
      activePage="Reports"
      header={() => (
        <TopNavHeader
          title="Reports & Analytics"
          subtitle="Financial summaries, P&L, sales and inventory audit"
          onNavigate={props.onNavigate}
          extraRight={
            <button
              type="button"
              disabled={result.loading}
              onClick={() => {
                triggerRefreshShimmer()
                notifyRetailDataChanged()
              }}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                border: '1px solid #cbd5e1',
                background: '#f8fafc',
                fontSize: 14,
                fontWeight: 600,
                color: '#334155',
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
        {/* Top Banner */}
        <div className="medkit-top-banner">
          <div className="medkit-banner-left">
            <div className="medkit-banner-icon">
              <Icon name="report" size={24} />
            </div>
            <div className="medkit-banner-titles">
              <h1>Reports</h1>
              <p>Live store numbers calculated directly from your SQLite ledger</p>
            </div>
          </div>
          <div className="medkit-banner-actions">
            <DateRangeFilter
              value={dateRange}
              onChange={range => {
                setDateRange(range)
                setPage(1)
              }}
            />

            {can('data.export') && data?.table && (
              <ExportDropdown
                label="Export Report"
                disabled={!data || result.loading || action.busy}
                data={() => ({
                  filename: `${activeTab.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-report-${dateFrom}-to-${dateTo}`,
                  title: `${data.businessName} - ${activeTab} Report`,
                  subtitle: `Branch: ${data.branchNames.join(', ')} | Period: ${dateFrom} to ${dateTo}`,
                  headers: data.table.columns.map(c => c.label),
                  rows: data.table.rows.map(row =>
                    data.table.columns.map(c => {
                      const val = row[c.key]
                      if (c.kind === 'money' && typeof val === 'number') return (val / 100).toFixed(2)
                      if (c.kind === 'quantity' && typeof val === 'number') return (val / 1000).toFixed(3)
                      return val ?? ''
                    })
                  ),
                })}
              />
            )}
          </div>
        </div>

        {action.notice && (
          <div className="mb-4 p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-sm font-medium" role="status">
            {action.notice}
          </div>
        )}
        {(result.error || action.error) && (
          <div className="mb-4 p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-sm font-medium" role="alert">
            {result.error || action.error}
          </div>
        )}

        {/* 4 Top KPI Cards Row */}
        <div className="medkit-stats-row">
          <div className="medkit-stat-card">
            <div className="medkit-stat-badge green">
              <Icon name="cart" size={22} />
            </div>
            <div className="medkit-stat-body">
              <div className="medkit-stat-label" style={{ fontSize: 14, color: '#475569' }}>Total Sales</div>
              <div className="medkit-stat-value">{money(totalSalesPaisa)}</div>
              <div className="medkit-stat-meta" style={{ fontSize: 14, color: '#475569' }}>
                <span>{invoiceCount} {invoiceCount === 1 ? 'invoice' : 'invoices'} &middot; Net {money(netSalesPaisa)}</span>
              </div>
            </div>
          </div>

          <div className="medkit-stat-card">
            <div className="medkit-stat-badge purple">
              <Icon name="box" size={22} />
            </div>
            <div className="medkit-stat-body">
              <div className="medkit-stat-label" style={{ fontSize: 14, color: '#475569' }}>Gross Profit</div>
              <div className="medkit-stat-value">{money(grossProfitPaisa)}</div>
              <div className="medkit-stat-meta" style={{ fontSize: 14, color: '#475569' }}>
                <span>{grossMarginPercent}% gross margin</span>
              </div>
            </div>
          </div>

          <div className="medkit-stat-card">
            <div className="medkit-stat-badge yellow">
              <Icon name="expense" size={22} />
            </div>
            <div className="medkit-stat-body">
              <div className="medkit-stat-label" style={{ fontSize: 14, color: '#475569' }}>Total Expenses</div>
              <div className="medkit-stat-value">{money(totalExpensesPaisa)}</div>
              <div className="medkit-stat-meta" style={{ fontSize: 14, color: '#475569' }}>
                <span>{expensePercent}% of net sales</span>
              </div>
            </div>
          </div>

          <div className="medkit-stat-card">
            <div className="medkit-stat-badge purple">
              <Icon name="cash" size={22} />
            </div>
            <div className="medkit-stat-body">
              <div className="medkit-stat-label" style={{ fontSize: 14, color: '#475569' }}>Net Operating Profit</div>
              <div className="medkit-stat-value">{money(netProfitPaisa)}</div>
              <div className="medkit-stat-meta" style={{ fontSize: 14, color: '#475569' }}>
                <span>{netMarginPercent}% net margin</span>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs Row */}
        <div className="medkit-tabs-row" role="tablist" aria-label="Report sections">
          {reportTabs.map(t => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={activeTab === t}
              className={`medkit-tab-btn ${activeTab === t ? 'active' : ''}`}
              style={{ fontSize: 14 }}
              onClick={() => {
                setActiveTab(t)
                setPage(1)
              }}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Overview Tab */}
        {activeTab === 'Overview' && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              <div className="lg:col-span-7">
                <SalesTrendChart
                  points={data?.salesTrend ?? []}
                  granularity={trendGranularity}
                  onGranularityChange={setTrendGranularity}
                />
              </div>
              <div className="lg:col-span-5">
                <BreakdownDonut
                  title="Sales by Category"
                  centerLabel="Net Sales"
                  totalPaisa={netSalesPaisa}
                  segments={(data?.categorySales ?? []).map(c => ({ label: c.category, amountPaisa: c.netSalesPaisa }))}
                  emptyMessage="No category sales recorded in this period."
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {/* Top Selling Products */}
              <div className="medkit-card">
                <div className="medkit-card-header">
                  <h2>Top Selling Products</h2>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('Inventory')
                      setPage(1)
                    }}
                    className="text-sm font-semibold text-[#5E0CF3] hover:underline"
                  >
                    View Stock
                  </button>
                </div>
                <div className="medkit-card-body p-0">
                  {!data?.topProducts?.length ? (
                    <div className="p-6 text-center text-sm text-slate-700">
                      No product sales in the selected period.
                    </div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-slate-700">
                        <tr>
                          <th className="py-2.5 px-3 text-left">#</th>
                          <th className="py-2.5 px-3 text-left">Product</th>
                          <th className="py-2.5 px-3 text-center">Qty</th>
                          <th className="py-2.5 px-3 text-right">Sales</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {data.topProducts.slice(0, 5).map((p, idx) => (
                          <tr key={p.productId} className="hover:bg-slate-50">
                            <td className="py-2.5 px-3 text-slate-600 font-mono">{idx + 1}</td>
                            <td className="py-2.5 px-3">
                              <span className="font-bold text-slate-900 block">{p.name}</span>
                              <span className="text-sm text-slate-600">{p.category}</span>
                            </td>
                            <td className="py-2.5 px-3 text-center font-medium text-slate-800">
                              {formatQtyMilli(p.quantityMilli, p.unit)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-bold text-slate-900">
                              {money(p.netSalesPaisa)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              {/* Payment Method Breakdown */}
              <BreakdownDonut
                title="Payment Method Breakdown"
                centerLabel="Net Collected"
                totalPaisa={netSalesPaisa}
                segments={(data?.payments ?? []).map(p => ({ label: p.method, amountPaisa: p.netSalesPaisa }))}
                emptyMessage="No payments recorded in this period."
              />

              {/* Sales by Staff */}
              <div className="medkit-card">
                <div className="medkit-card-header">
                  <h2>Sales by Staff</h2>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('Staff / Shifts')
                      setPage(1)
                    }}
                    className="text-sm font-semibold text-[#5E0CF3] hover:underline"
                  >
                    View Shifts
                  </button>
                </div>
                <div className="medkit-card-body p-0">
                  {!data?.staffSales?.length ? (
                    <div className="p-6 text-center text-sm text-slate-700">
                      No staff sales in the selected period.
                    </div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-slate-700">
                        <tr>
                          <th className="py-2.5 px-3 text-left">Staff Name</th>
                          <th className="py-2.5 px-3 text-center">Invoices</th>
                          <th className="py-2.5 px-3 text-right">Net Sales</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {data.staffSales.slice(0, 5).map((s, idx) => (
                          <tr key={s.userId} className="hover:bg-slate-50">
                            <td className="py-2.5 px-3">
                              <div className="flex items-center gap-2">
                                <span
                                  className="w-7 h-7 rounded-full text-white text-sm font-bold flex items-center justify-center shrink-0"
                                  style={{ backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }}
                                >
                                  {initials(s.name)}
                                </span>
                                <span className="font-bold text-slate-900 truncate">{s.name}</span>
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-center font-medium text-slate-800">{s.invoiceCount}</td>
                            <td className="py-2.5 px-3 text-right font-bold text-slate-900">
                              {money(s.netSalesPaisa)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              {/* Recent Sales Table */}
              <div className="lg:col-span-7 medkit-card">
                <div className="medkit-card-header">
                  <h2>Recent Sales</h2>
                  <button
                    type="button"
                    onClick={() => props.onNavigate('Sales History')}
                    className="text-sm font-semibold text-[#5E0CF3] hover:underline"
                  >
                    View All
                  </button>
                </div>
                <div className="medkit-table-wrap">
                  <table className="medkit-table">
                    <thead>
                      <tr>
                        <th style={{ fontSize: 14 }}>Date &amp; Time</th>
                        <th style={{ fontSize: 14 }}>Invoice #</th>
                        <th style={{ fontSize: 14 }}>Customer</th>
                        <th style={{ fontSize: 14 }}>Payment</th>
                        <th style={{ fontSize: 14, textAlign: 'right' }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {!data?.recentSales?.length ? (
                        <tr>
                          <td colSpan={5} className="text-center py-8 text-sm text-slate-700">
                            No sales recorded in the selected period.
                          </td>
                        </tr>
                      ) : (
                        data.recentSales.map(sale => (
                          <tr key={sale.id} className="hover:bg-slate-50">
                            <td className="text-sm text-slate-700">
                              {new Date(sale.completedAt).toLocaleString('en-PK', {
                                day: '2-digit',
                                month: 'short',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </td>
                            <td className="font-mono text-sm font-semibold text-[#5E0CF3]">{sale.invoiceNumber}</td>
                            <td className="text-sm font-medium text-slate-900">{sale.customerName}</td>
                            <td className="text-sm font-medium text-slate-800">{sale.paymentMethod}</td>
                            <td className="text-sm font-bold text-slate-900 text-right">{money(sale.totalPaisa)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Financial Summary Box */}
              <div className="lg:col-span-5 medkit-card">
                <div className="medkit-card-header">
                  <h2>Summary</h2>
                </div>
                <div className="medkit-card-body space-y-3 text-sm">
                  <div className="flex justify-between items-center text-slate-700">
                    <span>Gross Sales</span>
                    <span className="font-semibold text-slate-900">{money(totalSalesPaisa)}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-700">
                    <span>Returns &amp; Refunds</span>
                    <span className="font-semibold text-rose-700">- {money(returnsPaisa)}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-700">
                    <span>Net Sales</span>
                    <span className="font-semibold text-slate-900">{money(netSalesPaisa)}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-700">
                    <span>Cost of Goods Sold</span>
                    <span className="font-semibold text-slate-900">- {money(costPaisa)}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-700">
                    <span>Gross Profit</span>
                    <span className="font-semibold text-slate-900">{money(grossProfitPaisa)}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-700">
                    <span>Operating Expenses</span>
                    <span className="font-semibold text-rose-700">- {money(totalExpensesPaisa)}</span>
                  </div>

                  <div className="pt-2">
                    <div className="flex items-center justify-between p-3.5 rounded-xl bg-emerald-50 border border-emerald-200">
                      <span className="font-bold text-base text-emerald-950">Net Operating Profit</span>
                      <span className="font-bold text-base text-emerald-900 font-heading">
                        {money(netProfitPaisa)}
                      </span>
                    </div>
                  </div>

                  <div className="pt-2 grid grid-cols-2 gap-2.5 text-sm text-slate-700 border-t border-slate-200">
                    <div>Total Invoices: <strong className="text-slate-900">{invoiceCount}</strong></div>
                    <div>Net Qty Sold: <strong className="text-slate-900">{formatQtyMilli(itemsSoldMilli)}</strong></div>
                    <div>Avg. Invoice: <strong className="text-slate-900">{money(averageInvoicePaisa)}</strong></div>
                    <div>New Customers: <strong className="text-slate-900">{newCustomersCount}</strong></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Sales Tab */}
        {activeTab === 'Sales' && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              <div className="lg:col-span-7">
                <SalesTrendChart
                  points={data?.salesTrend ?? []}
                  granularity={trendGranularity}
                  onGranularityChange={setTrendGranularity}
                />
              </div>
              <div className="lg:col-span-5">
                <BreakdownDonut
                  title="Payment Method Breakdown"
                  centerLabel="Net Collected"
                  totalPaisa={netSalesPaisa}
                  segments={(data?.payments ?? []).map(p => ({ label: p.method, amountPaisa: p.netSalesPaisa }))}
                  emptyMessage="No payments recorded in this period."
                />
              </div>
            </div>
            <ReportDataTable table={data?.table} loading={result.loading} page={page} onPageChange={setPage} />
          </div>
        )}

        {/* Profit & Loss Tab */}
        {activeTab === 'Profit & Loss' && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              <div className="lg:col-span-7 medkit-card">
                <div className="medkit-card-header">
                  <h2>Profit &amp; Loss Statement</h2>
                  <span className="text-sm text-slate-700">{dateFrom} to {dateTo}</span>
                </div>
                <div className="medkit-card-body space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-700">Gross Sales Revenue</span>
                    <strong className="text-slate-900">{money(totalSalesPaisa)}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-700">Less: Sales &amp; Manual Returns</span>
                    <strong className="text-rose-700">- {money(returnsPaisa)}</strong>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-slate-200">
                    <span className="font-bold text-slate-900">Net Sales</span>
                    <strong className="text-slate-900">{money(netSalesPaisa)}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-700">Less: Cost of Goods Sold (Weighted Avg.)</span>
                    <strong className="text-slate-900">- {money(costPaisa)}</strong>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-slate-200">
                    <span className="font-bold text-slate-900">Gross Profit ({grossMarginPercent}% margin)</span>
                    <strong className="text-slate-900">{money(grossProfitPaisa)}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-700">Less: Paid Operating Expenses</span>
                    <strong className="text-rose-700">- {money(totalExpensesPaisa)}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-700">Stock Adjustment Cost Impact</span>
                    <strong className="text-slate-900">{money(summary?.stockAdjustmentCostPaisa ?? 0)}</strong>
                  </div>
                  <div className="flex items-center justify-between p-3.5 rounded-xl bg-emerald-50 border border-emerald-200">
                    <span className="font-bold text-base text-emerald-950">Net Operating Profit ({netMarginPercent}%)</span>
                    <strong className="text-base text-emerald-900">{money(netProfitPaisa)}</strong>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-5">
                <BreakdownDonut
                  title="Operating Expenses by Category"
                  centerLabel="Expenses"
                  totalPaisa={totalExpensesPaisa}
                  segments={(data?.expenseByCategory ?? []).map(c => ({ label: c.category, amountPaisa: c.netPaisa }))}
                  emptyMessage="No operating expenses recorded in this period."
                />
              </div>
            </div>
            <ReportDataTable table={data?.table} loading={result.loading} page={page} onPageChange={setPage} />
          </div>
        )}

        {/* Inventory Tab */}
        {activeTab === 'Inventory' && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div className="medkit-card p-4">
                <div className="text-sm text-slate-700">Total Inventory Value</div>
                <div className="text-xl font-bold text-slate-900 mt-1">{money(summary?.inventoryValuePaisa ?? 0)}</div>
              </div>
              <div className="medkit-card p-4">
                <div className="text-sm text-slate-700">Branch Stock Value</div>
                <div className="text-xl font-bold text-slate-900 mt-1">{money(summary?.valuePaisa ?? 0)}</div>
              </div>
              <div className="medkit-card p-4">
                <div className="text-sm text-slate-700">In-Transit Transfer Value</div>
                <div className="text-xl font-bold text-slate-900 mt-1">{money(summary?.inTransitValuePaisa ?? 0)}</div>
              </div>
              <div className="medkit-card p-4">
                <div className="text-sm text-slate-700">Tracked Products</div>
                <div className="text-xl font-bold text-slate-900 mt-1">{summary?.productCount ?? 0}</div>
              </div>
            </div>
            <ReportDataTable table={data?.table} loading={result.loading} page={page} onPageChange={setPage} />
          </div>
        )}

        {/* Purchases Tab */}
        {activeTab === 'Purchases' && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="medkit-card p-4">
                <div className="text-sm text-slate-700">Purchases in Period</div>
                <div className="text-xl font-bold text-slate-900 mt-1">{money(summary?.purchasesPaisa ?? 0)}</div>
              </div>
              <div className="medkit-card p-4">
                <div className="text-sm text-slate-700">Supplier Payments</div>
                <div className="text-xl font-bold text-slate-900 mt-1">{money(summary?.supplierPaymentsPaisa ?? 0)}</div>
              </div>
              <div className="medkit-card p-4">
                <div className="text-sm text-slate-700">Current Supplier Due</div>
                <div className="text-xl font-bold text-slate-900 mt-1">{money(summary?.supplierDuePaisa ?? 0)}</div>
              </div>
            </div>
            <ReportDataTable table={data?.table} loading={result.loading} page={page} onPageChange={setPage} />
          </div>
        )}

        {/* Customers Tab */}
        {activeTab === 'Customers' && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div className="medkit-card p-4">
                <div className="text-sm text-slate-700">Customer Due (Udhaar)</div>
                <div className="text-xl font-bold text-slate-900 mt-1">{money(summary?.customerDuePaisa ?? 0)}</div>
              </div>
              <div className="medkit-card p-4">
                <div className="text-sm text-slate-700">Collections in Period</div>
                <div className="text-xl font-bold text-slate-900 mt-1">{money(summary?.collectionsPaisa ?? 0)}</div>
              </div>
              <div className="medkit-card p-4">
                <div className="text-sm text-slate-700">Customer Advance Credit</div>
                <div className="text-xl font-bold text-slate-900 mt-1">{money(summary?.customerCreditPaisa ?? 0)}</div>
              </div>
              <div className="medkit-card p-4">
                <div className="text-sm text-slate-700">New Customers</div>
                <div className="text-xl font-bold text-slate-900 mt-1">{newCustomersCount}</div>
              </div>
            </div>
            <ReportDataTable table={data?.table} loading={result.loading} page={page} onPageChange={setPage} />
          </div>
        )}

        {/* Suppliers Tab */}
        {activeTab === 'Suppliers' && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div className="medkit-card p-4">
                <div className="text-sm text-slate-700">Supplier Due Now</div>
                <div className="text-xl font-bold text-slate-900 mt-1">{money(summary?.supplierDuePaisa ?? 0)}</div>
              </div>
              <div className="medkit-card p-4">
                <div className="text-sm text-slate-700">Purchases in Period</div>
                <div className="text-xl font-bold text-slate-900 mt-1">{money(summary?.purchasesPaisa ?? 0)}</div>
              </div>
              <div className="medkit-card p-4">
                <div className="text-sm text-slate-700">Payments in Period</div>
                <div className="text-xl font-bold text-slate-900 mt-1">{money(summary?.supplierPaymentsPaisa ?? 0)}</div>
              </div>
              <div className="medkit-card p-4">
                <div className="text-sm text-slate-700">Supplier Credit</div>
                <div className="text-xl font-bold text-slate-900 mt-1">{money(summary?.supplierCreditPaisa ?? 0)}</div>
              </div>
            </div>
            <ReportDataTable table={data?.table} loading={result.loading} page={page} onPageChange={setPage} />
          </div>
        )}

        {/* Expenses Tab */}
        {activeTab === 'Expenses' && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              <div className="lg:col-span-5">
                <BreakdownDonut
                  title="Expenses by Category"
                  centerLabel="Net Expenses"
                  totalPaisa={totalExpensesPaisa}
                  segments={(data?.expenseByCategory ?? []).map(c => ({ label: c.category, amountPaisa: c.netPaisa }))}
                  emptyMessage="No expenses recorded in this period."
                />
              </div>
              <div className="lg:col-span-7">
                <ReportDataTable table={data?.table} loading={result.loading} page={page} onPageChange={setPage} />
              </div>
            </div>
          </div>
        )}

        {/* Staff / Shifts Tab */}
        {activeTab === 'Staff / Shifts' && (
          <div className="space-y-5">
            <div className="medkit-card">
              <div className="medkit-card-header">
                <h2>Sales &amp; Returns by Staff</h2>
              </div>
              <div className="medkit-table-wrap">
                <table className="medkit-table">
                  <thead>
                    <tr>
                      <th style={{ fontSize: 14 }}>Staff Member</th>
                      <th style={{ fontSize: 14, textAlign: 'right' }}>Invoices</th>
                      <th style={{ fontSize: 14, textAlign: 'right' }}>Gross Sales</th>
                      <th style={{ fontSize: 14, textAlign: 'right' }}>Returns</th>
                      <th style={{ fontSize: 14, textAlign: 'right' }}>Net Sales</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!data?.staffSales?.length ? (
                      <tr>
                        <td colSpan={5} className="text-center py-8 text-sm text-slate-700">
                          No staff sales recorded in the selected period.
                        </td>
                      </tr>
                    ) : (
                      data.staffSales.map((s, idx) => (
                        <tr key={s.userId} className="hover:bg-slate-50">
                          <td>
                            <div className="flex items-center gap-2.5">
                              <span
                                className="w-7 h-7 rounded-full text-white text-sm font-bold flex items-center justify-center shrink-0"
                                style={{ backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }}
                              >
                                {initials(s.name)}
                              </span>
                              <span className="text-sm font-bold text-slate-900">{s.name}</span>
                            </div>
                          </td>
                          <td className="text-sm text-right text-slate-800">{s.invoiceCount}</td>
                          <td className="text-sm text-right text-slate-800">{money(s.salesPaisa)}</td>
                          <td className="text-sm text-right text-rose-700">{money(s.returnsPaisa)}</td>
                          <td className="text-sm text-right font-bold text-slate-900">{money(s.netSalesPaisa)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <ReportDataTable table={data?.table} loading={result.loading} page={page} onPageChange={setPage} />
          </div>
        )}
      </div>
    </PageShell>
  )
}
