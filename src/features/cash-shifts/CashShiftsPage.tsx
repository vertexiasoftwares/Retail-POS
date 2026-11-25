import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../app/auth/useAuth'
import { useOperationIdentity } from '../../shared/hooks/useOperationIdentity'
import { useEscapeKey } from '../../shared/hooks/useEscapeKey'
import { PageShell, type PageProps } from '../../shared/layout/PageShell'
import { TopNavHeader } from '../../shared/layout/TopNavHeader'
import { DateRangeFilter } from '../../shared/ui/DateRangeFilter'
import { Icon } from '../../shared/ui/Icon'
import { triggerRefreshShimmer } from '../../services/retail-events'
import { getPosSettings } from '../../shared/settings/posSettings'
import type { CashSnapshot } from '../../types/recovery'

const money = (value: number) =>
  'Rs. ' +
  (value / 100).toLocaleString('en-PK', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })

type DenominationCounts = Record<5000 | 1000 | 500 | 100 | 50 | 20 | 10 | 'coins', number>

const defaultDenominations: DenominationCounts = {
  5000: 0,
  1000: 0,
  500: 0,
  100: 0,
  50: 0,
  20: 0,
  10: 0,
  coins: 0,
}

function computeDenominationsTotal(d: DenominationCounts): number {
  return (
    d[5000] * 5000 +
    d[1000] * 1000 +
    d[500] * 500 +
    d[100] * 100 +
    d[50] * 50 +
    d[20] * 20 +
    d[10] * 10 +
    d.coins
  )
}

function amount(value: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim()))
    throw new Error('Enter a positive amount with at most two decimal places.')
  const result = Math.round(Number(value) * 100)
  if (!Number.isSafeInteger(result)) throw new Error('Amount is too large.')
  return result
}

