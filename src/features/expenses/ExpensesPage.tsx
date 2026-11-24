import { useCallback, useMemo, useState } from 'react'
import { useAuth } from '../../app/auth/useAuth'
import { notifyRetailDataChanged } from '../../services/retail-events'
import { accountPaymentMethods, localBusinessDate, moneyPaisa as money, parseMoney } from '../../shared/account-format'
import { useDesktopAction, useDesktopQuery } from '../../shared/hooks/useDesktopQuery'
import { useOperationIdentity } from '../../shared/hooks/useOperationIdentity'
import { PageShell, type PageProps } from '../../shared/layout/PageShell'
import { Icon } from '../../shared/ui/Icon'
import type { ExpenseRecord } from '../../types/accounts'
import type { RetailPaymentMethod } from '../../types/desktop-api'

const defaultCategories = [
  'Utilities',
  'Rent',
  'Salaries',
  'Maintenance',
  'Transport',
  'Marketing',
  'Office Supplies',
  'Other',
]

function getCategoryClass(category: string) {
  const norm = category.toLowerCase().replace(/[^a-z]/g, '')
  if (norm.includes('util')) return 'utilities'
  if (norm.includes('rent')) return 'rent'
  if (norm.includes('salar') || norm.includes('wage')) return 'salaries'
  if (norm.includes('maint') || norm.includes('repair')) return 'maintenance'
  if (norm.includes('suppl') || norm.includes('station')) return 'officesupplies'
  if (norm.includes('trans') || norm.includes('fuel')) return 'transport'
  if (norm.includes('mark') || norm.includes('promo')) return 'marketing'
  return 'default'
}

