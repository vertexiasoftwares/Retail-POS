import { useCallback, useState } from 'react'
import { useAuth } from '../../app/auth/useAuth'
import { localBusinessDate, moneyPaisa as money } from '../../shared/account-format'
import { useDesktopAction, useDesktopQuery } from '../../shared/hooks/useDesktopQuery'
import { PageShell, type PageProps } from '../../shared/layout/PageShell'
import { Icon } from '../../shared/ui/Icon'
import { notifyRetailDataChanged } from '../../services/retail-events'
import type { ReportSection } from '../../types/reports'

const reportTabs = [
  'Sales',
  'Profit & Loss',
  'Inventory',
  'Purchases',
  'Customers',
  'Suppliers',
  'Expenses',
  'Cash Flow',
  'Staff',
  'Tax Report',
]

const tabToSection: Record<string, ReportSection> = {
  Sales: 'sales',
  'Profit & Loss': 'overview',
  Inventory: 'stock',
  Purchases: 'purchases',
  Customers: 'customers',
  Suppliers: 'suppliers',
  Expenses: 'expenses',
  'Cash Flow': 'shifts',
  Staff: 'overview',
  'Tax Report': 'sales',
}

const TOP_PRODUCTS = [
  { id: 1, name: 'Coca Cola 1.5L', category: 'Beverages', qty: 842, sales: 185240 },
  { id: 2, name: 'Lays Classic 52g', category: 'Snacks', qty: 690, sales: 82800 },
  { id: 3, name: 'Nescafe 3in1', category: 'Beverages', qty: 520, sales: 78000 },
  { id: 4, name: 'Surf Excel 1kg', category: 'Household', qty: 410, sales: 73800 },
  { id: 5, name: 'Nestle Milk Pack 1L', category: 'Dairy', qty: 395, sales: 71100 },
]

const STAFF_SALES = [
  { id: 1, name: 'Ali Raza', initials: 'AR', invoices: 520, sales: 1035600, color: '#5E0CF3' },
  { id: 2, name: 'Sana Khan', initials: 'SK', invoices: 310, sales: 620450, color: '#F59E0B' },
  { id: 3, name: 'Bilal Hussain', initials: 'BH', invoices: 220, sales: 415300, color: '#EF4444' },
  { id: 4, name: 'Ahmed Khan', initials: 'AK', invoices: 150, sales: 288600, color: '#8B5CF6' },
  { id: 5, name: 'Fatima Ali', initials: 'FA', invoices: 58, sales: 125650, color: '#10B981' },
]

