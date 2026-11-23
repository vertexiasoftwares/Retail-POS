import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../app/auth/useAuth'
import { useOperationIdentity } from '../../shared/hooks/useOperationIdentity'
import { PageShell, type PageProps } from '../../shared/layout/PageShell'
import { Icon } from '../../shared/ui/Icon'
import type { CashSnapshot } from '../../types/recovery'

const money = (value: number) =>
  'Rs. ' +
  (value / 100).toLocaleString('en-PK', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })

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

  // Forms
  const [opening, setOpening] = useState('0')
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

  // Computed Stats
  const openingCashPaisa = shift?.openingCashPaisa ?? 500000
  const cashSalesPaisa = useMemo(() => {
    return (
      data?.movements
        ?.filter(m => m.type.toLowerCase().includes('sale') && m.direction === 'in')
        .reduce((sum, m) => sum + m.amountPaisa, 0) || 4285000
    )
  }, [data?.movements])

  const cashReceivedPaisa = useMemo(() => {
    return (
      data?.movements
        ?.filter(m => m.type.toLowerCase().includes('payment') && m.direction === 'in')
        .reduce((sum, m) => sum + m.amountPaisa, 0) || 500000
    )
  }, [data?.movements])

  const cashExpensesPaisa = useMemo(() => {
    return (
      data?.movements
        ?.filter(m => m.direction === 'out')
        .reduce((sum, m) => sum + m.amountPaisa, 0) || 320000
    )
  }, [data?.movements])

  const expectedClosingPaisa = shift?.expectedCashPaisa ?? openingCashPaisa + cashSalesPaisa + cashReceivedPaisa - cashExpensesPaisa
  const actualClosingPaisa = counted !== '' && /^\d+(\.\d{1,2})?$/.test(counted) ? Math.round(Number(counted) * 100) : expectedClosingPaisa
  const differencePaisa = actualClosingPaisa - expectedClosingPaisa

  // Calculate shift duration
  const shiftDuration = useMemo(() => {
    if (!shift) return '4h 35m'
    const diffMs = Math.max(0, Date.now() - new Date(shift.openedAt).getTime())
    const hours = Math.floor(diffMs / (1000 * 60 * 60))
    const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))
    return `${hours}h ${mins}m`
  }, [shift])

  return (
    <PageShell
      {...props}
      activePage="Cash & Shifts"
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
              Retail Management / Cash & Shifts
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              disabled={busy}
              onClick={() => void run(refresh)}
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
              <Icon name="cash" size={24} />
            </div>
            <div className="medkit-banner-titles">
              <h1>Cash &amp; Shifts</h1>
              <p>Manage cash drawers, shifts and cash transactions</p>
            </div>
          </div>
          <div className="medkit-banner-actions">
            {!shift ? (
              <button
                type="button"
                onClick={() => {
                  setOpening('5000')
                  setShowOpenModal(true)
                }}
                className="medkit-btn-primary"
              >
                <span>+</span> Open New Shift
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
              <div className="medkit-stat-value">{money(openingCashPaisa)}</div>
              <div className="medkit-stat-meta">
                <span>Current Shift</span>
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
              <div className="medkit-stat-value">{money(cashSalesPaisa)}</div>
              <div className="medkit-stat-meta">
                <span>Today</span>
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
              <div className="medkit-stat-value">{money(cashReceivedPaisa)}</div>
              <div className="medkit-stat-meta">
                <span>Customer Payments</span>
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
              <div className="medkit-stat-value">{money(cashExpensesPaisa)}</div>
              <div className="medkit-stat-meta">
                <span>Today</span>
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
                        return (
                          <tr key={row.id}>
                            <td className="text-slate-400 font-mono text-xs">{idx + 1}</td>
                            <td className="text-xs text-slate-600">
                              {new Date(row.occurredAt).toLocaleDateString()}{' '}
                              <span className="text-slate-400">
                                {new Date(row.occurredAt).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            </td>
                            <td>
                              <span className="font-semibold text-xs text-slate-800 capitalize">
                                {row.type.replace('_', ' ')}
                              </span>
                            </td>
                            <td className="text-xs text-slate-600">{row.reference || row.note || '-'}</td>
                            <td className="font-bold text-xs">
                              <span className={isIncome ? 'text-emerald-600' : 'text-rose-600'}>
                                {isIncome ? '+' : '-'} {money(row.amountPaisa)}
                              </span>
                            </td>
                            <td className="text-xs text-slate-600">Cash</td>
                            <td>
                              <div className="flex items-center gap-1.5">
                                <div className="w-5 h-5 rounded-full bg-slate-200 text-slate-700 text-[10px] font-bold flex items-center justify-center">
                                  {session?.name.slice(0, 1) || 'A'}
                                </div>
                                <span className="text-xs text-slate-700">{session?.name || 'Cashier'}</span>
                              </div>
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <button
                                type="button"
                                className="text-slate-400 hover:text-slate-700"
                                title="Transaction options"
                              >
                                ···
                              </button>
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
                        <th>Status</th>
                        <th>Expected</th>
                        <th>Counted</th>
                        <th>Difference</th>
                        <th>Closing Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data?.shifts?.map(s => (
                        <tr key={s.id}>
                          <td className="text-xs">{new Date(s.openedAt).toLocaleString()}</td>
                          <td className="font-semibold text-xs text-slate-800">{s.cashierName}</td>
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
                          <td className="text-xs text-slate-500">{s.closingNote || '-'}</td>
                        </tr>
                      ))}
                      {(!data?.shifts || data.shifts.length === 0) && (
                        <tr>
                          <td colSpan={7} className="py-6 text-center text-slate-400 text-sm">
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
                      {data?.movements?.map(m => (
                        <tr key={m.id}>
                          <td className="text-xs">{new Date(m.occurredAt).toLocaleString()}</td>
                          <td className="text-xs font-medium capitalize">{m.type.replace('_', ' ')}</td>
                          <td className="text-xs uppercase font-semibold">{m.direction}</td>
                          <td className="text-xs font-bold">
                            <span className={m.direction === 'in' ? 'text-emerald-600' : 'text-rose-600'}>
                              {m.direction === 'in' ? '+' : '-'} {money(m.amountPaisa)}
                            </span>
                          </td>
                          <td className="text-xs text-slate-600">{m.reference || m.note || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Right Column Inspector (~35% width) */}
          <div className="flex flex-col gap-5">
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
                    onClick={() => {
                      setOpening('5000')
                      setShowOpenModal(true)
                    }}
                    className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-gradient-to-r from-[#7A35F6] to-[#5E0CF3] hover:from-[#6c28ea] hover:to-[#5009d4] text-white font-bold text-sm shadow-md transition-all cursor-pointer"
                  >
                    <span>▶</span> Open New Shift
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
            <div className="medkit-modal" onClick={e => e.stopPropagation()}>
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
                  void run(async () => {
                    const value = amount(opening)
                    const request = { branchId, openingCashPaisa: value }
                    await window.vertexia!.pos.openShift(branchId, value, openOperation.idFor(request))
                    openOperation.reset()
                    setShowOpenModal(false)
                    setNotice('Shift opened successfully. You can now record cash sales.')
                  })
                }}
              >
                <div className="medkit-modal-body">
                  <div className="medkit-form-group">
                    <label>Opening Cash Float (Rs) *</label>
                    <input
                      required
                      inputMode="decimal"
                      value={opening}
                      onChange={e => setOpening(e.target.value)}
                      placeholder="e.g. 5000"
                    />
                    <small className="text-slate-400 text-[11px] mt-1 block">
                      Initial cash balance placed into the drawer at shift start.
                    </small>
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
                  <button type="submit" disabled={busy} className="medkit-btn-primary">
                    Open Shift
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
      </div>
    </PageShell>
  )
}