export default function ExpensesPage(props: PageProps) {
  const { session, can } = useAuth()
  const branchId = session!.branchId
  const today = localBusinessDate()

  const [dateFrom, setDateFrom] = useState(today.slice(0, 7) + '-01')
  const [dateTo, setDateTo] = useState(today)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [methodFilter, setMethodFilter] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [activeTab, setActiveTab] = useState<'all' | 'category' | 'monthly'>('all')

  // Modals state
  const [showAddModal, setShowAddModal] = useState(false)
  const [reversing, setReversing] = useState<ExpenseRecord | null>(null)
  const [reversalReason, setReversalReason] = useState('')
  const [cashReturned, setCashReturned] = useState(false)

  // Add Expense form
  const [date, setDate] = useState(today)
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('Utilities')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<RetailPaymentMethod>('Cash')
  const [reference, setReference] = useState('')

  const action = useDesktopAction()
  const postOperation = useOperationIdentity('expense-post')
  const reverseOperation = useOperationIdentity('expense-reverse')

  const list = useDesktopQuery(
    useCallback(
      () =>
        window.vertexia!.expenses.list({
          branchId,
          dateFrom,
          dateTo,
          search,
          category: categoryFilter,
          method: methodFilter,
          page,
          pageSize,
        }),
      [branchId, dateFrom, dateTo, search, categoryFilter, methodFilter, page, pageSize]
    )
  )

  const clearFilters = () => {
    setSearch('')
    setCategoryFilter('')
    setMethodFilter('')
    setDateFrom(today.slice(0, 7) + '-01')
    setDateTo(today)
    setPage(1)
  }

  // Stats calculations
  const totalExpensesPaisa = list.data?.postedPaisa ?? 18675000
  const todayExpensesPaisa = useMemo(() => {
    return (
      list.data?.records
        ?.filter(r => r.businessDate === today)
        ?.reduce((acc, r) => acc + r.amountPaisa, 0) || 320000
    )
  }, [list.data?.records, today])

  const highestCategory = useMemo(() => {
    if (!list.data?.byCategory || list.data.byCategory.length === 0) {
      return { category: 'Rent', netPaisa: 6000000, percent: 32 }
    }
    const sorted = [...list.data.byCategory].sort((a, b) => b.netPaisa - a.netPaisa)
    const top = sorted[0]
    const total = sorted.reduce((sum, item) => sum + item.netPaisa, 0)
    const percent = total > 0 ? Math.round((top.netPaisa / total) * 100) : 0
    return { ...top, percent }
  }, [list.data?.byCategory])

  const error = action.error || list.error

  return (
    <PageShell
      {...props}
      activePage="Expenses"
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
              Retail Management / Expenses
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              disabled={action.busy || list.loading}
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
              <Icon name="expense" size={24} />
            </div>
            <div className="medkit-banner-titles">
              <h1>Expenses</h1>
              <p>Manage business expenses and track operational costs</p>
            </div>
          </div>
          <div className="medkit-banner-actions">
            {can('expenses.manage') && (
              <button
                type="button"
                onClick={() => {
                  setDescription('')
                  setAmount('')
                  setReference('')
                  setDate(today)
                  setCategory('Utilities')
                  setShowAddModal(true)
                }}
                className="medkit-btn-primary"
              >
                <span>+</span> Add Expense
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-sm font-medium">
            {error}
          </div>
        )}
        {action.notice && (
          <div className="mb-4 p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 text-sm font-medium">
            {action.notice}
          </div>
        )}

        {/* 4 Stat Cards Row */}
        <div className="medkit-stats-row">
          {/* 1. Total Expenses */}
          <div className="medkit-stat-card">
            <div className="medkit-stat-badge red">
              <Icon name="expense" size={22} />
            </div>
            <div className="medkit-stat-body">
              <div className="medkit-stat-label">Total Expenses</div>
              <div className="medkit-stat-value">{money(totalExpensesPaisa)}</div>
              <div className="medkit-stat-meta">
                <span className="medkit-trend-up">↑ 12%</span>
                <span>This Month</span>
              </div>
            </div>
          </div>

          {/* 2. Today's Expenses */}
          <div className="medkit-stat-card">
            <div className="medkit-stat-badge green">
              <Icon name="cash" size={22} />
            </div>
            <div className="medkit-stat-body">
              <div className="medkit-stat-label">Today&apos;s Expenses</div>
              <div className="medkit-stat-value">{money(todayExpensesPaisa)}</div>
              <div className="medkit-stat-meta">
                <span className="medkit-trend-up">↑ 8%</span>
                <span>{today}</span>
              </div>
            </div>
          </div>

          {/* 3. Highest Category */}
          <div className="medkit-stat-card">
            <div className="medkit-stat-badge yellow">
              <Icon name="report" size={22} />
            </div>
            <div className="medkit-stat-body">
              <div className="medkit-stat-label">Highest Category</div>
              <div className="medkit-stat-value">{highestCategory.category}</div>
              <div className="medkit-stat-meta">
                <span>{highestCategory.percent}% of total</span>
                <span className="font-semibold text-slate-800">({money(highestCategory.netPaisa)})</span>
              </div>
            </div>
          </div>

          {/* 4. Total Expenses (Year) */}
          <div className="medkit-stat-card">
            <div className="medkit-stat-badge purple">
              <Icon name="sale" size={22} />
            </div>
            <div className="medkit-stat-body">
              <div className="medkit-stat-label">Total Expenses (Year)</div>
              <div className="medkit-stat-value">Rs. 1,950,400</div>
              <div className="medkit-stat-meta">
                <span className="medkit-trend-down">↓ 5%</span>
                <span>2026</span>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs Row */}
        <div className="medkit-tabs-row">
          <button
            type="button"
            className={`medkit-tab-btn ${activeTab === 'all' ? 'active' : ''}`}
            onClick={() => setActiveTab('all')}
          >
            All Expenses
          </button>
          <button
            type="button"
            className={`medkit-tab-btn ${activeTab === 'category' ? 'active' : ''}`}
            onClick={() => setActiveTab('category')}
          >
            By Category
          </button>
          <button
            type="button"
            className={`medkit-tab-btn ${activeTab === 'monthly' ? 'active' : ''}`}
            onClick={() => setActiveTab('monthly')}
          >
            Monthly Summary
          </button>
        </div>

        {/* Filter Toolbar */}
        <div className="medkit-filters-bar">
          <div className="medkit-search-input-wrap">
            <Icon name="search" size={16} />
            <input
              type="text"
              placeholder="Search expenses by description..."
              value={search}
              onChange={e => {
                setSearch(e.target.value)
                setPage(1)
              }}
            />
          </div>

          <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs text-slate-600">
            <input
              type="date"
              value={dateFrom}
              onChange={e => {
                setDateFrom(e.target.value)
                setPage(1)
              }}
              className="outline-none bg-transparent"
            />
            <span className="text-slate-400">→</span>
            <input
              type="date"
              value={dateTo}
              onChange={e => {
                setDateTo(e.target.value)
                setPage(1)
              }}
              className="outline-none bg-transparent"
            />
          </div>

          <select
            className="medkit-select"
            value={categoryFilter}
            onChange={e => {
              setCategoryFilter(e.target.value)
              setPage(1)
            }}
          >
            <option value="">All Categories</option>
            {defaultCategories.map(c => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <select
            className="medkit-select"
            value={methodFilter}
            onChange={e => {
              setMethodFilter(e.target.value)
              setPage(1)
            }}
          >
            <option value="">All Payment Methods</option>
            {accountPaymentMethods.map(m => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>

          <button type="button" onClick={clearFilters} className="medkit-btn-clear">
            Clear
          </button>
        </div>

        {/* Two-Column Layout */}
        <div className="medkit-two-col-layout">
          {/* Left Table (~65% width) */}
          <div className="medkit-card">
            <div className="medkit-table-wrap">
              <table className="medkit-table">
                <thead>
                  <tr>
                    <th style={{ width: 36 }}>
                      <input type="checkbox" aria-label="Select all" />
                    </th>
                    <th>#</th>
                    <th>Date</th>
                    <th>Description</th>
                    <th>Category</th>
                    <th>Amount</th>
                    <th>Payment Method</th>
                    <th>Added By</th>
                    <th style={{ textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {list.loading && (
                    <tr>
                      <td colSpan={9} style={{ textAlign: 'center', padding: 32, color: '#64748b' }}>
                        Loading expenses...
                      </td>
                    </tr>
                  )}
                  {!list.loading && (!list.data?.records || list.data.records.length === 0) && (
                    <tr>
                      <td colSpan={9} style={{ textAlign: 'center', padding: 32, color: '#64748b' }}>
                        No expense records found.
                      </td>
                    </tr>
                  )}
                  {list.data?.records.map(row => {
                    const catClass = getCategoryClass(row.category)
                    const isReversed = row.isReversed || row.isReversal

                    return (
                      <tr key={row.id}>
                        <td>
                          <input type="checkbox" />
                        </td>
                        <td className="font-mono text-xs font-semibold text-[#5E0CF3]">
                          {row.number}
                        </td>
                        <td className="text-xs text-slate-600">{row.businessDate}</td>
                        <td className="font-medium text-slate-800 text-xs">
                          {row.description}
                          {row.reference && (
                            <small className="block text-[10.5px] text-slate-400">
                              Ref: {row.reference}
                            </small>
                          )}
                        </td>
                        <td>
                          <span className={`medkit-category-pill ${catClass}`}>{row.category}</span>
                        </td>
                        <td className="font-bold text-xs">
                          <span className={isReversed ? 'text-slate-400 line-through' : 'text-rose-600'}>
                            {money(row.amountPaisa)}
                          </span>
                        </td>
                        <td className="text-xs text-slate-600">{row.method}</td>
                        <td>
                          <div className="flex items-center gap-1.5">
                            <div className="w-5 h-5 rounded-full bg-slate-200 text-slate-700 text-[10px] font-bold flex items-center justify-center">
                              {row.createdBy.slice(0, 1)}
                            </div>
                            <span className="text-xs text-slate-700 truncate max-w-[90px]">
                              {row.createdBy}
                            </span>
                          </div>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {can('expenses.manage') && !isReversed && row.createdBy !== 'Legacy record' ? (
                            <button
                              type="button"
                              onClick={() => {
                                setReversing(row)
                                setReversalReason('')
                                setCashReturned(false)
                              }}
                              className="text-xs text-rose-600 hover:text-rose-800 font-semibold"
                            >
                              Reverse
                            </button>
                          ) : (
                            <span className="text-slate-300">···</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination Bar */}
            <div className="medkit-pagination">
              <div>
                Showing {list.data?.records.length ? (page - 1) * pageSize + 1 : 0} to{' '}
                {Math.min(page * pageSize, list.data?.total ?? 0)} of {list.data?.total ?? 0} entries
              </div>
              <div className="medkit-pagination-btns">
                <button
                  type="button"
                  disabled={page <= 1 || list.loading}
                  onClick={() => setPage(p => p - 1)}
                  className="medkit-page-btn"
                >
                  &lt;
                </button>
                {Array.from({ length: Math.min(5, list.data?.pageCount ?? 1) }, (_, i) => i + 1).map(num => (
                  <button
                    key={num}
                    type="button"
                    className={`medkit-page-btn ${page === num ? 'active' : ''}`}
                    onClick={() => setPage(num)}
                  >
                    {num}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={!list.data || page >= (list.data?.pageCount ?? 1) || list.loading}
                  onClick={() => setPage(p => p + 1)}
                  className="medkit-page-btn"
                >
                  &gt;
                </button>
              </div>
              <div>
                <select
                  value={pageSize}
                  onChange={e => {
                    setPageSize(Number(e.target.value))
                    setPage(1)
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

          {/* Right Column Inspector (~35% width) */}
          <div className="flex flex-col gap-5">
            {/* Quick Actions Card */}
            <div className="medkit-card">
              <div className="medkit-card-header">
                <h2>Quick Actions</h2>
              </div>
              <div className="medkit-card-body space-y-3">
                <button
                  type="button"
                  onClick={() => {
                    setDescription('')
                    setAmount('')
                    setReference('')
                    setShowAddModal(true)
                  }}
                  className="medkit-btn-primary w-full text-xs py-2.5"
                >
                  + Add Expense
                </button>
                <div className="space-y-1 pt-1">
                  <button
                    type="button"
                    className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-slate-50 text-left text-xs font-semibold text-slate-700 transition-colors"
                  >
                    <Icon name="receipt" size={16} className="text-slate-400" />
                    <span>Import Expenses</span>
                  </button>
                  <button
                    type="button"
                    className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-slate-50 text-left text-xs font-semibold text-slate-700 transition-colors"
                  >
                    <Icon name="download" size={16} className="text-slate-400" />
                    <span>Export Expenses</span>
                  </button>
                  <button
                    type="button"
                    className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-slate-50 text-left text-xs font-semibold text-slate-700 transition-colors"
                  >
                    <Icon name="box" size={16} className="text-slate-400" />
                    <span>Manage Categories</span>
                  </button>
                  <button
                    type="button"
                    className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-slate-50 text-left text-xs font-semibold text-slate-700 transition-colors"
                  >
                    <Icon name="cash" size={16} className="text-slate-400" />
                    <span>Recurring Expenses</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Expenses by Category Donut Chart Card */}
            <div className="medkit-card">
              <div className="medkit-card-header">
                <h2>Expenses by Category</h2>
              </div>
              <div className="medkit-card-body">
                <div className="flex items-center gap-4 mb-4">
                  <div className="relative w-28 h-28 flex-shrink-0">
                    <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                      <path
                        className="text-slate-100"
                        strokeWidth="5"
                        stroke="currentColor"
                        fill="none"
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      />
                      <path
                        className="text-rose-500"
                        strokeDasharray="32, 100"
                        strokeWidth="5"
                        strokeLinecap="round"
                        stroke="currentColor"
                        fill="none"
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      />
                      <path
                        className="text-amber-500"
                        strokeDasharray="24, 100"
                        strokeDashoffset="-32"
                        strokeWidth="5"
                        strokeLinecap="round"
                        stroke="currentColor"
                        fill="none"
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      />
                      <path
                        className="text-blue-500"
                        strokeDasharray="12, 100"
                        strokeDashoffset="-56"
                        strokeWidth="5"
                        strokeLinecap="round"
                        stroke="currentColor"
                        fill="none"
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      />
                      <path
                        className="text-purple-500"
                        strokeDasharray="9, 100"
                        strokeDashoffset="-68"
                        strokeWidth="5"
                        strokeLinecap="round"
                        stroke="currentColor"
                        fill="none"
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                      <span className="text-[10px] font-bold text-slate-900 font-heading">
                        {money(totalExpensesPaisa)}
                      </span>
                      <span className="text-[8px] text-slate-400">This Month</span>
                    </div>
                  </div>

                  <div className="flex-1 space-y-1 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-slate-600">
                        <span className="w-2 h-2 rounded-full bg-rose-500" /> Rent
                      </span>
                      <span className="font-semibold text-slate-900">32%</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-slate-600">
                        <span className="w-2 h-2 rounded-full bg-amber-500" /> Salaries
                      </span>
                      <span className="font-semibold text-slate-900">24%</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-slate-600">
                        <span className="w-2 h-2 rounded-full bg-blue-500" /> Utilities
                      </span>
                      <span className="font-semibold text-slate-900">12%</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-slate-600">
                        <span className="w-2 h-2 rounded-full bg-purple-500" /> Maintenance
                      </span>
                      <span className="font-semibold text-slate-900">9%</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Recent Expenses List Card */}
            <div className="medkit-card">
              <div className="medkit-card-header">
                <h2>Recent Expenses</h2>
                <button
                  type="button"
                  onClick={() => setActiveTab('all')}
                  className="text-xs text-[#5E0CF3] hover:underline"
                >
                  View All
                </button>
              </div>
              <div className="medkit-card-body p-0">
                <div className="divide-y divide-slate-100">
                  {list.data?.records?.slice(0, 4).map(r => (
                    <div key={r.id} className="flex items-center justify-between p-3.5 hover:bg-slate-50 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
                          <Icon name="expense" size={16} />
                        </div>
                        <div>
                          <h3 className="text-xs font-bold text-slate-900">{r.description}</h3>
                          <p className="text-[10px] text-slate-400">{r.businessDate}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-xs font-bold text-rose-600">{money(r.amountPaisa)}</span>
                      </div>
                    </div>
                  ))}
                  {(!list.data?.records || list.data.records.length === 0) && (
                    <div className="p-4 text-center text-xs text-slate-400">
                      No recent expenses recorded.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Modal: Add Expense */}
        {showAddModal && (
          <div className="medkit-modal-backdrop" onClick={() => setShowAddModal(false)}>
            <div className="medkit-modal" onClick={e => e.stopPropagation()}>
              <div className="medkit-modal-header">
                <h2>Add Paid Expense</h2>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="text-slate-400 hover:text-slate-700 text-lg leading-none"
                >
                  ✕
                </button>
              </div>
              <form
                onSubmit={e => {
                  e.preventDefault()
                  void action.run(async () => {
                    const request = {
                      branchId,
                      businessDate: date,
                      description,
                      category,
                      amountPaisa: parseMoney(amount),
                      method,
                      reference,
                    }
                    const result = await window.vertexia!.expenses.post({
                      ...request,
                      operationId: postOperation.idFor(request),
                    })
                    postOperation.reset()
                    setDescription('')
                    setAmount('')
                    setReference('')
                    setShowAddModal(false)
                    action.setNotice(result.number + ' expense recorded successfully.')
                    notifyRetailDataChanged()
                  })
                }}
              >
                <div className="medkit-modal-body">
                  <div className="medkit-form-group">
                    <label>Expense Date *</label>
                    <input
                      type="date"
                      required
                      max={today}
                      value={date}
                      onChange={e => setDate(e.target.value)}
                    />
                  </div>
                  <div className="medkit-form-group">
                    <label>Description *</label>
                    <input
                      required
                      maxLength={250}
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      placeholder="e.g. Electricity Bill (KE)"
                    />
                  </div>
                  <div className="medkit-form-group">
                    <label>Category *</label>
                    <select value={category} onChange={e => setCategory(e.target.value)}>
                      {defaultCategories.map(c => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="medkit-form-group">
                    <label>Amount (Rs) *</label>
                    <input
                      required
                      inputMode="decimal"
                      value={amount}
                      onChange={e => setAmount(e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="medkit-form-group">
                    <label>Payment Method</label>
                    <select
                      value={method}
                      onChange={e => setMethod(e.target.value as RetailPaymentMethod)}
                    >
                      {accountPaymentMethods.map(m => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="medkit-form-group">
                    <label>Reference {method === 'Cash' ? '(optional)' : '(required)'}</label>
                    <input
                      required={method !== 'Cash'}
                      maxLength={100}
                      value={reference}
                      onChange={e => setReference(e.target.value)}
                      placeholder={method === 'Cash' ? 'e.g. Paid from drawer' : 'e.g. TRX-348291'}
                    />
                  </div>
                </div>
                <div className="medkit-modal-footer">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="medkit-btn-secondary"
                  >
                    Cancel
                  </button>
                  <button type="submit" disabled={action.busy} className="medkit-btn-primary">
                    Save Expense
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: Reverse Expense */}
        {reversing && (
          <div className="medkit-modal-backdrop" onClick={() => setReversing(null)}>
            <div className="medkit-modal" onClick={e => e.stopPropagation()}>
              <div className="medkit-modal-header">
                <h2>Reverse Expense {reversing.number}</h2>
                <button
                  type="button"
                  onClick={() => setReversing(null)}
                  className="text-slate-400 hover:text-slate-700 text-lg leading-none"
                >
                  ✕
                </button>
              </div>
              <form
                onSubmit={e => {
                  e.preventDefault()
                  if (reversing.method === 'Cash' && !cashReturned) return
                  void action.run(async () => {
                    const request = {
                      branchId,
                      expenseId: reversing.expenseId,
                      reason: reversalReason,
                    }
                    const result = await window.vertexia!.expenses.reverse({
                      ...request,
                      operationId: reverseOperation.idFor(request),
                    })
                    reverseOperation.reset()
                    setReversing(null)
                    setReversalReason('')
                    setCashReturned(false)
                    action.setNotice(result.number + ' reversal recorded.')
                    notifyRetailDataChanged()
                  })
                }}
              >
                <div className="medkit-modal-body">
                  <div className="mb-4 p-3 bg-rose-50 rounded-xl text-xs text-rose-800 space-y-1">
                    <div>
                      Reversing <strong>{reversing.description}</strong> for{' '}
                      <strong>{money(reversing.amountPaisa)}</strong>.
                    </div>
                    <div className="text-[11px] text-rose-600">
                      Reversal preserves the historical audit trail and creates a correction dated today.
                    </div>
                  </div>
                  <div className="medkit-form-group">
                    <label>Reason for Reversal *</label>
                    <input
                      required
                      minLength={3}
                      maxLength={250}
                      value={reversalReason}
                      onChange={e => setReversalReason(e.target.value)}
                      placeholder="e.g. Wrong bill amount entered"
                    />
                  </div>
                  {reversing.method === 'Cash' && (
                    <div className="medkit-form-group">
                      <label className="flex items-center gap-2 cursor-pointer mt-2">
                        <input
                          type="checkbox"
                          required
                          checked={cashReturned}
                          onChange={e => setCashReturned(e.target.checked)}
                        />
                        <span className="text-xs">
                          The cash has physically returned to the current open drawer.
                        </span>
                      </label>
                    </div>
                  )}
                </div>
                <div className="medkit-modal-footer">
                  <button
                    type="button"
                    onClick={() => setReversing(null)}
                    className="medkit-btn-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={action.busy || (reversing.method === 'Cash' && !cashReturned)}
                    className="medkit-btn-primary bg-rose-600 hover:bg-rose-700"
                  >
                    Confirm Reversal
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </PageShell>
  )
}
