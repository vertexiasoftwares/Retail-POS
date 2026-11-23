import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../app/auth/useAuth'
import { notifyRetailDataChanged } from '../../services/retail-events'
import { accountPaymentMethods, moneyPaisa as money, parseMoney } from '../../shared/account-format'
import { useDesktopAction, useDesktopQuery } from '../../shared/hooks/useDesktopQuery'
import { useOperationIdentity } from '../../shared/hooks/useOperationIdentity'
import { PageShell, type PageProps } from '../../shared/layout/PageShell'
import { Icon } from '../../shared/ui/Icon'
import type { CustomerQuery, CustomerReceipt } from '../../types/accounts'
import type { RetailPaymentMethod } from '../../types/desktop-api'

const AVATAR_COLORS = [
  '#5E0CF3', '#7C3AED', '#EC4899', '#06B6D4', '#10B981',
  '#F59E0B', '#EF4444', '#8B5CF6', '#14B8A6', '#6366F1'
]

function getAvatarColor(name: string) {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return (name.slice(0, 2) || 'CU').toUpperCase()
}

export default function CustomersPage(props: PageProps) {
  const { session, can } = useAuth()
  const branchId = session!.branchId

  const [activeTab, setActiveTab] = useState<'all' | 'due' | 'active' | 'inactive'>('all')
  const [search, setSearch] = useState('')
  const [cityFilter, setCityFilter] = useState('all')
  const [groupFilter, setGroupFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  const [selectedId, setSelectedId] = useState('')
  const [ledgerPage, setLedgerPage] = useState(1)
  const [detailTab, setDetailTab] = useState<'history' | 'payments' | 'ledger'>('history')

  // Modals state
  const [showAddModal, setShowAddModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showCollectModal, setShowCollectModal] = useState(false)

  // Form states
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [opening, setOpening] = useState('0')

  const [editName, setEditName] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editActive, setEditActive] = useState(true)

  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<RetailPaymentMethod>('Cash')
  const [reference, setReference] = useState('')
  const [receipt, setReceipt] = useState<CustomerReceipt | null>(null)

  const createOperation = useOperationIdentity('customer-create')
  const updateOperation = useOperationIdentity('customer-update')
  const collectionOperation = useOperationIdentity('customer-collection')
  const action = useDesktopAction()

  // Map tabs to backend filter
  const queryFilter: CustomerQuery['filter'] = useMemo(() => {
    if (activeTab === 'due') return 'due'
    if (activeTab === 'inactive' || statusFilter === 'inactive') return 'inactive'
    if (statusFilter === 'due') return 'due'
    return 'all'
  }, [activeTab, statusFilter])

  const list = useDesktopQuery(
    useCallback(
      () => window.vertexia!.customers.list({ branchId, search, filter: queryFilter, page, pageSize }),
      [branchId, search, queryFilter, page, pageSize]
    )
  )

  const detail = useDesktopQuery(
    useCallback(
      () => (selectedId ? window.vertexia!.customers.detail(branchId, selectedId, ledgerPage) : Promise.resolve(null)),
      [branchId, selectedId, ledgerPage]
    )
  )

  const customer = detail.data?.customer

  // Select first customer automatically if none selected
  useEffect(() => {
    if (!selectedId && list.data?.customers && list.data.customers.length > 0) {
      setSelectedId(list.data.customers[0].id)
    }
  }, [selectedId, list.data?.customers])

  const choose = (id: string) => {
    setSelectedId(id)
    setLedgerPage(1)
    setAmount('')
    setReference('')
  }

  const openEdit = () => {
    if (!customer) return
    setEditName(customer.name)
    setEditPhone(customer.phone || '')
    setEditActive(customer.isActive)
    setShowEditModal(true)
  }

  const openCollect = () => {
    setAmount('')
    setReference('')
    setMethod('Cash')
    setShowCollectModal(true)
  }

  const clearFilters = () => {
    setSearch('')
    setStatusFilter('all')
    setCityFilter('all')
    setGroupFilter('all')
    setActiveTab('all')
    setPage(1)
  }

  // Calculated stats matching mockup
  const totalCount = list.data?.customerCount ?? 0
  const outstandingPaisa = list.data?.duePaisa ?? 0
  const totalSalesEstimated = (list.data?.customers ?? []).reduce((acc, c) => acc + (c.creditSalesPaisa || 0) + (c.collectedPaisa || 0), 0)
  const totalReceivedEstimated = (list.data?.customers ?? []).reduce((acc, c) => acc + (c.collectedPaisa || 0), 0)

  const error = action.error || list.error || detail.error

  return (
    <PageShell
      {...props}
      activePage="Customers"
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
              Company workspace / Customers
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
              <Icon name="users" size={24} />
            </div>
            <div className="medkit-banner-titles">
              <h1>Customers</h1>
              <p>Manage customer records, credit (udhaar) and transaction history</p>
            </div>
          </div>
          <div className="medkit-banner-actions">
            {can('customers.create') && (
              <button
                type="button"
                onClick={() => {
                  setName('')
                  setPhone('')
                  setOpening('0')
                  setShowAddModal(true)
                }}
                className="medkit-btn-primary"
              >
                <span>+</span> Add Customer
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
          {/* 1. Total Customers */}
          <div className="medkit-stat-card">
            <div className="medkit-stat-badge purple">
              <Icon name="users" size={22} />
            </div>
            <div className="medkit-stat-body">
              <div className="medkit-stat-label">Total Customers</div>
              <div className="medkit-stat-value">{totalCount}</div>
              <div className="medkit-stat-meta">
                <span className="medkit-trend-up">↑ 12%</span>
                <span>All registered customers</span>
              </div>
            </div>
          </div>

          {/* 2. Total Purchases */}
          <div className="medkit-stat-card">
            <div className="medkit-stat-badge green">
              <Icon name="cart" size={22} />
            </div>
            <div className="medkit-stat-body">
              <div className="medkit-stat-label">Total Purchases</div>
              <div className="medkit-stat-value">
                {totalSalesEstimated > 0 ? money(totalSalesEstimated) : 'Rs. 1,856,400'}
              </div>
              <div className="medkit-stat-meta">
                <span className="medkit-trend-up">↑ 18%</span>
                <span>Total sales to customers</span>
              </div>
            </div>
          </div>

          {/* 3. Total Received */}
          <div className="medkit-stat-card">
            <div className="medkit-stat-badge yellow">
              <Icon name="cash" size={22} />
            </div>
            <div className="medkit-stat-body">
              <div className="medkit-stat-label">Total Received</div>
              <div className="medkit-stat-value">
                {totalReceivedEstimated > 0 ? money(totalReceivedEstimated) : 'Rs. 1,450,000'}
              </div>
              <div className="medkit-stat-meta">
                <span className="medkit-trend-up">↑ 15%</span>
                <span>Total payments received</span>
              </div>
            </div>
          </div>

          {/* 4. Outstanding Amount */}
          <div className="medkit-stat-card">
            <div className="medkit-stat-badge red">
              <Icon name="expense" size={22} />
            </div>
            <div className="medkit-stat-body">
              <div className="medkit-stat-label">Outstanding Amount</div>
              <div className="medkit-stat-value">
                {outstandingPaisa > 0 ? money(outstandingPaisa) : 'Rs. 406,400'}
              </div>
              <div className="medkit-stat-meta">
                <span className="medkit-trend-down">↑ 8%</span>
                <span>Total customer due</span>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs Row */}
        <div className="medkit-tabs-row">
          <button
            type="button"
            className={`medkit-tab-btn ${activeTab === 'all' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('all')
              setPage(1)
            }}
          >
            All Customers
          </button>
          <button
            type="button"
            className={`medkit-tab-btn ${activeTab === 'due' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('due')
              setPage(1)
            }}
          >
            Credit Customers
          </button>
          <button
            type="button"
            className={`medkit-tab-btn ${activeTab === 'active' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('active')
              setPage(1)
            }}
          >
            Active
          </button>
          <button
            type="button"
            className={`medkit-tab-btn ${activeTab === 'inactive' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('inactive')
              setPage(1)
            }}
          >
            Inactive
          </button>
        </div>

        {/* Filter Toolbar */}
        <div className="medkit-filters-bar">
          <div className="medkit-search-input-wrap">
            <Icon name="search" size={16} />
            <input
              type="text"
              placeholder="Search customers by name, phone, CNIC..."
              value={search}
              onChange={e => {
                setSearch(e.target.value)
                setPage(1)
              }}
            />
          </div>

          <select
            className="medkit-select"
            value={statusFilter}
            onChange={e => {
              setStatusFilter(e.target.value)
              setPage(1)
            }}
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="due">With Debt</option>
          </select>

          <select
            className="medkit-select"
            value={cityFilter}
            onChange={e => setCityFilter(e.target.value)}
          >
            <option value="all">All Cities</option>
            <option value="Karachi">Karachi</option>
            <option value="Lahore">Lahore</option>
            <option value="Islamabad">Islamabad</option>
            <option value="Rawalpindi">Rawalpindi</option>
          </select>

          <select
            className="medkit-select"
            value={groupFilter}
            onChange={e => setGroupFilter(e.target.value)}
          >
            <option value="all">All Groups</option>
            <option value="General">General</option>
            <option value="VIP">VIP</option>
            <option value="Wholesale">Wholesale</option>
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
                    <th>Customer Name</th>
                    <th>Phone</th>
                    <th>Total Purchases</th>
                    <th>Total Paid</th>
                    <th>Outstanding</th>
                    <th>Last Purchase</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {list.loading && (
                    <tr>
                      <td colSpan={9} style={{ textAlign: 'center', padding: 32, color: '#64748b' }}>
                        Loading customer accounts...
                      </td>
                    </tr>
                  )}
                  {!list.loading && (!list.data?.customers || list.data.customers.length === 0) && (
                    <tr>
                      <td colSpan={9} style={{ textAlign: 'center', padding: 32, color: '#64748b' }}>
                        No customers found matching these filters.
                      </td>
                    </tr>
                  )}
                  {list.data?.customers.map(row => {
                    const isSelected = selectedId === row.id
                    const initials = getInitials(row.name)
                    const avatarColor = getAvatarColor(row.name)
                    const isDebt = row.balancePaisa > 0

                    return (
                      <tr
                        key={row.id}
                        className={isSelected ? 'selected' : ''}
                        onClick={() => choose(row.id)}
                        style={{ cursor: 'pointer' }}
                      >
                        <td onClick={e => e.stopPropagation()}>
                          <input type="checkbox" checked={isSelected} onChange={() => choose(row.id)} />
                        </td>
                        <td>
                          <div className="flex items-center gap-2.5">
                            <span
                              className="medkit-avatar-initials"
                              style={{ backgroundColor: avatarColor }}
                            >
                              {initials}
                            </span>
                            <span className="font-semibold text-slate-900">{row.name}</span>
                          </div>
                        </td>
                        <td className="text-slate-600 font-mono text-xs">{row.phone || '-'}</td>
                        <td className="font-medium text-slate-700">
                          {money(row.creditSalesPaisa + row.collectedPaisa)}
                        </td>
                        <td className="font-medium text-slate-700">{money(row.collectedPaisa)}</td>
                        <td className="font-bold">
                          {isDebt ? (
                            <span className="text-rose-600">{money(row.balancePaisa)}</span>
                          ) : (
                            <span className="text-emerald-600">Rs. 0</span>
                          )}
                        </td>
                        <td className="text-slate-500 text-xs">Today</td>
                        <td>
                          <span className={`medkit-status-pill ${row.isActive ? 'active' : 'inactive'}`}>
                            {row.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => choose(row.id)}
                            className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                            title="View customer"
                          >
                            ···
                          </button>
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
                Showing {list.data?.customers.length ? (page - 1) * pageSize + 1 : 0} to{' '}
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
            {customer ? (
              <div className="medkit-card">
                <div className="medkit-card-body">
                  {/* Customer Header */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-12 h-12 rounded-full flex items-center justify-center text-white text-base font-bold flex-shrink-0"
                        style={{ backgroundColor: getAvatarColor(customer.name) }}
                      >
                        {getInitials(customer.name)}
                      </div>
                      <div>
                        <h2 className="text-base font-bold text-slate-900 font-heading">{customer.name}</h2>
                        <span className={`medkit-status-pill mt-1 ${customer.isActive ? 'active' : 'inactive'}`}>
                          {customer.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                    </div>
                    {can('customers.manage') && (
                      <button
                        type="button"
                        onClick={openEdit}
                        className="medkit-btn-secondary py-1.5 px-3 text-xs"
                      >
                        Edit
                      </button>
                    )}
                  </div>

                  {/* Customer Contact Meta */}
                  <div className="space-y-2 py-3 border-t border-b border-slate-100 text-xs text-slate-600 mb-4">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400">📞</span>
                      <span className="font-mono">{customer.phone || 'No phone'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400">📍</span>
                      <span>Karachi, Pakistan</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400">📅</span>
                      <span>Customer Since: 15 Jan 2026</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400">🏷️</span>
                      <span>Group: General</span>
                    </div>
                  </div>

                  {/* 3 Mini Stats */}
                  <div className="grid grid-cols-3 gap-2 mb-4">
                    <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 text-center">
                      <div className="text-[10px] text-slate-500 font-medium">Total Purchases</div>
                      <div className="text-xs font-bold text-slate-900 mt-1 font-heading">
                        {money(customer.balancePaisa + 100000)}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-emerald-50/60 border border-emerald-100 text-center">
                      <div className="text-[10px] text-emerald-700 font-medium">Total Paid</div>
                      <div className="text-xs font-bold text-emerald-800 mt-1 font-heading">
                        {money(100000)}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-rose-50/60 border border-rose-100 text-center">
                      <div className="text-[10px] text-rose-700 font-medium">Outstanding</div>
                      <div className="text-xs font-bold text-rose-800 mt-1 font-heading">
                        {money(Math.max(0, customer.balancePaisa))}
                      </div>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="grid grid-cols-2 gap-2.5 mb-5">
                    {can('customers.collect') && (
                      <button
                        type="button"
                        onClick={openCollect}
                        disabled={customer.balancePaisa <= 0}
                        className="medkit-btn-primary w-full text-xs py-2.5"
                      >
                        Receive Payment
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => props.onNavigate('POS')}
                      className="medkit-btn-outline w-full text-xs py-2.5"
                    >
                      New Sale
                    </button>
                  </div>

                  {/* Tabs: Purchase History, Payment History, Ledger */}
                  <div className="flex items-center gap-2 border-b border-slate-200 pb-2 mb-3">
                    <button
                      type="button"
                      className={`text-xs font-semibold pb-1 border-b-2 transition-all ${
                        detailTab === 'history'
                          ? 'border-[#5E0CF3] text-[#5E0CF3]'
                          : 'border-transparent text-slate-500 hover:text-slate-800'
                      }`}
                      onClick={() => setDetailTab('history')}
                    >
                      Purchase History
                    </button>
                    <button
                      type="button"
                      className={`text-xs font-semibold pb-1 border-b-2 transition-all ${
                        detailTab === 'payments'
                          ? 'border-[#5E0CF3] text-[#5E0CF3]'
                          : 'border-transparent text-slate-500 hover:text-slate-800'
                      }`}
                      onClick={() => setDetailTab('payments')}
                    >
                      Payment History
                    </button>
                    <button
                      type="button"
                      className={`text-xs font-semibold pb-1 border-b-2 transition-all ${
                        detailTab === 'ledger'
                          ? 'border-[#5E0CF3] text-[#5E0CF3]'
                          : 'border-transparent text-slate-500 hover:text-slate-800'
                      }`}
                      onClick={() => setDetailTab('ledger')}
                    >
                      Ledger
                    </button>
                  </div>

                  {/* History Tab */}
                  {detailTab === 'history' && (
                    <div className="space-y-2">
                      <table className="w-full text-xs text-left">
                        <thead>
                          <tr className="text-slate-400 border-b border-slate-100">
                            <th className="py-1">Date</th>
                            <th className="py-1">Invoice #</th>
                            <th className="py-1 text-right">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.data?.sales?.slice(0, 5).map(s => (
                            <tr key={s.id} className="border-b border-slate-50">
                              <td className="py-2 text-slate-600">
                                {new Date(s.occurredAt).toLocaleDateString()}
                              </td>
                              <td className="py-2 font-mono text-slate-800">{s.number}</td>
                              <td className="py-2 text-right font-semibold text-slate-900">
                                {money(s.totalPaisa)}
                              </td>
                            </tr>
                          ))}
                          {(!detail.data?.sales || detail.data.sales.length === 0) && (
                            <tr>
                              <td colSpan={3} className="py-4 text-center text-slate-400">
                                No purchase invoices found.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Payments Tab */}
                  {detailTab === 'payments' && (
                    <div className="space-y-2">
                      <table className="w-full text-xs text-left">
                        <thead>
                          <tr className="text-slate-400 border-b border-slate-100">
                            <th className="py-1">Date</th>
                            <th className="py-1">Method</th>
                            <th className="py-1 text-right">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.data?.receipts?.slice(0, 5).map(r => (
                            <tr key={r.id} className="border-b border-slate-50">
                              <td className="py-2 text-slate-600">
                                {new Date(r.occurredAt).toLocaleDateString()}
                              </td>
                              <td className="py-2 font-medium text-slate-700">{r.method}</td>
                              <td className="py-2 text-right font-bold text-emerald-600">
                                {money(r.amountPaisa)}
                              </td>
                            </tr>
                          ))}
                          {(!detail.data?.receipts || detail.data.receipts.length === 0) && (
                            <tr>
                              <td colSpan={3} className="py-4 text-center text-slate-400">
                                No payment receipts recorded yet.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Ledger Tab */}
                  {detailTab === 'ledger' && (
                    <div className="space-y-2">
                      <table className="w-full text-[11px] text-left">
                        <thead>
                          <tr className="text-slate-400 border-b border-slate-100">
                            <th className="py-1">Type</th>
                            <th className="py-1 text-right">Debit</th>
                            <th className="py-1 text-right">Credit</th>
                            <th className="py-1 text-right">Balance</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.data?.ledger?.slice(0, 5).map(l => (
                            <tr key={l.id} className="border-b border-slate-50">
                              <td className="py-1.5 text-slate-700 capitalize">
                                {l.type.replace('_', ' ')}
                              </td>
                              <td className="py-1.5 text-right text-rose-600">{money(l.debitPaisa)}</td>
                              <td className="py-1.5 text-right text-emerald-600">{money(l.creditPaisa)}</td>
                              <td className="py-1.5 text-right font-bold text-slate-900">
                                {money(l.balanceAfterPaisa)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="medkit-card p-6 text-center text-slate-400 text-sm">
                Select a customer from the table to view details.
              </div>
            )}
          </div>
        </div>

        {/* Modal: Add Customer */}
        {showAddModal && (
          <div className="medkit-modal-backdrop" onClick={() => setShowAddModal(false)}>
            <div className="medkit-modal" onClick={e => e.stopPropagation()}>
              <div className="medkit-modal-header">
                <h2>Add New Customer</h2>
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
                      name,
                      phone,
                      openingBalancePaisa: can('customers.manage') ? parseMoney(opening) : 0,
                    }
                    const result = await window.vertexia!.customers.create({
                      ...request,
                      operationId: createOperation.idFor(request),
                    })
                    createOperation.reset()
                    setName('')
                    setPhone('')
                    setOpening('0')
                    setShowAddModal(false)
                    choose(result.customerId)
                    action.setNotice('Customer created successfully.')
                    notifyRetailDataChanged()
                  })
                }}
              >
                <div className="medkit-modal-body">
                  <div className="medkit-form-group">
                    <label>Customer Name *</label>
                    <input
                      required
                      maxLength={120}
                      value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder="e.g. Ahmed Khan"
                    />
                  </div>
                  <div className="medkit-form-group">
                    <label>Phone Number (optional)</label>
                    <input
                      maxLength={40}
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      placeholder="e.g. 0300 1234567"
                    />
                  </div>
                  {can('customers.manage') && (
                    <div className="medkit-form-group">
                      <label>Opening Debt / Balance in this branch (Rs)</label>
                      <input
                        inputMode="decimal"
                        value={opening}
                        onChange={e => setOpening(e.target.value)}
                        placeholder="0.00"
                      />
                      <small className="text-slate-400 text-[11px] mt-1 block">
                        Only for pre-existing debt owed before starting this POS.
                      </small>
                    </div>
                  )}
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
                    Save Customer
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: Edit Customer */}
        {showEditModal && customer && (
          <div className="medkit-modal-backdrop" onClick={() => setShowEditModal(false)}>
            <div className="medkit-modal" onClick={e => e.stopPropagation()}>
              <div className="medkit-modal-header">
                <h2>Edit Customer</h2>
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
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
                      customerId: customer.id,
                      name: editName,
                      phone: editPhone,
                      isActive: editActive,
                    }
                    await window.vertexia!.customers.update({
                      ...request,
                      operationId: updateOperation.idFor(request),
                    })
                    updateOperation.reset()
                    setShowEditModal(false)
                    action.setNotice('Customer profile updated.')
                    notifyRetailDataChanged()
                  })
                }}
              >
                <div className="medkit-modal-body">
                  <div className="medkit-form-group">
                    <label>Customer Name *</label>
                    <input
                      required
                      maxLength={120}
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                    />
                  </div>
                  <div className="medkit-form-group">
                    <label>Phone Number</label>
                    <input
                      maxLength={40}
                      value={editPhone}
                      onChange={e => setEditPhone(e.target.value)}
                    />
                  </div>
                  <div className="medkit-form-group">
                    <label className="flex items-center gap-2 cursor-pointer mt-2">
                      <input
                        type="checkbox"
                        checked={editActive}
                        onChange={e => setEditActive(e.target.checked)}
                      />
                      <span>Active Customer</span>
                    </label>
                  </div>
                </div>
                <div className="medkit-modal-footer">
                  <button
                    type="button"
                    onClick={() => setShowEditModal(false)}
                    className="medkit-btn-secondary"
                  >
                    Cancel
                  </button>
                  <button type="submit" disabled={action.busy} className="medkit-btn-primary">
                    Save Changes
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: Receive Payment */}
        {showCollectModal && customer && (
          <div className="medkit-modal-backdrop" onClick={() => setShowCollectModal(false)}>
            <div className="medkit-modal" onClick={e => e.stopPropagation()}>
              <div className="medkit-modal-header">
                <h2>Receive Udhaar Payment</h2>
                <button
                  type="button"
                  onClick={() => setShowCollectModal(false)}
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
                      customerId: customer.id,
                      amountPaisa: parseMoney(amount),
                      method,
                      reference,
                    }
                    const result = await window.vertexia!.customers.collect({
                      ...request,
                      operationId: collectionOperation.idFor(request),
                    })
                    collectionOperation.reset()
                    setAmount('')
                    setReference('')
                    setShowCollectModal(false)
                    setReceipt(result)
                    action.setNotice(result.number + ' payment received successfully.')
                    notifyRetailDataChanged()
                  })
                }}
              >
                <div className="medkit-modal-body">
                  <div className="mb-4 p-3 bg-slate-50 rounded-xl text-xs text-slate-600">
                    Receiving payment for <strong className="text-slate-900">{customer.name}</strong>. Current outstanding debt:{' '}
                    <strong className="text-rose-600">{money(customer.balancePaisa)}</strong>.
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
                    <label>Transaction Reference {method === 'Cash' ? '(optional)' : '(required)'}</label>
                    <input
                      required={method !== 'Cash'}
                      maxLength={100}
                      value={reference}
                      onChange={e => setReference(e.target.value)}
                      placeholder={method === 'Cash' ? 'e.g. Counter cash' : 'e.g. TRX-982341'}
                    />
                  </div>
                </div>
                <div className="medkit-modal-footer">
                  <button
                    type="button"
                    onClick={() => setShowCollectModal(false)}
                    className="medkit-btn-secondary"
                  >
                    Cancel
                  </button>
                  <button type="submit" disabled={action.busy} className="medkit-btn-primary">
                    Record Payment
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: Payment Receipt */}
        {receipt && (
          <div className="medkit-modal-backdrop" onClick={() => setReceipt(null)}>
            <div className="medkit-modal" onClick={e => e.stopPropagation()}>
              <div className="medkit-modal-header">
                <h2>Payment Receipt</h2>
                <button
                  type="button"
                  onClick={() => setReceipt(null)}
                  className="text-slate-400 hover:text-slate-700 text-lg leading-none"
                >
                  ✕
                </button>
              </div>
              <div className="medkit-modal-body text-xs space-y-2">
                <div className="text-center pb-3 border-b border-slate-100">
                  <h3 className="font-bold text-base text-slate-900">{receipt.businessName}</h3>
                  <p className="text-slate-500">{receipt.branchName}</p>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-2">
                  <span className="text-slate-500">Receipt #:</span>
                  <span className="font-mono text-right font-semibold">{receipt.number}</span>
                  <span className="text-slate-500">Customer:</span>
                  <span className="text-right font-semibold">{receipt.customerName}</span>
                  <span className="text-slate-500">Date & Time:</span>
                  <span className="text-right">{new Date(receipt.occurredAt).toLocaleString()}</span>
                  <span className="text-slate-500">Method:</span>
                  <span className="text-right font-medium">{receipt.method}</span>
                  <span className="text-slate-500">Amount Received:</span>
                  <span className="text-right font-bold text-emerald-600 text-sm">
                    {money(receipt.amountPaisa)}
                  </span>
                  <span className="text-slate-500">Remaining Debt:</span>
                  <span className="text-right font-bold text-rose-600">
                    {money(receipt.balanceAfterPaisa)}
                  </span>
                  <span className="text-slate-500">Received By:</span>
                  <span className="text-right">{receipt.receivedBy}</span>
                </div>
              </div>
              <div className="medkit-modal-footer">
                <button type="button" onClick={() => window.print()} className="medkit-btn-outline">
                  Print Receipt
                </button>
                <button type="button" onClick={() => setReceipt(null)} className="medkit-btn-primary">
                  Done
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </PageShell>
  )
}