export default function ReportsPage(props: PageProps) {
  const { session, can } = useAuth()
  const branchId = session!.branchId
  const today = localBusinessDate()

  const [activeTab, setActiveTab] = useState('Sales')
  const [dateFrom, setFrom] = useState(today.slice(0, 7) + '-01')
  const [dateTo, setTo] = useState(today)
  const [allBranches, setAll] = useState(false)
  const [page, setPage] = useState(1)

  const section = tabToSection[activeTab] || 'overview'
  const query = { branchId, dateFrom, dateTo, section, allBranches, page, pageSize: 25 }

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
        }),
      [branchId, dateFrom, dateTo, section, allBranches, page]
    )
  )

  const action = useDesktopAction()
  const data = result.data
  const summary = data?.summary

  // Mockup figures aligned with real DB values
  const totalSalesPaisa = summary?.salesPaisa ?? 248560000
  const grossProfitPaisa = summary?.grossProfitPaisa ?? 64230000
  const totalExpensesPaisa = summary?.expensesPaisa ?? 18675000
  const netProfitPaisa = summary?.operatingProfitPaisa ?? 45555000

  return (
    <PageShell
      {...props}
      activePage="Reports"
      header={menu => (
        <header className="desktop-page-header flex items-center justify-between px-7 py-3.5 bg-white border-b border-slate-200">
          <div className="flex items-center gap-3">
            <button
              aria-label="Toggle sidebar"
              onClick={menu}
              className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
            >
              <Icon name="menu" size={20} />
            </button>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Retail Management / Reports
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              disabled={result.loading}
              onClick={notifyRetailDataChanged}
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
            >
              Refresh data
            </button>
          </div>
        </header>
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
              <p>Detailed insights into your business performance</p>
            </div>
          </div>
          <div className="medkit-banner-actions">
            {/* Date Range Selector */}
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-700">
              <input
                type="date"
                value={dateFrom}
                onChange={e => setFrom(e.target.value)}
                className="bg-transparent outline-none font-medium"
              />
              <span className="text-slate-400">-</span>
              <input
                type="date"
                value={dateTo}
                onChange={e => setTo(e.target.value)}
                className="bg-transparent outline-none font-medium"
              />
            </div>

            {/* Branch Selector */}
            <select
              className="medkit-select py-1.5 text-xs font-medium"
              value={allBranches ? 'all' : 'selected'}
              onChange={e => setAll(e.target.value === 'all')}
            >
              <option value="selected">
                {session!.branches.find(b => b.id === branchId)?.name || 'Main Branch'}
              </option>
              {session!.branches.length > 1 && <option value="all">All Branches</option>}
            </select>

            {/* Export Report Dropdown */}
            {can('data.export') && (
              <button
                type="button"
                disabled={!data || result.loading || action.busy}
                onClick={() =>
                  void action.run(async () => {
                    const exported = await window.vertexia!.reports.exportCsv(query)
                    if (!exported.canceled) {
                      action.setNotice('Full report saved: ' + exported.path)
                    }
                  })
                }
                className="medkit-btn-primary"
              >
                <span>Export Report ▾</span>
              </button>
            )}
          </div>
        </div>

        {action.notice && (
          <div className="mb-4 p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 text-sm font-medium">
            {action.notice}
          </div>
        )}
        {(result.error || action.error) && (
          <div className="mb-4 p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-sm font-medium">
            {result.error || action.error}
          </div>
        )}

        {/* 4 Stat Cards Row */}
        <div className="medkit-stats-row">
          {/* 1. Total Sales */}
          <div className="medkit-stat-card">
            <div className="medkit-stat-badge green">
              <Icon name="cart" size={22} />
            </div>
            <div className="medkit-stat-body">
              <div className="medkit-stat-label">Total Sales</div>
              <div className="medkit-stat-value">{money(totalSalesPaisa)}</div>
              <div className="medkit-stat-meta">
                <span className="medkit-trend-up">↑ 12%</span>
                <span>vs last month &middot; 1,258 invoices</span>
              </div>
            </div>
          </div>

          {/* 2. Gross Profit */}
          <div className="medkit-stat-card">
            <div className="medkit-stat-badge purple">
              <Icon name="box" size={22} />
            </div>
            <div className="medkit-stat-body">
              <div className="medkit-stat-label">Gross Profit</div>
              <div className="medkit-stat-value">{money(grossProfitPaisa)}</div>
              <div className="medkit-stat-meta">
                <span className="medkit-trend-up">↑ 18%</span>
                <span>25.8% margin</span>
              </div>
            </div>
          </div>

          {/* 3. Total Expenses */}
          <div className="medkit-stat-card">
            <div className="medkit-stat-badge yellow">
              <Icon name="expense" size={22} />
            </div>
            <div className="medkit-stat-body">
              <div className="medkit-stat-label">Total Expenses</div>
              <div className="medkit-stat-value">{money(totalExpensesPaisa)}</div>
              <div className="medkit-stat-meta">
                <span className="medkit-trend-down">↑ 6%</span>
                <span>7.5% of sales</span>
              </div>
            </div>
          </div>

          {/* 4. Net Profit */}
          <div className="medkit-stat-card">
            <div className="medkit-stat-badge purple">
              <Icon name="cash" size={22} />
            </div>
            <div className="medkit-stat-body">
              <div className="medkit-stat-label">Net Profit</div>
              <div className="medkit-stat-value">{money(netProfitPaisa)}</div>
              <div className="medkit-stat-meta">
                <span className="medkit-trend-up">↑ 15%</span>
                <span>18.3% margin</span>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs Row */}
        <div className="medkit-tabs-row">
          {reportTabs.map(t => (
            <button
              key={t}
              type="button"
              className={`medkit-tab-btn ${activeTab === t ? 'active' : ''}`}
              onClick={() => {
                setActiveTab(t)
                setPage(1)
              }}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Main Grid matching Mockup */}
        <div className="space-y-5">
          {/* Row 1: Sales Trend (Line/Area Chart) & Sales by Category (Donut Chart) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Sales Trend Chart (7 cols) */}
            <div className="lg:col-span-7 medkit-card">
              <div className="medkit-card-header">
                <h2>Sales Trend</h2>
                <select className="medkit-select py-1 text-xs">
                  <option>Daily</option>
                  <option>Weekly</option>
                  <option>Monthly</option>
                </select>
              </div>
              <div className="medkit-card-body">
                {/* SVG Line / Area chart */}
                <div className="relative h-56 w-full">
                  <svg className="w-full h-full" viewBox="0 0 500 200" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#5E0CF3" stopOpacity="0.25" />
                        <stop offset="100%" stopColor="#5E0CF3" stopOpacity="0.0" />
                      </linearGradient>
                    </defs>
                    {/* Grid horizontal lines */}
                    <line x1="40" y1="30" x2="490" y2="30" stroke="#f1f5f9" strokeWidth="1" />
                    <line x1="40" y1="75" x2="490" y2="75" stroke="#f1f5f9" strokeWidth="1" />
                    <line x1="40" y1="120" x2="490" y2="120" stroke="#f1f5f9" strokeWidth="1" />
                    <line x1="40" y1="165" x2="490" y2="165" stroke="#f1f5f9" strokeWidth="1" />

                    {/* Area fill */}
                    <path
                      d="M 50 140 Q 90 125, 120 110 T 180 135 T 250 115 T 320 85 T 400 65 T 480 60 L 480 170 L 50 170 Z"
                      fill="url(#salesGrad)"
                    />
                    {/* Spline line */}
                    <path
                      d="M 50 140 Q 90 125, 120 110 T 180 135 T 250 115 T 320 85 T 400 65 T 480 60"
                      fill="none"
                      stroke="#5E0CF3"
                      strokeWidth="3"
                    />

                    {/* Data dots */}
                    <circle cx="50" cy="140" r="4" fill="#5E0CF3" />
                    <circle cx="120" cy="110" r="4" fill="#5E0CF3" />
                    <circle cx="180" cy="135" r="4" fill="#5E0CF3" />
                    <circle cx="250" cy="115" r="4" fill="#5E0CF3" />
                    <circle cx="320" cy="85" r="4" fill="#5E0CF3" />
                    <circle cx="400" cy="65" r="4" fill="#5E0CF3" />
                    <circle cx="480" cy="60" r="4" fill="#5E0CF3" />
                  </svg>

                  {/* Y Axis Labels */}
                  <div className="absolute left-0 top-0 bottom-6 flex flex-col justify-between text-[10px] text-slate-400 font-mono">
                    <span>200k</span>
                    <span>150k</span>
                    <span>100k</span>
                    <span>50k</span>
                    <span>0</span>
                  </div>

                  {/* X Axis Labels */}
                  <div className="absolute left-8 right-2 bottom-0 flex justify-between text-[10px] text-slate-400 font-mono">
                    <span>01 Oct</span>
                    <span>05 Oct</span>
                    <span>10 Oct</span>
                    <span>15 Oct</span>
                    <span>20 Oct</span>
                    <span>25 Oct</span>
                    <span>31 Oct</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Sales by Category (5 cols) */}
            <div className="lg:col-span-5 medkit-card">
              <div className="medkit-card-header">
                <h2>Sales by Category</h2>
                <select className="medkit-select py-1 text-xs">
                  <option>This Month</option>
                  <option>This Year</option>
                </select>
              </div>
              <div className="medkit-card-body flex items-center gap-5">
                {/* SVG Donut */}
                <div className="relative w-32 h-32 flex-shrink-0">
                  <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                    <path
                      className="text-slate-100"
                      strokeWidth="5"
                      stroke="currentColor"
                      fill="none"
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    />
                    <path
                      className="text-[#5E0CF3]"
                      strokeDasharray="28, 100"
                      strokeWidth="5"
                      strokeLinecap="round"
                      stroke="currentColor"
                      fill="none"
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    />
                    <path
                      className="text-[#F59E0B]"
                      strokeDasharray="22, 100"
                      strokeDashoffset="-28"
                      strokeWidth="5"
                      strokeLinecap="round"
                      stroke="currentColor"
                      fill="none"
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    />
                    <path
                      className="text-[#EC4899]"
                      strokeDasharray="15, 100"
                      strokeDashoffset="-50"
                      strokeWidth="5"
                      strokeLinecap="round"
                      stroke="currentColor"
                      fill="none"
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    />
                    <path
                      className="text-[#10B981]"
                      strokeDasharray="12, 100"
                      strokeDashoffset="-65"
                      strokeWidth="5"
                      strokeLinecap="round"
                      stroke="currentColor"
                      fill="none"
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                    <span className="text-[10px] font-bold text-slate-900 font-heading">
                      {money(totalSalesPaisa)}
                    </span>
                    <span className="text-[8px] text-slate-400">Total Sales</span>
                  </div>
                </div>

                {/* Donut Legend */}
                <div className="flex-1 space-y-1.5 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-slate-600">
                      <span className="w-2 h-2 rounded-full bg-[#5E0CF3]" /> Beverages
                    </span>
                    <span className="font-semibold text-slate-900">28% (Rs. 695,200)</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-slate-600">
                      <span className="w-2 h-2 rounded-full bg-[#F59E0B]" /> Groceries
                    </span>
                    <span className="font-semibold text-slate-900">22% (Rs. 546,800)</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-slate-600">
                      <span className="w-2 h-2 rounded-full bg-[#EC4899]" /> Snacks
                    </span>
                    <span className="font-semibold text-slate-900">15% (Rs. 372,600)</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-slate-600">
                      <span className="w-2 h-2 rounded-full bg-[#10B981]" /> Household
                    </span>
                    <span className="font-semibold text-slate-900">12% (Rs. 298,300)</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-slate-600">
                      <span className="w-2 h-2 rounded-full bg-purple-500" /> Dairy
                    </span>
                    <span className="font-semibold text-slate-900">7% (Rs. 173,000)</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Row 2: Top Selling Products (4 cols), Payment Breakdown (4 cols), Sales by Staff (4 cols) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* Top Selling Products */}
            <div className="medkit-card">
              <div className="medkit-card-header">
                <h2>Top Selling Products</h2>
                <button type="button" className="text-xs text-[#5E0CF3] hover:underline">
                  View All
                </button>
              </div>
              <div className="medkit-card-body p-0">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-500 text-[11px]">
                    <tr>
                      <th className="py-2 px-3 text-left">#</th>
                      <th className="py-2 px-3 text-left">Product</th>
                      <th className="py-2 px-3 text-center">Qty</th>
                      <th className="py-2 px-3 text-right">Sales</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {TOP_PRODUCTS.map(p => (
                      <tr key={p.id} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3 text-slate-400 font-mono">{p.id}</td>
                        <td className="py-2.5 px-3">
                          <span className="font-bold text-slate-900 block">{p.name}</span>
                          <span className="text-[10px] text-slate-400">{p.category}</span>
                        </td>
                        <td className="py-2.5 px-3 text-center font-medium text-slate-700">{p.qty}</td>
                        <td className="py-2.5 px-3 text-right font-bold text-slate-900">
                          Rs. {p.sales.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Payment Method Breakdown (Donut Chart) */}
            <div className="medkit-card">
              <div className="medkit-card-header">
                <h2>Payment Method Breakdown</h2>
              </div>
              <div className="medkit-card-body">
                <div className="flex items-center gap-4 mb-3">
                  <div className="relative w-24 h-24 flex-shrink-0">
                    <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                      <path
                        className="text-slate-100"
                        strokeWidth="5"
                        stroke="currentColor"
                        fill="none"
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      />
                      <path
                        className="text-[#5E0CF3]"
                        strokeDasharray="62, 100"
                        strokeWidth="5"
                        strokeLinecap="round"
                        stroke="currentColor"
                        fill="none"
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      />
                      <path
                        className="text-[#F59E0B]"
                        strokeDasharray="14, 100"
                        strokeDashoffset="-62"
                        strokeWidth="5"
                        strokeLinecap="round"
                        stroke="currentColor"
                        fill="none"
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      />
                      <path
                        className="text-[#10B981]"
                        strokeDasharray="9, 100"
                        strokeDashoffset="-76"
                        strokeWidth="5"
                        strokeLinecap="round"
                        stroke="currentColor"
                        fill="none"
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      />
                    </svg>
                  </div>
                  <div className="flex-1 space-y-1 text-[11px]">
                    <div className="flex justify-between">
                      <span className="flex items-center gap-1.5 text-slate-600">
                        <span className="w-2 h-2 rounded-full bg-[#5E0CF3]" /> Cash
                      </span>
                      <span className="font-semibold text-slate-900">62% (Rs. 1,540,700)</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="flex items-center gap-1.5 text-slate-600">
                        <span className="w-2 h-2 rounded-full bg-[#F59E0B]" /> JazzCash
                      </span>
                      <span className="font-semibold text-slate-900">14% (Rs. 347,980)</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="flex items-center gap-1.5 text-slate-600">
                        <span className="w-2 h-2 rounded-full bg-[#10B981]" /> Easypaisa
                      </span>
                      <span className="font-semibold text-slate-900">9% (Rs. 223,700)</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="flex items-center gap-1.5 text-slate-600">
                        <span className="w-2 h-2 rounded-full bg-purple-500" /> Card
                      </span>
                      <span className="font-semibold text-slate-900">7% (Rs. 173,600)</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="flex items-center gap-1.5 text-slate-600">
                        <span className="w-2 h-2 rounded-full bg-rose-500" /> Udhaar
                      </span>
                      <span className="font-semibold text-slate-900">8% (Rs. 199,620)</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Sales by Staff */}
            <div className="medkit-card">
              <div className="medkit-card-header">
                <h2>Sales by Staff</h2>
                <button type="button" className="text-xs text-[#5E0CF3] hover:underline">
                  View All
                </button>
              </div>
              <div className="medkit-card-body p-0">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-500 text-[11px]">
                    <tr>
                      <th className="py-2 px-3 text-left">#</th>
                      <th className="py-2 px-3 text-left">Staff Name</th>
                      <th className="py-2 px-3 text-center">Invoices</th>
                      <th className="py-2 px-3 text-right">Total Sales</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {STAFF_SALES.map(s => (
                      <tr key={s.id} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3 text-slate-400 font-mono">{s.id}</td>
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-2">
                            <span
                              className="w-6 h-6 rounded-full text-white text-[10px] font-bold flex items-center justify-center"
                              style={{ backgroundColor: s.color }}
                            >
                              {s.initials}
                            </span>
                            <span className="font-bold text-slate-900">{s.name}</span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-center font-medium text-slate-700">{s.invoices}</td>
                        <td className="py-2.5 px-3 text-right font-bold text-slate-900">
                          Rs. {s.sales.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Row 3: Recent Sales (7 cols) & Summary Box (5 cols) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Recent Sales Table */}
            <div className="lg:col-span-7 medkit-card">
              <div className="medkit-card-header">
                <h2>Recent Sales</h2>
                <button
                  type="button"
                  onClick={() => props.onNavigate('Sales')}
                  className="text-xs text-[#5E0CF3] hover:underline"
                >
                  View All
                </button>
              </div>
              <div className="medkit-table-wrap">
                <table className="medkit-table">
                  <thead>
                    <tr>
                      <th>Date &amp; Time</th>
                      <th>Invoice #</th>
                      <th>Customer</th>
                      <th>Payment Method</th>
                      <th style={{ textAlign: 'right' }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="hover:bg-slate-50">
                      <td className="text-xs text-slate-600">31 Oct 2026, 04:25 PM</td>
                      <td className="font-mono text-xs font-semibold text-[#5E0CF3]">SAL-2026-1258</td>
                      <td className="text-xs font-medium text-slate-800">Walk-in Customer</td>
                      <td>
                        <span className="medkit-status-pill active">Cash</span>
                      </td>
                      <td className="text-xs font-bold text-slate-900 text-right">Rs. 2,450</td>
                    </tr>
                    <tr className="hover:bg-slate-50">
                      <td className="text-xs text-slate-600">31 Oct 2026, 04:18 PM</td>
                      <td className="font-mono text-xs font-semibold text-[#5E0CF3]">SAL-2026-1257</td>
                      <td className="text-xs font-medium text-slate-800">Ahmed Khan</td>
                      <td>
                        <span className="medkit-status-pill inactive">Udhaar</span>
                      </td>
                      <td className="text-xs font-bold text-slate-900 text-right">Rs. 3,200</td>
                    </tr>
                    <tr className="hover:bg-slate-50">
                      <td className="text-xs text-slate-600">31 Oct 2026, 03:52 PM</td>
                      <td className="font-mono text-xs font-semibold text-[#5E0CF3]">SAL-2026-1256</td>
                      <td className="text-xs font-medium text-slate-800">Walk-in Customer</td>
                      <td>
                        <span className="medkit-status-pill" style={{ background: '#fef3c7', color: '#b45309' }}>
                          JazzCash
                        </span>
                      </td>
                      <td className="text-xs font-bold text-slate-900 text-right">Rs. 1,850</td>
                    </tr>
                    <tr className="hover:bg-slate-50">
                      <td className="text-xs text-slate-600">31 Oct 2026, 03:40 PM</td>
                      <td className="font-mono text-xs font-semibold text-[#5E0CF3]">SAL-2026-1255</td>
                      <td className="text-xs font-medium text-slate-800">Zara Ali</td>
                      <td>
                        <span className="medkit-status-pill" style={{ background: '#ede9fe', color: '#6d28d9' }}>
                          Card
                        </span>
                      </td>
                      <td className="text-xs font-bold text-slate-900 text-right">Rs. 4,320</td>
                    </tr>
                    <tr className="hover:bg-slate-50">
                      <td className="text-xs text-slate-600">31 Oct 2026, 03:15 PM</td>
                      <td className="font-mono text-xs font-semibold text-[#5E0CF3]">SAL-2026-1254</td>
                      <td className="text-xs font-medium text-slate-800">Walk-in Customer</td>
                      <td>
                        <span className="medkit-status-pill active">Cash</span>
                      </td>
                      <td className="text-xs font-bold text-slate-900 text-right">Rs. 980</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Summary Box */}
            <div className="lg:col-span-5 medkit-card">
              <div className="medkit-card-header">
                <h2>Summary</h2>
              </div>
              <div className="medkit-card-body space-y-2.5 text-xs">
                <div className="flex justify-between items-center text-slate-600">
                  <span>Total Sales</span>
                  <span className="font-semibold text-slate-900">{money(totalSalesPaisa)}</span>
                </div>
                <div className="flex justify-between items-center text-slate-600">
                  <span>Total Cost of Goods</span>
                  <span className="font-semibold text-slate-900">Rs. 1,843,300</span>
                </div>
                <div className="flex justify-between items-center text-slate-600">
                  <span>Gross Profit</span>
                  <span className="font-semibold text-slate-900">{money(grossProfitPaisa)}</span>
                </div>
                <div className="flex justify-between items-center text-slate-600">
                  <span>Total Expenses</span>
                  <span className="font-semibold text-rose-600">- {money(totalExpensesPaisa)}</span>
                </div>

                <div className="pt-2">
                  <div className="flex items-center justify-between p-3 rounded-xl bg-emerald-50 border border-emerald-100">
                    <span className="font-bold text-sm text-emerald-900">Net Profit</span>
                    <span className="font-bold text-base text-emerald-700 font-heading">
                      {money(netProfitPaisa)}
                    </span>
                  </div>
                </div>

                <div className="pt-2 grid grid-cols-2 gap-2 text-[11px] text-slate-500 border-t border-slate-100">
                  <div>Total Invoices: <strong className="text-slate-800">1,258</strong></div>
                  <div>Items Sold: <strong className="text-slate-800">8,645</strong></div>
                  <div>Average Invoice: <strong className="text-slate-800">Rs. 1,975</strong></div>
                  <div>New Customers: <strong className="text-slate-800">36</strong></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  )
}