export default function CashShiftsPage(props: PageProps) {
  const { session } = useAuth()
  const branchId = session!.branchId

  const [data, setData] = useState<CashSnapshot | null>(null)
  const [activeTab, setActiveTab] = useState<'active' | 'history' | 'transactions'>('active')

  // Modals state
  const [showOpenModal, setShowOpenModal] = useState(false)
  const [showCloseModal, setShowCloseModal] = useState(false)
  const [showMoveModal, setShowMoveModal] = useState(false)
  const [showForceCloseModal, setShowForceCloseModal] = useState(false)
  const [forceCloseShiftId, setForceCloseShiftId] = useState<string | null>(null)
  const [forceCloseReason, setForceCloseReason] = useState('')
  const [actionMenuId, setActionMenuId] = useState<string | null>(null)
  const [selectedMovement, setSelectedMovement] = useState<CashSnapshot['movements'][number] | null>(null)

  useEscapeKey(() => {
    setShowOpenModal(false)
    setShowCloseModal(false)
    setShowMoveModal(false)
    setShowForceCloseModal(false)
    setActionMenuId(null)
    setSelectedMovement(null)
  }, showOpenModal || showCloseModal || showMoveModal || showForceCloseModal || Boolean(actionMenuId) || Boolean(selectedMovement))

  // Forms
  const [opening, setOpening] = useState('')
  const [selectedCounterOption, setSelectedCounterOption] = useState('Counter 1')
  const [customCounterName, setCustomCounterName] = useState('')
  const [openNote, setOpenNote] = useState('')
  const [inlineError, setInlineError] = useState('')
  const [showDenominations, setShowDenominations] = useState(false)
  const [denominations, setDenominations] = useState<DenominationCounts>(defaultDenominations)

  const [counted, setCounted] = useState('')
  const [note, setNote] = useState('')

  const [direction, setDirection] = useState<'in' | 'out'>('out')
  const [moveAmount, setMoveAmount] = useState('')
  const [reason, setReason] = useState('')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const openOperation = useOperationIdentity('shift-open')
  const closeOperation = useOperationIdentity('shift-close')
  const moveOperation = useOperationIdentity('cash-move')

  // Handle Escape key to close any open modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowOpenModal(false)
        setShowCloseModal(false)
        setShowMoveModal(false)
        setShowForceCloseModal(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    if (!actionMenuId) return
    const closeMenu = () => setActionMenuId(null)
    window.addEventListener('click', closeMenu)
    return () => window.removeEventListener('click', closeMenu)
  }, [actionMenuId])

  const formatMovementDescription = (row: CashSnapshot['movements'][number]) => {
    if (row.description?.trim()) return row.description.trim()
    if (row.note?.trim()) return row.note.trim()
    if (row.reference?.startsWith('shift-')) return 'Opening Float'
    return row.reference || '-'
  }

  const refresh = useCallback(async () => {
    setData(await window.vertexia!.cash.getSnapshot(branchId))
  }, [branchId])

  useEffect(() => {
    const load = () => {
      void refresh().catch(cause => setError(String(cause.message ?? cause)))
    }
    const timer = window.setTimeout(load, 0)
    window.addEventListener('vertexia:retail-data-changed', load)
    window.addEventListener('focus', load)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('vertexia:retail-data-changed', load)
      window.removeEventListener('focus', load)
    }
  }, [refresh])

  const run = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
      await refresh()
      window.dispatchEvent(new Event('vertexia:retail-data-changed'))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Cash operation failed.')
    } finally {
      setBusy(false)
    }
  }

  const shift = data?.activeShift

  // Computed Stats - Connected strictly to real shift data, 0 when no active shift
  const openingCashPaisa = shift ? shift.openingCashPaisa : 0
  const cashSalesPaisa = useMemo(() => {
    if (!shift) return 0
    return (
      data?.movements
        ?.filter(m => m.type.toLowerCase().includes('sale') && m.direction === 'in')
        .reduce((sum, m) => sum + m.amountPaisa, 0) ?? 0
    )
  }, [shift, data?.movements])

  const cashReceivedPaisa = useMemo(() => {
    if (!shift) return 0
    return (
      data?.movements
        ?.filter(m => m.type.toLowerCase().includes('payment') && m.direction === 'in')
        .reduce((sum, m) => sum + m.amountPaisa, 0) ?? 0
    )
  }, [shift, data?.movements])

  const cashExpensesPaisa = useMemo(() => {
    if (!shift) return 0
    return (
      data?.movements
        ?.filter(m => m.direction === 'out')
        .reduce((sum, m) => sum + m.amountPaisa, 0) ?? 0
    )
  }, [shift, data?.movements])

  const expectedClosingPaisa = shift
    ? (shift.expectedCashPaisa ?? (openingCashPaisa + cashSalesPaisa + cashReceivedPaisa - cashExpensesPaisa))
    : 0
  const actualClosingPaisa = counted !== '' && /^\d+(\.\d{1,2})?$/.test(counted) ? Math.round(Number(counted) * 100) : expectedClosingPaisa
  const differencePaisa = actualClosingPaisa - expectedClosingPaisa

  // Calculate shift duration
  const shiftDuration = useMemo(() => {
    if (!shift) return 'No active shift'
    const diffMs = Math.max(0, Date.now() - new Date(shift.openedAt).getTime())
    const hours = Math.floor(diffMs / (1000 * 60 * 60))
    const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))
    return `${hours}h ${mins}m`
  }, [shift])

  // Previous closed shift
  const lastClosedShift = useMemo(() => {
    return data?.shifts?.find(s => s.status === 'closed') ?? null
  }, [data?.shifts])
  const lastClosingCashPaisa = lastClosedShift?.countedCashPaisa ?? null

  // Check for stale unclosed shift from an earlier day
  const staleShift = useMemo(() => {
    if (!data?.shifts) return null
    const openShifts = data.shifts.filter(s => s.status === 'open')
    const today = new Date().toISOString().split('T')[0]
    return openShifts.find(s => s.openedAt.split('T')[0] < today) ?? null
  }, [data?.shifts])

  // Counters management: Supports 1-10 out of the box + any custom or historically used counters
  const availableCounters = useMemo(() => {
    const list = [
      'Counter 1',
      'Counter 2',
      'Counter 3',
      'Counter 4',
      'Counter 5',
      'Counter 6',
      'Counter 7',
      'Counter 8',
      'Counter 9',
      'Counter 10',
    ]
    if (data?.shifts) {
      for (const s of data.shifts) {
        if (s.counterId && !list.includes(s.counterId)) {
          list.push(s.counterId)
        }
      }
    }
    return list
  }, [data?.shifts])

  const openCounters = useMemo(() => {
    return new Set(data?.shifts?.filter(s => s.status === 'open').map(s => s.counterId || 'Counter 1') ?? [])
  }, [data?.shifts])

  const targetCounter = selectedCounterOption === '__custom__'
    ? (customCounterName.trim() || 'Custom Counter')
    : selectedCounterOption

  return (
    <PageShell
      {...props}
      activePage="Cash & Shifts"
      header={() => (
        <TopNavHeader
          title="Cash & Shifts"
          subtitle="Cash drawers, shifts and cash transactions"
          onNavigate={props.onNavigate}
          extraRight={
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                triggerRefreshShimmer()
                void run(refresh)
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
        {/* Top Banner */}
        <div className="medkit-top-banner">
          <div className="medkit-banner-left">
            <div className="medkit-banner-icon">
              <Icon name="cash" size={24} />
            </div>
            <div className="medkit-banner-titles">
              <h1>Cash &amp; Shifts</h1>
              <p>Manage cash drawers, shifts and cash transactions</p>
            </div>
          </div>
          <div className="medkit-banner-actions">
            <DateRangeFilter />
            {!shift ? (
              <button
                type="button"
                disabled={Boolean(staleShift && session?.role === 'Cashier')}
                title={staleShift && session?.role === 'Cashier' ? 'Previous shift not closed. A manager must force-close it first.' : undefined}
                onClick={() => {
                  const defCash = getPosSettings().defaultOpeningCashRupees
                  setOpening(defCash > 0 ? String(defCash) : '')
                  setSelectedCounterOption('Counter 1')
                  setCustomCounterName('')
                  setOpenNote('')
                  setInlineError('')
                  setShowDenominations(false)
                  setDenominations(defaultDenominations)
                  setShowOpenModal(true)
                }}
                className={`medkit-btn-primary ${staleShift && session?.role === 'Cashier' ? 'opacity-50 cursor-not-allowed' : ''}`}
                style={{ color: '#ffffff' }}
              >
                <span style={{ color: '#ffffff' }}>+</span> <span style={{ color: '#ffffff' }}>Open New Shift</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setCounted((expectedClosingPaisa / 100).toFixed(2))
                  setNote('')
                  setShowCloseModal(true)
                }}
                className="medkit-btn-primary bg-emerald-600 hover:bg-emerald-700"
              >
                Close Shift
              </button>
            )}
          </div>
        </div>

        {/* Warning Banner for unclosed previous shift */}
        {staleShift && (
          <div className="mb-5 p-4 px-5 rounded-2xl bg-amber-50 border border-amber-300 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">⚠️</span>
              <div>
                <h3 className="text-sm font-bold text-amber-950 font-heading">Previous shift not closed</h3>
                <p className="text-xs text-amber-800">
                  Shift #{staleShift.id} was opened on {new Date(staleShift.openedAt).toLocaleDateString()} at{' '}
                  {new Date(staleShift.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} by {staleShift.cashierName} ({staleShift.counterId || 'Counter 1'}) and was never closed.
                </p>
              </div>
            </div>
            {(session?.role === 'Owner' || session?.role === 'Manager') ? (
              <button
                type="button"
                onClick={() => {
                  setForceCloseShiftId(staleShift.id)
                  setForceCloseReason('')
                  setShowForceCloseModal(true)
                }}
                className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shadow transition-all cursor-pointer"
              >
                Force Close Shift
              </button>
            ) : (
              <span className="text-xs text-amber-900 font-semibold bg-amber-100 px-3 py-1.5 rounded-lg">
                Manager force-close required
              </span>
            )}
          </div>
        )}

        {error && (
          <div className="mb-4 p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-sm font-medium">
            {error}
          </div>
        )}
        {notice && (
          <div className="mb-4 p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 text-sm font-medium">
            {notice}
          </div>
        )}

        {/* 4 Stat Cards Row */}
        <div className="medkit-stats-row">
          {/* 1. Opening Cash */}
          <div className="medkit-stat-card">
            <div className="medkit-stat-badge green">
              <Icon name="cash" size={22} />
            </div>
            <div className="medkit-stat-body">
              <div className="medkit-stat-label">Opening Cash</div>
              <div className="medkit-stat-value">{shift ? money(openingCashPaisa) : 'Rs. 0'}</div>
              <div className="medkit-stat-meta">
                <span>{shift ? 'Current Shift' : 'No active shift'}</span>
              </div>
            </div>
          </div>

          {/* 2. Cash Sales */}
          <div className="medkit-stat-card">
            <div className="medkit-stat-badge purple">
              <Icon name="cart" size={22} />
            </div>
            <div className="medkit-stat-body">
              <div className="medkit-stat-label">Cash Sales</div>
              <div className="medkit-stat-value">{shift ? money(cashSalesPaisa) : 'Rs. 0'}</div>
              <div className="medkit-stat-meta">
                <span>{shift ? 'Current Shift' : 'No active shift'}</span>
              </div>
            </div>
          </div>

          {/* 3. Cash Received */}
          <div className="medkit-stat-card">
            <div className="medkit-stat-badge purple">
              <Icon name="sale" size={22} />
            </div>
            <div className="medkit-stat-body">
              <div className="medkit-stat-label">Cash Received</div>
              <div className="medkit-stat-value">{shift ? money(cashReceivedPaisa) : 'Rs. 0'}</div>
              <div className="medkit-stat-meta">
                <span>{shift ? 'Customer Payments' : 'No active shift'}</span>
              </div>
            </div>
          </div>

          {/* 4. Cash Expenses */}
          <div className="medkit-stat-card">
            <div className="medkit-stat-badge red">
              <Icon name="expense" size={22} />
            </div>
            <div className="medkit-stat-body">
              <div className="medkit-stat-label">Cash Expenses</div>
              <div className="medkit-stat-value">{shift ? money(cashExpensesPaisa) : 'Rs. 0'}</div>
              <div className="medkit-stat-meta">
                <span>{shift ? 'Current Shift' : 'No active shift'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs Row */}
        <div className="medkit-tabs-row">
          <button
            type="button"
            className={`medkit-tab-btn ${activeTab === 'active' ? 'active' : ''}`}
            onClick={() => setActiveTab('active')}
          >
            Active Shift
          </button>
          <button
            type="button"
            className={`medkit-tab-btn ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            Shift History
          </button>
          <button
            type="button"
            className={`medkit-tab-btn ${activeTab === 'transactions' ? 'active' : ''}`}
            onClick={() => setActiveTab('transactions')}
          >
            Cash Transactions
          </button>
        </div>

        {/* Two-Column Layout */}
        <div className="medkit-two-col-layout">
          {/* Left Column (~65% width) */}
          <div className="flex flex-col gap-5">
            {/* Shift In Progress Banner */}
            {shift && (
              <div className="flex items-center justify-between p-4 px-5 rounded-2xl bg-[#ecfdf5] border border-[#a7f3d0]">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />
                  <div>
                    <h2 className="text-sm font-bold text-emerald-950 font-heading">Shift In Progress</h2>
                    <p className="text-xs text-emerald-700">
                      Started on {new Date(shift.openedAt).toLocaleDateString()} at{' '}
                      {new Date(shift.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-emerald-700 text-white flex items-center justify-center text-xs font-bold">
                      {shift.cashierName.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="text-xs font-bold text-emerald-950">{shift.cashierName}</div>
                      <div className="text-[10px] text-emerald-700 font-medium">Cashier</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10.5px] text-emerald-700 font-medium">Shift Duration</div>
                    <div className="text-xs font-bold text-emerald-950">{shiftDuration}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Left Content per Tab */}
            {activeTab === 'active' && (
              <div className="medkit-card">
                <div className="medkit-card-header">
                  <h2>Recent Cash Transactions</h2>
                  <button
                    type="button"
                    onClick={() => {
                      setDirection('in')
                      setMoveAmount('')
                      setReason('')
                      setShowMoveModal(true)
                    }}
                    className="medkit-btn-secondary py-1 px-3 text-xs"
                  >
                    + Add Transaction
                  </button>
                </div>
                <div className="medkit-table-wrap">
                  <table className="medkit-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Date &amp; Time</th>
                        <th>Type</th>
                        <th>Description</th>
                        <th>Amount</th>
                        <th>Payment Method</th>
                        <th>Added By</th>
                        <th style={{ textAlign: 'center' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data?.movements?.slice(0, 10).map((row, idx) => {
                        const isIncome = row.direction === 'in'
                        const friendlyDescription = formatMovementDescription(row)
                        const actorName = row.actorName?.trim() || session?.name || 'Cashier'
                        const menuOpen = actionMenuId === row.id
                        return (
                          <tr key={row.id}>
                            <td className="text-slate-500 font-mono text-sm">{idx + 1}</td>
                            <td className="text-sm text-slate-600 whitespace-nowrap">
                              {new Date(row.occurredAt).toLocaleDateString()}{' '}
                              <span className="text-slate-500">
                                {new Date(row.occurredAt).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            </td>
                            <td>
                              <span className="font-semibold text-sm text-slate-800 capitalize">
                                {row.type.replaceAll('_', ' ')}
                              </span>
                            </td>
                            <td className="text-sm text-slate-700 max-w-[230px] truncate" title={friendlyDescription}>
                              {friendlyDescription}
                            </td>
                            <td className="font-bold text-sm whitespace-nowrap">
                              <span className={isIncome ? 'text-emerald-700' : 'text-rose-700'}>
                                {isIncome ? '+' : '-'} {money(row.amountPaisa)}
                              </span>
                            </td>
                            <td className="text-sm text-slate-700">{row.paymentMethod || 'Cash'}</td>
                            <td>
                              <div className="flex items-center gap-1.5">
                                <div className="w-6 h-6 rounded-full bg-slate-200 text-slate-700 text-xs font-bold flex items-center justify-center">
                                  {actorName.slice(0, 1).toUpperCase()}
                                </div>
                                <span className="text-sm text-slate-700">{actorName}</span>
                              </div>
                            </td>
                            <td
                              style={{ textAlign: 'center', position: 'relative', zIndex: menuOpen ? 60 : 1 }}
                              onClick={e => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={() => setActionMenuId(menuOpen ? null : row.id)}
                                aria-expanded={menuOpen}
                                aria-label={`Transaction options for ${friendlyDescription}`}
                                className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 cursor-pointer"
                                title="Transaction options"
                              >
                                ···
                              </button>
                              {menuOpen && (
                                <div
                                  className={`absolute right-2 ${idx >= 5 ? 'bottom-9' : 'top-9'} z-50 w-48 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 text-left text-sm`}
                                  onClick={e => e.stopPropagation()}
                                >
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setActionMenuId(null)
                                      setSelectedMovement(row)
                                    }}
                                    className="w-full px-3 py-2 text-slate-700 hover:bg-purple-50 hover:text-[#5E0CF3] flex items-center gap-2 font-medium cursor-pointer"
                                  >
                                    <Icon name="report" size={15} /> View Details
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setActionMenuId(null)
                                      const copyVal = row.reference || friendlyDescription
                                      if (navigator.clipboard?.writeText) {
                                        void navigator.clipboard.writeText(copyVal)
                                      }
                                      setNotice(`Copied reference: ${copyVal}`)
                                    }}
                                    className="w-full px-3 py-2 text-slate-700 hover:bg-purple-50 hover:text-[#5E0CF3] flex items-center gap-2 font-medium cursor-pointer"
                                  >
                                    <Icon name="copy" size={15} /> Copy Reference
                                  </button>
                                  {row.type === 'cash_sale' && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setActionMenuId(null)
                                        props.onNavigate('Sales History')
                                      }}
                                      className="w-full px-3 py-2 text-slate-700 hover:bg-purple-50 hover:text-[#5E0CF3] flex items-center gap-2 font-medium cursor-pointer"
                                    >
                                      <Icon name="history" size={15} /> Open Sales History
                                    </button>
                                  )}
                                  {row.type === 'sale_refund' && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setActionMenuId(null)
                                        props.onNavigate('Returns')
                                      }}
                                      className="w-full px-3 py-2 text-slate-700 hover:bg-purple-50 hover:text-[#5E0CF3] flex items-center gap-2 font-medium cursor-pointer"
                                    >
                                      <Icon name="returnOrder" size={15} /> Open Returns
                                    </button>
                                  )}
                                  {row.type === 'supplier_payment' && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setActionMenuId(null)
                                        props.onNavigate('Suppliers')
                                      }}
                                      className="w-full px-3 py-2 text-slate-700 hover:bg-purple-50 hover:text-[#5E0CF3] flex items-center gap-2 font-medium cursor-pointer"
                                    >
                                      <Icon name="supplier" size={15} /> Open Suppliers
                                    </button>
                                  )}
                                  {row.type === 'expense' && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setActionMenuId(null)
                                        props.onNavigate('Expenses')
                                      }}
                                      className="w-full px-3 py-2 text-slate-700 hover:bg-purple-50 hover:text-[#5E0CF3] flex items-center gap-2 font-medium cursor-pointer"
                                    >
                                      <Icon name="expense" size={15} /> Open Expenses
                                    </button>
                                  )}
                                  {row.type === 'customer_payment' && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setActionMenuId(null)
                                        props.onNavigate('Customers')
                                      }}
                                      className="w-full px-3 py-2 text-slate-700 hover:bg-purple-50 hover:text-[#5E0CF3] flex items-center gap-2 font-medium cursor-pointer"
                                    >
                                      <Icon name="users" size={15} /> Open Customers
                                    </button>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                      {(!data?.movements || data.movements.length === 0) && (
                        <tr>
                          <td colSpan={8} className="py-6 text-center text-slate-400 text-sm">
                            No cash transactions recorded for this shift yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'history' && (
              <div className="medkit-card">
                <div className="medkit-card-header">
                  <h2>Shift History</h2>
                </div>
                <div className="medkit-table-wrap">
                  <table className="medkit-table">
                    <thead>
                      <tr>
                        <th>Opened</th>
                        <th>Cashier</th>
                        <th>Counter</th>
                        <th>Status</th>
                        <th>Expected</th>
                        <th>Counted</th>
                        <th>Difference</th>
                        <th>Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data?.shifts?.map(s => (
                        <tr key={s.id}>
                          <td className="text-xs">{new Date(s.openedAt).toLocaleString()}</td>
                          <td className="font-semibold text-xs text-slate-800">{s.cashierName}</td>
                          <td className="text-xs text-slate-600 font-medium">{s.counterId || 'Counter 1'}</td>
                          <td>
                            <span className={`medkit-status-pill ${s.status === 'open' ? 'active' : 'inactive'}`}>
                              {s.status}
                            </span>
                          </td>
                          <td className="text-xs font-medium">{money(s.expectedCashPaisa)}</td>
                          <td className="text-xs font-medium">
                            {s.countedCashPaisa !== null ? money(s.countedCashPaisa) : '-'}
                          </td>
                          <td className="text-xs font-bold">
                            {s.variancePaisa !== null ? (
                              <span className={s.variancePaisa === 0 ? 'text-emerald-600' : 'text-rose-600'}>
                                {money(s.variancePaisa)}
                              </span>
                            ) : (
                              '-'
                            )}
                          </td>
                          <td className="text-xs text-slate-500 max-w-[160px] truncate" title={s.closingNote || s.note || s.closeReason || '-'}>
                            {s.closingNote || s.note || s.closeReason || '-'}
                          </td>
                        </tr>
                      ))}
                      {(!data?.shifts || data.shifts.length === 0) && (
                        <tr>
                          <td colSpan={8} className="py-6 text-center text-slate-400 text-sm">
                            No shifts recorded yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'transactions' && (
              <div className="medkit-card">
                <div className="medkit-card-header">
                  <h2>All Cash Drawer Transactions</h2>
                </div>
                <div className="medkit-table-wrap">
                  <table className="medkit-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Type</th>
                        <th>Direction</th>
                        <th>Amount</th>
                        <th>Reference / Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data?.movements?.map(m => {
                        const friendlyDesc = formatMovementDescription(m)
                        return (
                        <tr key={m.id}>
                          <td className="text-sm">{new Date(m.occurredAt).toLocaleString()}</td>
                          <td className="text-sm font-medium capitalize">{m.type.replaceAll('_', ' ')}</td>
                          <td className="text-sm uppercase font-semibold">{m.direction}</td>
                          <td className="text-sm font-bold">
                            <span className={m.direction === 'in' ? 'text-emerald-700' : 'text-rose-700'}>
                              {m.direction === 'in' ? '+' : '-'} {money(m.amountPaisa)}
                            </span>
                          </td>
                          <td className="text-sm text-slate-700 max-w-[260px] truncate" title={friendlyDesc}>
                            {friendlyDesc}
                          </td>
                        </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Right Column Inspector (~35% width) */}
          <div className="flex flex-col gap-5 min-w-0">
            {/* Shift Actions Card */}
            <div className="medkit-card">
              <div className="medkit-card-header">
                <h2>Shift Actions</h2>
                <button
                  type="button"
                  onClick={() => props.onNavigate('Settings')}
                  className="text-xs text-[#5E0CF3] hover:underline"
                >
                  Shift Settings
                </button>
              </div>
              <div className="medkit-card-body space-y-3">
                {shift ? (
                  <button
                    type="button"
                    onClick={() => {
                      setCounted((expectedClosingPaisa / 100).toFixed(2))
                      setNote('')
                      setShowCloseModal(true)
                    }}
                    className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-md transition-all cursor-pointer"
                  >
                    <span>⏹</span> Close Shift
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={Boolean(staleShift && session?.role === 'Cashier')}
                    title={staleShift && session?.role === 'Cashier' ? 'Previous shift not closed. A manager must force-close it first.' : undefined}
                    onClick={() => {
                      const defCash = getPosSettings().defaultOpeningCashRupees
                      setOpening(defCash > 0 ? String(defCash) : '')
                      setSelectedCounterOption('Counter 1')
                      setCustomCounterName('')
                      setOpenNote('')
                      setInlineError('')
                      setShowDenominations(false)
                      setDenominations(defaultDenominations)
                      setShowOpenModal(true)
                    }}
                    className={`w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-gradient-to-r from-[#7A35F6] to-[#5E0CF3] hover:from-[#6c28ea] hover:to-[#5009d4] !text-white font-bold text-sm shadow-md transition-all cursor-pointer ${staleShift && session?.role === 'Cashier' ? 'opacity-50 cursor-not-allowed' : ''}`}
                    style={{ color: '#ffffff' }}
                  >
                    <span style={{ color: '#ffffff' }}>▶</span> <span style={{ color: '#ffffff' }}>Open New Shift</span>
                  </button>
                )}

                {/* 2x2 Action Grid */}
                <div className="grid grid-cols-2 gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDirection('in')
                      setMoveAmount('')
                      setReason('')
                      setShowMoveModal(true)
                    }}
                    className="p-3 rounded-xl border border-slate-200 hover:bg-slate-50 text-left transition-all"
                  >
                    <div className="text-xs font-semibold text-slate-800">+ Add Transaction</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">Quick entry</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => props.onNavigate('Expenses')}
                    className="p-3 rounded-xl border border-slate-200 hover:bg-slate-50 text-left transition-all"
                  >
                    <div className="text-xs font-semibold text-slate-800">+ Add Expense</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">Record expense</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDirection('in')
                      setMoveAmount('')
                      setReason('Bank deposit / float')
                      setShowMoveModal(true)
                    }}
                    className="p-3 rounded-xl border border-slate-200 hover:bg-slate-50 text-left transition-all"
                  >
                    <div className="text-xs font-semibold text-emerald-700">↓ Cash Deposit</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">Cash in drawer</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDirection('out')
                      setMoveAmount('')
                      setReason('Cash drop to bank')
                      setShowMoveModal(true)
                    }}
                    className="p-3 rounded-xl border border-slate-200 hover:bg-slate-50 text-left transition-all"
                  >
                    <div className="text-xs font-semibold text-rose-700">↑ Cash Withdrawal</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">Cash out drawer</div>
                  </button>
                </div>
              </div>
            </div>

            {/* Current Shift Summary Card */}
            <div className="medkit-card">
              <div className="medkit-card-header">
                <h2>Current Shift Summary</h2>
              </div>
              <div className="medkit-card-body text-xs space-y-2.5">
                {!shift ? (
                  <div className="py-6 text-center text-slate-400">
                    <div className="text-2xl mb-1">🔒</div>
                    <p className="font-semibold text-slate-700 text-xs mb-1">No Active Shift</p>
                    <p className="text-[11px] text-slate-500">
                      Open a cash shift to start tracking live drawer cash, sales and expenses.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between items-center text-slate-600">
                      <span>Opening Cash</span>
                      <span className="font-semibold text-slate-900">{money(openingCashPaisa)}</span>
                    </div>
                    <div className="flex justify-between items-center text-slate-600">
                      <span>Cash Sales</span>
                      <span className="font-semibold text-slate-900">{money(cashSalesPaisa)}</span>
                    </div>
                    <div className="flex justify-between items-center text-slate-600">
                      <span>Cash Returns</span>
                      <span className="font-semibold text-slate-900">Rs. 0</span>
                    </div>
                    <div className="flex justify-between items-center text-slate-600">
                      <span>Customer Payments</span>
                      <span className="font-semibold text-slate-900">{money(cashReceivedPaisa)}</span>
                    </div>
                    <div className="flex justify-between items-center text-slate-600">
                      <span>Expenses</span>
                      <span className="font-semibold text-rose-600">- {money(cashExpensesPaisa)}</span>
                    </div>

                    <div className="pt-2 border-t border-slate-100">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-slate-800">Expected Closing Cash</span>
                        <span className="font-bold text-sm text-slate-900 font-heading">
                          {money(expectedClosingPaisa)}
                        </span>
                      </div>
                    </div>

                    <div className="pt-2">
                      <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                        Actual Closing Cash
                      </label>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-400">Rs.</span>
                        <input
                          type="text"
                          className="medkit-select w-full py-1.5 px-3 text-xs font-mono font-bold"
                          value={counted !== '' ? counted : (expectedClosingPaisa / 100).toFixed(0)}
                          onChange={e => setCounted(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="pt-2">
                      <div className="flex items-center justify-between p-2 px-3 rounded-xl bg-emerald-50 border border-emerald-100">
                        <span className="text-xs font-bold text-emerald-800">Difference</span>
                        <span className="text-xs font-bold text-emerald-800">
                          {differencePaisa === 0 ? 'Rs. 0' : money(differencePaisa)}
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Today's Cash Summary Donut Chart Card */}
            <div className="medkit-card">
              <div className="medkit-card-header">
                <h2>Today&apos;s Cash Summary</h2>
              </div>
              <div className="medkit-card-body flex items-center gap-4">
                {/* SVG Donut */}
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
                      className="text-[#5E0CF3]"
                      strokeDasharray="70, 100"
                      strokeWidth="5"
                      strokeLinecap="round"
                      stroke="currentColor"
                      fill="none"
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    />
                    <path
                      className="text-[#06B6D4]"
                      strokeDasharray="15, 100"
                      strokeDashoffset="-70"
                      strokeWidth="5"
                      strokeLinecap="round"
                      stroke="currentColor"
                      fill="none"
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    />
                    <path
                      className="text-[#F59E0B]"
                      strokeDasharray="10, 100"
                      strokeDashoffset="-85"
                      strokeWidth="5"
                      strokeLinecap="round"
                      stroke="currentColor"
                      fill="none"
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                    <span className="text-[11px] font-bold text-slate-900 font-heading">
                      {money(expectedClosingPaisa)}
                    </span>
                    <span className="text-[9px] text-slate-400">Net Cash</span>
                  </div>
                </div>

                {/* Donut Legend */}
                <div className="flex-1 space-y-1.5 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-slate-600">
                      <span className="w-2 h-2 rounded-full bg-[#5E0CF3]" /> Cash Sales
                    </span>
                    <span className="font-semibold text-slate-900">{money(cashSalesPaisa)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-slate-600">
                      <span className="w-2 h-2 rounded-full bg-[#06B6D4]" /> Customer Payments
                    </span>
                    <span className="font-semibold text-slate-900">{money(cashReceivedPaisa)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-slate-600">
                      <span className="w-2 h-2 rounded-full bg-[#F59E0B]" /> Cash Expenses
                    </span>
                    <span className="font-semibold text-slate-900">{money(cashExpensesPaisa)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-slate-600">
                      <span className="w-2 h-2 rounded-full bg-rose-500" /> Cash Returns
                    </span>
                    <span className="font-semibold text-slate-900">Rs. 0</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Modal: Open Shift */}
        {showOpenModal && (
          <div className="medkit-modal-backdrop" onClick={() => setShowOpenModal(false)}>
            <div className="medkit-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
              <div className="medkit-modal-header">
                <h2>Open New Cash Shift</h2>
                <button
                  type="button"
                  onClick={() => setShowOpenModal(false)}
                  className="text-slate-400 hover:text-slate-700 text-lg leading-none"
                >
                  ✕
                </button>
              </div>
              <form
                onSubmit={e => {
                  e.preventDefault()
                  const trimmed = opening.trim()
                  if (!trimmed) {
                    setInlineError('Opening cash float is required.')
                    return
                  }
                  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
                    setInlineError('Enter a valid positive number with at most 2 decimal places.')
                    return
                  }
                  const num = Number(trimmed)
                  if (isNaN(num) || num < 0) {
                    setInlineError('Float cannot be negative.')
                    return
                  }
                  if (selectedCounterOption === '__custom__' && !customCounterName.trim()) {
                    setInlineError('Enter a custom counter name or choose a counter from the list.')
                    return
                  }
                  setInlineError('')
                  void run(async () => {
                    const value = Math.round(num * 100)
                    const finalCounter = targetCounter
                    const request = { branchId, openingCashPaisa: value, note: openNote, counterId: finalCounter }
                    await window.vertexia!.pos.openShift(branchId, value, openOperation.idFor(request), openNote, finalCounter)
                    openOperation.reset()
                    setShowOpenModal(false)
                    setNotice(`Shift on ${finalCounter} opened successfully. You can now record sales.`)
                  })
                }}
              >
                <div className="medkit-modal-body space-y-4">
                  {/* Cashier (Read-only) & Counter */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="medkit-form-group">
                      <label>Cashier</label>
                      <input
                        type="text"
                        readOnly
                        disabled
                        value={session?.name || 'Cashier'}
                        className="bg-slate-100 text-slate-700 font-semibold cursor-not-allowed"
                      />
                    </div>
                    <div className="medkit-form-group">
                      <label>Counter / Register</label>
                      <select
                        value={selectedCounterOption}
                        onChange={e => {
                          setSelectedCounterOption(e.target.value)
                          if (e.target.value !== '__custom__') {
                            setCustomCounterName('')
                          }
                        }}
                        className="medkit-select"
                      >
                        {availableCounters.map(c => (
                          <option key={c} value={c}>
                            {c}{openCounters.has(c) ? ' (In Use)' : ''}
                          </option>
                        ))}
                        <option value="__custom__">+ Add Custom Counter…</option>
                      </select>
                      {selectedCounterOption === '__custom__' && (
                        <input
                          type="text"
                          autoFocus
                          required
                          value={customCounterName}
                          onChange={e => setCustomCounterName(e.target.value)}
                          placeholder="e.g. Counter 4, Pharmacy, Express"
                          className="mt-2 text-xs font-semibold py-1.5 px-3 border border-indigo-200 rounded-lg bg-indigo-50/50"
                        />
                      )}
                      {openCounters.has(targetCounter) && (
                        <div className="text-[11px] text-rose-600 font-semibold mt-1">
                          ⚠️ {targetCounter} is currently in use by another shift.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Float Input */}
                  <div className="medkit-form-group">
                    <label>Opening Cash Float (Rs) *</label>
                    <div className="relative">
                      <input
                        autoFocus
                        required
                        inputMode="decimal"
                        value={opening}
                        onChange={e => {
                          const val = e.target.value
                          if (val === '' || /^\d*(\.\d{0,2})?$/.test(val)) {
                            setOpening(val)
                            setInlineError('')
                          }
                        }}
                        placeholder="0.00"
                        className={inlineError ? 'border-rose-500' : ''}
                      />
                    </div>

                    {/* Hint: Last shift closing cash */}
                    {lastClosingCashPaisa !== null && (
                      <div className="text-[11.5px] text-slate-500 mt-1">
                        Last shift closing cash: <strong className="text-slate-800">{money(lastClosingCashPaisa)}</strong>
                      </div>
                    )}

                    {/* Soft warning: Differs from last closing cash */}
                    {lastClosingCashPaisa !== null && opening.trim() !== '' && !isNaN(Number(opening)) && Math.round(Number(opening) * 100) !== lastClosingCashPaisa && (
                      <div className="text-[11.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-1.5 px-2.5 mt-1.5 flex items-center gap-1.5 font-medium">
                        <span>ℹ️</span>
                        <span>Differs from last closing ({money(lastClosingCashPaisa)})</span>
                      </div>
                    )}

                    {/* Inline error */}
                    {inlineError && (
                      <div className="text-[11.5px] text-rose-600 font-medium mt-1">
                        {inlineError}
                      </div>
                    )}
                  </div>

                  {/* Collapsible Section: Count by notes */}
                  <div className="border border-slate-200 rounded-xl p-3 bg-slate-50/50">
                    <button
                      type="button"
                      onClick={() => setShowDenominations(!showDenominations)}
                      className="text-xs font-bold text-[#5E0CF3] flex items-center justify-between w-full hover:underline"
                    >
                      <span>{showDenominations ? '▾ Hide Note Breakdown' : '▸ Count by notes (Denomination Calculator)'}</span>
                      <span className="text-[11px] font-normal text-slate-500">
                        {showDenominations ? 'Collapse' : 'Expand note counter'}
                      </span>
                    </button>

                    {showDenominations && (
                      <div className="mt-3 pt-3 border-t border-slate-200 space-y-2.5">
                        <div className="grid grid-cols-4 gap-2 text-xs">
                          {([5000, 1000, 500, 100, 50, 20, 10] as const).map(denom => (
                            <div key={denom} className="flex flex-col">
                              <label className="text-[10px] font-semibold text-slate-600 mb-0.5">Rs. {denom}</label>
                              <input
                                type="number"
                                min="0"
                                step="1"
                                value={denominations[denom] || ''}
                                onChange={e => {
                                  const count = Math.max(0, parseInt(e.target.value) || 0)
                                  const next: DenominationCounts = { ...denominations, [denom]: count }
                                  setDenominations(next)
                                  const sum = computeDenominationsTotal(next)
                                  setOpening(sum > 0 ? String(sum) : '')
                                  setInlineError('')
                                }}
                                placeholder="0"
                                className="medkit-select py-1 px-2 text-xs text-center font-mono"
                              />
                            </div>
                          ))}
                          <div className="flex flex-col">
                            <label className="text-[10px] font-semibold text-slate-600 mb-0.5">Coins (Rs)</label>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={denominations.coins || ''}
                              onChange={e => {
                                const count = Math.max(0, parseInt(e.target.value) || 0)
                                const next: DenominationCounts = { ...denominations, coins: count }
                                setDenominations(next)
                                const sum = computeDenominationsTotal(next)
                                setOpening(sum > 0 ? String(sum) : '')
                                setInlineError('')
                              }}
                              placeholder="0"
                              className="medkit-select py-1 px-2 text-xs text-center font-mono"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Optional Note */}
                  <div className="medkit-form-group">
                    <label>Shift Note (optional)</label>
                    <textarea
                      rows={2}
                      maxLength={200}
                      value={openNote}
                      onChange={e => setOpenNote(e.target.value)}
                      placeholder="e.g. Morning shift, primary cashier"
                      className="text-xs"
                    />
                  </div>
                </div>

                <div className="medkit-modal-footer">
                  <button
                    type="button"
                    onClick={() => setShowOpenModal(false)}
                    className="medkit-btn-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy || !opening.trim()}
                    className="medkit-btn-primary"
                    style={{ color: '#ffffff' }}
                  >
                    <span style={{ color: '#ffffff' }}>{busy ? 'Opening Shift…' : 'Open Shift'}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: Force Close Shift (Manager/Admin Only) */}
        {showForceCloseModal && forceCloseShiftId && (
          <div className="medkit-modal-backdrop" onClick={() => setShowForceCloseModal(false)}>
            <div className="medkit-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
              <div className="medkit-modal-header">
                <h2 className="text-amber-900">⚠️ Force Close Previous Shift</h2>
                <button
                  type="button"
                  onClick={() => setShowForceCloseModal(false)}
                  className="text-slate-400 hover:text-slate-700 text-lg leading-none"
                >
                  ✕
                </button>
              </div>
              <form
                onSubmit={e => {
                  e.preventDefault()
                  if (!forceCloseReason.trim() || forceCloseReason.trim().length < 3) return
                  void run(async () => {
                    await window.vertexia!.cash.forceClose({
                      branchId,
                      shiftId: forceCloseShiftId,
                      reason: forceCloseReason.trim(),
                    })
                    setShowForceCloseModal(false)
                    setForceCloseShiftId(null)
                    setForceCloseReason('')
                    setNotice('Abandoned shift force-closed successfully. You can now open a new shift.')
                  })
                }}
              >
                <div className="medkit-modal-body space-y-3">
                  <p className="text-xs text-slate-600">
                    This shift was left open from an earlier date. As a manager or owner, enter a reason to reconcile and force-close it so the counter is cleared.
                  </p>
                  <div className="medkit-form-group">
                    <label>Force Close Reason *</label>
                    <textarea
                      required
                      rows={3}
                      minLength={3}
                      maxLength={500}
                      value={forceCloseReason}
                      onChange={e => setForceCloseReason(e.target.value)}
                      placeholder="e.g. Cashier forgot to close shift yesterday. Drawer reconciled with manager."
                      className="text-xs"
                    />
                    <small className="text-slate-400 text-[11px] mt-1 block">
                      Minimum 3 characters. This action is permanently logged to the audit events.
                    </small>
                  </div>
                </div>
                <div className="medkit-modal-footer">
                  <button
                    type="button"
                    onClick={() => setShowForceCloseModal(false)}
                    className="medkit-btn-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy || forceCloseReason.trim().length < 3}
                    className="medkit-btn-primary bg-amber-600 hover:bg-amber-700"
                  >
                    {busy ? 'Closing…' : 'Confirm Force Close'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: Close Shift */}
        {showCloseModal && shift && (
          <div className="medkit-modal-backdrop" onClick={() => setShowCloseModal(false)}>
            <div className="medkit-modal" onClick={e => e.stopPropagation()}>
              <div className="medkit-modal-header">
                <h2>Close Current Shift</h2>
                <button
                  type="button"
                  onClick={() => setShowCloseModal(false)}
                  className="text-slate-400 hover:text-slate-700 text-lg leading-none"
                >
                  ✕
                </button>
              </div>
              <form
                onSubmit={e => {
                  e.preventDefault()
                  void run(async () => {
                    const request = {
                      branchId,
                      shiftId: shift.id,
                      countedCashPaisa: amount(counted),
                      note,
                    }
                    const result = await window.vertexia!.cash.closeShift({
                      ...request,
                      operationId: closeOperation.idFor(request),
                    })
                    closeOperation.reset()
                    setShowCloseModal(false)
                    setCounted('')
                    setNote('')
                    setNotice('Shift closed. Cash difference: ' + money(result.variancePaisa ?? 0))
                  })
                }}
              >
                <div className="medkit-modal-body">
                  <div className="mb-4 p-3 bg-slate-50 rounded-xl text-xs space-y-1">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Expected in drawer:</span>
                      <strong className="text-slate-900">{money(shift.expectedCashPaisa)}</strong>
                    </div>
                  </div>
                  <div className="medkit-form-group">
                    <label>Counted Physical Cash (Rs) *</label>
                    <input
                      required
                      inputMode="decimal"
                      value={counted}
                      onChange={e => setCounted(e.target.value)}
                      placeholder="Enter counted amount"
                    />
                  </div>
                  <div className="medkit-form-group">
                    <label>Closing Note (optional)</label>
                    <textarea
                      maxLength={500}
                      value={note}
                      onChange={e => setNote(e.target.value)}
                      placeholder="Add any notes about drawer discrepancies or handovers"
                      rows={3}
                    />
                  </div>
                </div>
                <div className="medkit-modal-footer">
                  <button
                    type="button"
                    onClick={() => setShowCloseModal(false)}
                    className="medkit-btn-secondary"
                  >
                    Cancel
                  </button>
                  <button type="submit" disabled={busy} className="medkit-btn-primary bg-emerald-600 hover:bg-emerald-700">
                    Confirm &amp; Close Shift
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: Cash Movement */}
        {showMoveModal && shift && (
          <div className="medkit-modal-backdrop" onClick={() => setShowMoveModal(false)}>
            <div className="medkit-modal" onClick={e => e.stopPropagation()}>
              <div className="medkit-modal-header">
                <h2>Record Cash Movement</h2>
                <button
                  type="button"
                  onClick={() => setShowMoveModal(false)}
                  className="text-slate-400 hover:text-slate-700 text-lg leading-none"
                >
                  ✕
                </button>
              </div>
              <form
                onSubmit={e => {
                  e.preventDefault()
                  void run(async () => {
                    const request = {
                      branchId,
                      shiftId: shift.id,
                      direction,
                      amountPaisa: amount(moveAmount),
                      reason,
                    }
                    await window.vertexia!.cash.move({
                      ...request,
                      operationId: moveOperation.idFor(request),
                    })
                    moveOperation.reset()
                    setShowMoveModal(false)
                    setMoveAmount('')
                    setReason('')
                    setNotice('Cash movement saved successfully.')
                  })
                }}
              >
                <div className="medkit-modal-body">
                  <div className="medkit-form-group">
                    <label>Movement Type</label>
                    <select
                      value={direction}
                      onChange={e => setDirection(e.target.value as 'in' | 'out')}
                    >
                      <option value="in">Cash In (Deposit / Addition)</option>
                      <option value="out">Cash Out (Withdrawal / Removal)</option>
                    </select>
                  </div>
                  <div className="medkit-form-group">
                    <label>Amount (Rs) *</label>
                    <input
                      required
                      inputMode="decimal"
                      value={moveAmount}
                      onChange={e => setMoveAmount(e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="medkit-form-group">
                    <label>Reason / Reference *</label>
                    <input
                      required
                      minLength={3}
                      maxLength={250}
                      value={reason}
                      onChange={e => setReason(e.target.value)}
                      placeholder="e.g. Bank float, Owner withdrawal"
                    />
                  </div>
                </div>
                <div className="medkit-modal-footer">
                  <button
                    type="button"
                    onClick={() => setShowMoveModal(false)}
                    className="medkit-btn-secondary"
                  >
                    Cancel
                  </button>
                  <button type="submit" disabled={busy} className="medkit-btn-primary">
                    Save Movement
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {selectedMovement && (
          <div className="medkit-modal-backdrop" onClick={() => setSelectedMovement(null)}>
            <div className="medkit-modal-card" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
              <div className="medkit-modal-header">
                <h3>Cash Transaction Details</h3>
                <button
                  type="button"
                  onClick={() => setSelectedMovement(null)}
                  className="text-slate-500 hover:text-slate-800 text-lg leading-none cursor-pointer"
                  aria-label="Close transaction details"
                >
                  ✕
                </button>
              </div>
              <div className="medkit-modal-body space-y-3 text-sm">
                <div className="flex justify-between items-center py-2 border-b border-slate-100">
                  <span className="text-slate-600 font-medium">Type</span>
                  <span className="font-semibold text-slate-900 capitalize">
                    {selectedMovement.type.replaceAll('_', ' ')}
                  </span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-slate-100">
                  <span className="text-slate-600 font-medium">Amount</span>
                  <span className={`font-bold ${selectedMovement.direction === 'in' ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {selectedMovement.direction === 'in' ? '+' : '-'} {money(selectedMovement.amountPaisa)}
                  </span>
                </div>
                <div className="flex justify-between items-start gap-4 py-2 border-b border-slate-100">
                  <span className="text-slate-600 font-medium shrink-0">Description</span>
                  <span className="font-medium text-slate-900 text-right">
                    {formatMovementDescription(selectedMovement)}
                  </span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-slate-100">
                  <span className="text-slate-600 font-medium">Date &amp; Time</span>
                  <span className="text-slate-800">{new Date(selectedMovement.occurredAt).toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-slate-100">
                  <span className="text-slate-600 font-medium">Payment Method</span>
                  <span className="text-slate-800">{selectedMovement.paymentMethod || 'Cash'}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-slate-100">
                  <span className="text-slate-600 font-medium">Added By</span>
                  <span className="text-slate-800">{selectedMovement.actorName?.trim() || session?.name || 'Cashier'}</span>
                </div>
                <div className="flex justify-between items-center gap-4 py-2">
                  <span className="text-slate-600 font-medium shrink-0">Reference ID</span>
                  <span className="font-mono text-xs text-slate-600 break-all text-right">
                    {selectedMovement.reference || selectedMovement.id}
                  </span>
                </div>
              </div>
              <div className="medkit-modal-footer">
                <button
                  type="button"
                  onClick={() => {
                    const copyVal = selectedMovement.reference || selectedMovement.id
                    if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(copyVal)
                    setNotice(`Copied reference: ${copyVal}`)
                    setSelectedMovement(null)
                  }}
                  className="medkit-btn-secondary"
                >
                  Copy Reference
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedMovement(null)}
                  className="medkit-btn-primary"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </PageShell>
  )
}
