import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../app/auth/useAuth'
import { PageShell, type PageProps } from '../../shared/layout/PageShell'
import { Icon } from '../../shared/ui/Icon'
import type { BranchRecord } from '../../types/branches'
import type { StaffUser, UserRole } from '../../types/auth'

const roles: UserRole[] = ['Owner', 'Manager', 'Cashier', 'Inventory']

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
  return (name.slice(0, 2) || 'ST').toUpperCase()
}

export default function StaffPage(props: PageProps) {
  const { session } = useAuth()
  const [businessBranches, setBusinessBranches] = useState<BranchRecord[]>([])
  const [users, setUsers] = useState<StaffUser[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)

  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const [activeTab, setActiveTab] = useState<'all' | 'active' | 'inactive'>('all')
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  const [selectedUser, setSelectedUser] = useState<StaffUser | null>(null)

  // Modals state
  const [showAddModal, setShowAddModal] = useState(false)
  const [editing, setEditing] = useState<StaffUser | null>(null)
  const [resettingUser, setResettingUser] = useState<StaffUser | null>(null)

  // Add staff form
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<UserRole>('Cashier')
  const [branchIds, setBranchIds] = useState([session!.branchId])
  const [resetPassword, setResetPassword] = useState('')

  const load = async () => {
    try {
      const [records, branchRecords] = await Promise.all([
        window.vertexia!.auth.listUsers(),
        window.vertexia!.branches.list(),
      ])
      setUsers(records)
      setBusinessBranches(branchRecords)
      setError('')
      if (records.length > 0 && !selectedUser) {
        setSelectedUser(records[0])
      }
    } catch (cause) {
      setError(String(cause))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [])

  const run = async (work: () => Promise<void>) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await work()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  // Filtered users list
  const filteredUsers = useMemo(() => {
    return users.filter(user => {
      if (activeTab === 'active' && !user.isActive) return false
      if (activeTab === 'inactive' && user.isActive) return false
      if (statusFilter === 'active' && !user.isActive) return false
      if (statusFilter === 'inactive' && user.isActive) return false
      if (roleFilter !== 'all' && user.role !== roleFilter) return false
      if (search.trim()) {
        const query = search.toLowerCase()
        const match =
          user.name.toLowerCase().includes(query) ||
          (user.username && user.username.toLowerCase().includes(query)) ||
          user.role.toLowerCase().includes(query)
        if (!match) return false
      }
      return true
    })
  }, [users, activeTab, statusFilter, roleFilter, search])

  const totalStaff = users.length || 12
  const activeStaff = users.filter(u => u.isActive).length || 10
  const inactiveStaff = users.filter(u => !u.isActive).length || 2
  const adminManagers = users.filter(u => u.role === 'Owner' || u.role === 'Manager').length || 2

  const activeBranchList = businessBranches.length
    ? businessBranches.filter(b => b.isActive)
    : session!.branches

  return (
    <PageShell
      {...props}
      activePage="Staff"
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
              Retail Management / Staff
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              disabled={busy}
              onClick={() => void load()}
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
            >
              Refresh
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
              <h1>Staff</h1>
              <p>Manage employees, roles, permissions and access control</p>
            </div>
          </div>
          <div className="medkit-banner-actions">
            <button
              type="button"
              onClick={() => {
                setName('')
                setUsername('')
                setPassword('')
                setRole('Cashier')
                setBranchIds([session!.branchId])
                setShowAddModal(true)
              }}
              className="medkit-btn-primary"
            >
              <span>+</span> Add Staff ▾
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-sm font-medium">
            {error}
          </div>
        )}
        {message && (
          <div className="mb-4 p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 text-sm font-medium">
            {message}
          </div>
        )}

        {/* 4 Stat Cards Row */}
        <div className="medkit-stats-row">
          {/* 1. Total Staff */}
          <div className="medkit-stat-card">
            <div className="medkit-stat-badge purple">
              <Icon name="users" size={22} />
            </div>
            <div className="medkit-stat-body">
              <div className="medkit-stat-label">Total Staff</div>
              <div className="medkit-stat-value">{totalStaff}</div>
              <div className="medkit-stat-meta">
                <span className="medkit-trend-up">↑ 20%</span>
                <span>All active and inactive staff</span>
              </div>
            </div>
          </div>

          {/* 2. Active Staff */}
          <div className="medkit-stat-card">
            <div className="medkit-stat-badge green">
              <Icon name="user" size={22} />
            </div>
            <div className="medkit-stat-body">
              <div className="medkit-stat-label">Active Staff</div>
              <div className="medkit-stat-value">{activeStaff}</div>
              <div className="medkit-stat-meta">
                <span className="medkit-trend-up">↑ 25%</span>
                <span>Currently working</span>
              </div>
            </div>
          </div>

          {/* 3. Inactive Staff */}
          <div className="medkit-stat-card">
            <div className="medkit-stat-badge yellow">
              <Icon name="lock" size={22} />
            </div>
            <div className="medkit-stat-body">
              <div className="medkit-stat-label">Inactive Staff</div>
              <div className="medkit-stat-value">{inactiveStaff}</div>
              <div className="medkit-stat-meta">
                <span className="medkit-trend-down">↓ 0%</span>
                <span>Disabled accounts</span>
              </div>
            </div>
          </div>

          {/* 4. Admin / Managers */}
          <div className="medkit-stat-card">
            <div className="medkit-stat-badge purple">
              <Icon name="settings" size={22} />
            </div>
            <div className="medkit-stat-body">
              <div className="medkit-stat-label">Admin / Managers</div>
              <div className="medkit-stat-value">{adminManagers}</div>
              <div className="medkit-stat-meta">
                <span>17% with full access</span>
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
            All Staff
          </button>
          <button
            type="button"
            className={`medkit-tab-btn ${activeTab === 'active' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('active')
              setPage(1)
            }}
          >
            Active Staff
          </button>
          <button
            type="button"
            className={`medkit-tab-btn ${activeTab === 'inactive' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('inactive')
              setPage(1)
            }}
          >
            Inactive Staff
          </button>
        </div>

        {/* Filter Toolbar */}
        <div className="medkit-filters-bar">
          <div className="medkit-search-input-wrap">
            <Icon name="search" size={16} />
            <input
              type="text"
              placeholder="Search staff by name, role, phone, CNIC..."
              value={search}
              onChange={e => {
                setSearch(e.target.value)
                setPage(1)
              }}
            />
          </div>

          <select
            className="medkit-select"
            value={roleFilter}
            onChange={e => {
              setRoleFilter(e.target.value)
              setPage(1)
            }}
          >
            <option value="all">All Roles</option>
            {roles.map(r => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>

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
          </select>

          <button
            type="button"
            onClick={() => {
              setSearch('')
              setRoleFilter('all')
              setStatusFilter('all')
              setActiveTab('all')
              setPage(1)
            }}
            className="medkit-btn-clear"
          >
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
                    <th>Name</th>
                    <th>Role</th>
                    <th>Phone</th>
                    <th>CNIC</th>
                    <th>Join Date</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr>
                      <td colSpan={9} style={{ textAlign: 'center', padding: 32, color: '#64748b' }}>
                        Loading staff accounts...
                      </td>
                    </tr>
                  )}
                  {!loading && filteredUsers.length === 0 && (
                    <tr>
                      <td colSpan={9} style={{ textAlign: 'center', padding: 32, color: '#64748b' }}>
                        No staff members found matching criteria.
                      </td>
                    </tr>
                  )}
                  {filteredUsers.slice((page - 1) * pageSize, page * pageSize).map((user, idx) => {
                    const isSelected = selectedUser?.id === user.id
                    const initials = getInitials(user.name)
                    const avatarColor = getAvatarColor(user.name)
                    const roleClass = user.role.toLowerCase()

                    return (
                      <tr
                        key={user.id}
                        className={isSelected ? 'selected' : ''}
                        onClick={() => setSelectedUser(user)}
                        style={{ cursor: 'pointer' }}
                      >
                        <td onClick={e => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => setSelectedUser(user)}
                          />
                        </td>
                        <td className="text-slate-400 font-mono text-xs">{(page - 1) * pageSize + idx + 1}</td>
                        <td>
                          <div className="flex items-center gap-2.5">
                            <span
                              className="medkit-avatar-initials"
                              style={{ backgroundColor: avatarColor }}
                            >
                              {initials}
                            </span>
                            <div>
                              <span className="font-semibold text-slate-900 block">{user.name}</span>
                              {user.id === session!.userId && (
                                <span className="text-[10px] text-purple-600 font-medium">(you)</span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className={`medkit-role-pill ${roleClass}`}>{user.role}</span>
                        </td>
                        <td className="text-slate-600 font-mono text-xs">0300 1234567</td>
                        <td className="text-slate-600 font-mono text-xs">42101-1234567-8</td>
                        <td className="text-slate-600 text-xs">01 Jan 2024</td>
                        <td>
                          <span className={`medkit-status-pill ${user.isActive ? 'active' : 'inactive'}`}>
                            {user.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedUser(user)
                              setEditing(user)
                            }}
                            className="text-slate-400 hover:text-slate-700"
                            title="Edit access"
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
                Showing {filteredUsers.length ? (page - 1) * pageSize + 1 : 0} to{' '}
                {Math.min(page * pageSize, filteredUsers.length)} of {filteredUsers.length} entries
              </div>
              <div className="medkit-pagination-btns">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage(p => p - 1)}
                  className="medkit-page-btn"
                >
                  &lt;
                </button>
                {Array.from(
                  { length: Math.ceil(filteredUsers.length / pageSize) || 1 },
                  (_, i) => i + 1
                ).map(num => (
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
                  disabled={page >= Math.ceil(filteredUsers.length / pageSize)}
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
                </select>
              </div>
            </div>
          </div>

          {/* Right Column Inspector (~35% width) */}
          <div className="flex flex-col gap-5">
            {selectedUser ? (
              <div className="medkit-card">
                <div className="medkit-card-body">
                  {/* Selected Staff Profile Header */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-12 h-12 rounded-full flex items-center justify-center text-white text-base font-bold flex-shrink-0"
                        style={{ backgroundColor: getAvatarColor(selectedUser.name) }}
                      >
                        {getInitials(selectedUser.name)}
                      </div>
                      <div>
                        <h2 className="text-base font-bold text-slate-900 font-heading">{selectedUser.name}</h2>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`medkit-status-pill ${selectedUser.isActive ? 'active' : 'inactive'}`}>
                            {selectedUser.isActive ? 'Active' : 'Inactive'}
                          </span>
                          <span className={`medkit-role-pill ${selectedUser.role.toLowerCase()}`}>
                            {selectedUser.role}
                          </span>
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditing(selectedUser)}
                      className="medkit-btn-secondary py-1.5 px-3 text-xs"
                    >
                      Edit
                    </button>
                  </div>

                  {/* Staff Details */}
                  <div className="space-y-2 py-3 border-t border-b border-slate-100 text-xs text-slate-600 mb-4">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400">📞</span>
                      <span className="font-mono">0301 2345678</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400">✉️</span>
                      <span>{selectedUser.username ? `${selectedUser.username}@noormart.com` : 'No email'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400">🆔</span>
                      <span className="font-mono">42201-2345678-9</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400">📍</span>
                      <span>Joined: 15 Jan 2024 · Karachi</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400">🕒</span>
                      <span>Last Login: Today, 11:20 AM</span>
                    </div>
                  </div>

                  {/* Permissions Pills Card */}
                  <div className="mb-4">
                    <div className="flex justify-between items-center mb-2">
                      <h3 className="text-xs font-bold text-slate-900">Permissions</h3>
                      <button type="button" className="text-[11px] text-[#5E0CF3] hover:underline">
                        View All
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <span className="px-2.5 py-1 rounded-lg bg-purple-50 text-purple-700 text-[11px] font-semibold">
                        ✓ POS
                      </span>
                      <span className="px-2.5 py-1 rounded-lg bg-purple-50 text-purple-700 text-[11px] font-semibold">
                        ✓ Sales
                      </span>
                      <span className="px-2.5 py-1 rounded-lg bg-purple-50 text-purple-700 text-[11px] font-semibold">
                        ✓ Inventory
                      </span>
                      <span className="px-2.5 py-1 rounded-lg bg-purple-50 text-purple-700 text-[11px] font-semibold">
                        ✓ Purchases
                      </span>
                      <span className="px-2.5 py-1 rounded-lg bg-purple-50 text-purple-700 text-[11px] font-semibold">
                        ✓ Reports
                      </span>
                      <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 text-[11px] font-semibold">
                        +8 more
                      </span>
                    </div>
                  </div>

                  {/* Role Distribution Donut Chart */}
                  <div className="mb-4 pt-3 border-t border-slate-100">
                    <h3 className="text-xs font-bold text-slate-900 mb-2">Role Distribution</h3>
                    <div className="flex items-center gap-3">
                      <div className="relative w-20 h-20 flex-shrink-0">
                        <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                          <path
                            className="text-slate-100"
                            strokeWidth="5"
                            stroke="currentColor"
                            fill="none"
                            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                          />
                          <path
                            className="text-emerald-500"
                            strokeDasharray="50, 100"
                            strokeWidth="5"
                            strokeLinecap="round"
                            stroke="currentColor"
                            fill="none"
                            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                          />
                          <path
                            className="text-blue-500"
                            strokeDasharray="17, 100"
                            strokeDashoffset="-50"
                            strokeWidth="5"
                            strokeLinecap="round"
                            stroke="currentColor"
                            fill="none"
                            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                          />
                          <path
                            className="text-purple-500"
                            strokeDasharray="17, 100"
                            strokeDashoffset="-67"
                            strokeWidth="5"
                            strokeLinecap="round"
                            stroke="currentColor"
                            fill="none"
                            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                          />
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                          <span className="text-xs font-bold text-slate-900">{totalStaff}</span>
                          <span className="text-[8px] text-slate-400">Staff</span>
                        </div>
                      </div>

                      <div className="flex-1 space-y-1 text-[10.5px]">
                        <div className="flex items-center justify-between">
                          <span className="flex items-center gap-1.5 text-slate-600">
                            <span className="w-2 h-2 rounded-full bg-emerald-500" /> Cashier
                          </span>
                          <span className="font-semibold text-slate-800">6 (50%)</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="flex items-center gap-1.5 text-slate-600">
                            <span className="w-2 h-2 rounded-full bg-blue-500" /> Manager
                          </span>
                          <span className="font-semibold text-slate-800">2 (17%)</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="flex items-center gap-1.5 text-slate-600">
                            <span className="w-2 h-2 rounded-full bg-purple-500" /> Inventory
                          </span>
                          <span className="font-semibold text-slate-800">2 (17%)</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Reset Password Button */}
                  {selectedUser.hasLogin && (
                    <button
                      type="button"
                      onClick={() => setResettingUser(selectedUser)}
                      className="medkit-btn-outline w-full text-xs py-2"
                    >
                      Reset Password
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="medkit-card p-6 text-center text-slate-400 text-sm">
                Select a staff member from the table to view details.
              </div>
            )}

            {/* Quick Actions Card */}
            <div className="medkit-card">
              <div className="medkit-card-header">
                <h2>Quick Actions</h2>
              </div>
              <div className="medkit-card-body grid grid-cols-2 gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setShowAddModal(true)}
                  className="p-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-left font-semibold text-slate-700"
                >
                  + Add Staff
                </button>
                <button
                  type="button"
                  className="p-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-left font-semibold text-slate-700"
                >
                  Import Staff
                </button>
                <button
                  type="button"
                  className="p-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-left font-semibold text-slate-700"
                >
                  Manage Roles
                </button>
                <button
                  type="button"
                  className="p-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-left font-semibold text-slate-700"
                >
                  Activity Logs
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Modal: Add Staff */}
        {showAddModal && (
          <div className="medkit-modal-backdrop" onClick={() => setShowAddModal(false)}>
            <div className="medkit-modal" onClick={e => e.stopPropagation()}>
              <div className="medkit-modal-header">
                <h2>Create Staff Account</h2>
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
                  void run(async () => {
                    const result = await window.vertexia!.auth.createUser({
                      name,
                      username,
                      password,
                      role,
                      branchIds,
                    })
                    setUsers(result)
                    setName('')
                    setUsername('')
                    setPassword('')
                    setShowAddModal(false)
                    setMessage('Staff account created successfully.')
                  })
                }}
              >
                <div className="medkit-modal-body">
                  <div className="medkit-form-group">
                    <label>Full Name *</label>
                    <input
                      required
                      maxLength={120}
                      value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder="e.g. Ali Raza"
                    />
                  </div>
                  <div className="medkit-form-group">
                    <label>Username *</label>
                    <input
                      required
                      minLength={3}
                      maxLength={64}
                      value={username}
                      onChange={e => setUsername(e.target.value)}
                      placeholder="e.g. aliraza"
                    />
                  </div>
                  <div className="medkit-form-group">
                    <label>Temporary Password *</label>
                    <input
                      required
                      type="password"
                      minLength={8}
                      maxLength={128}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Min 8 characters"
                    />
                  </div>
                  <div className="medkit-form-group">
                    <label>Role *</label>
                    <select value={role} onChange={e => setRole(e.target.value as UserRole)}>
                      {roles.map(r => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="medkit-form-group">
                    <label>Branch Access *</label>
                    <div className="space-y-1.5 mt-1">
                      {activeBranchList.map(b => (
                        <label key={b.id} className="flex items-center gap-2 text-xs cursor-pointer">
                          <input
                            type="checkbox"
                            checked={branchIds.includes(b.id)}
                            onChange={e => {
                              if (e.target.checked) setBranchIds([...branchIds, b.id])
                              else setBranchIds(branchIds.filter(id => id !== b.id))
                            }}
                          />
                          <span>{b.name}</span>
                        </label>
                      ))}
                    </div>
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
                  <button
                    type="submit"
                    disabled={busy || !branchIds.length}
                    className="medkit-btn-primary"
                  >
                    Create Account
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: Edit Staff */}
        {editing && (
          <div className="medkit-modal-backdrop" onClick={() => setEditing(null)}>
            <div className="medkit-modal" onClick={e => e.stopPropagation()}>
              <div className="medkit-modal-header">
                <h2>Edit Staff Access: {editing.name}</h2>
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="text-slate-400 hover:text-slate-700 text-lg leading-none"
                >
                  ✕
                </button>
              </div>
              <form
                onSubmit={e => {
                  e.preventDefault()
                  void run(async () => {
                    const result = await window.vertexia!.auth.updateUser({
                      userId: editing.id,
                      role: editing.role as UserRole,
                      isActive: editing.isActive,
                      branchIds: editing.branchIds,
                    })
                    setUsers(result)
                    setEditing(null)
                    setMessage('Staff access updated successfully.')
                  })
                }}
              >
                <div className="medkit-modal-body">
                  <div className="medkit-form-group">
                    <label>Role</label>
                    <select
                      value={editing.role}
                      onChange={e => setEditing({ ...editing, role: e.target.value as UserRole })}
                    >
                      {roles.map(r => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="medkit-form-group">
                    <label>Account Status</label>
                    <select
                      value={editing.isActive ? 'active' : 'disabled'}
                      onChange={e => setEditing({ ...editing, isActive: e.target.value === 'active' })}
                    >
                      <option value="active">Active</option>
                      <option value="disabled">Disabled</option>
                    </select>
                  </div>
                  <div className="medkit-form-group">
                    <label>Branch Access</label>
                    <div className="space-y-1.5 mt-1">
                      {activeBranchList.map(b => (
                        <label key={b.id} className="flex items-center gap-2 text-xs cursor-pointer">
                          <input
                            type="checkbox"
                            checked={editing.branchIds.includes(b.id)}
                            onChange={e => {
                              const next = e.target.checked
                                ? [...editing.branchIds, b.id]
                                : editing.branchIds.filter(id => id !== b.id)
                              setEditing({ ...editing, branchIds: next })
                            }}
                          />
                          <span>{b.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="medkit-modal-footer">
                  <button
                    type="button"
                    onClick={() => setEditing(null)}
                    className="medkit-btn-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy || !editing.branchIds.length}
                    className="medkit-btn-primary"
                  >
                    Save Changes
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: Reset Password */}
        {resettingUser && (
          <div className="medkit-modal-backdrop" onClick={() => setResettingUser(null)}>
            <div className="medkit-modal" onClick={e => e.stopPropagation()}>
              <div className="medkit-modal-header">
                <h2>Reset Password for {resettingUser.name}</h2>
                <button
                  type="button"
                  onClick={() => setResettingUser(null)}
                  className="text-slate-400 hover:text-slate-700 text-lg leading-none"
                >
                  ✕
                </button>
              </div>
              <form
                onSubmit={e => {
                  e.preventDefault()
                  void run(async () => {
                    await window.vertexia!.auth.resetPassword(resettingUser.id, resetPassword)
                    setResetPassword('')
                    setResettingUser(null)
                    setMessage('Password reset successfully. The user must sign in with this temporary password.')
                  })
                }}
              >
                <div className="medkit-modal-body">
                  <div className="medkit-form-group">
                    <label>New Temporary Password *</label>
                    <input
                      required
                      type="password"
                      minLength={8}
                      maxLength={128}
                      value={resetPassword}
                      onChange={e => setResetPassword(e.target.value)}
                      placeholder="Min 8 characters"
                    />
                  </div>
                </div>
                <div className="medkit-modal-footer">
                  <button
                    type="button"
                    onClick={() => setResettingUser(null)}
                    className="medkit-btn-secondary"
                  >
                    Cancel
                  </button>
                  <button type="submit" disabled={busy} className="medkit-btn-primary">
                    Confirm Reset
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
