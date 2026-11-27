import { useCallback, useEffect, useState } from 'react'
import {
  cloudApi,
  type CashShiftRecord,
  type CounterRecord,
  type ReportsPayload,
  type StaffRecord,
} from '../services/cloudApi'
import { formatDateTime, formatPkr, formatRelativeSync, todayKarachiDate } from '../utils/format'
import { EmptyState, ErrorBanner, KpiCard, PageHeader, StatusBadge } from '../components/UiPrimitives'

export function CashShiftsScreen({ refreshTick }: { refreshTick: number }) {
  const [shifts, setShifts] = useState<CashShiftRecord[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await cloudApi.getCashShifts()
      setShifts(res.shifts)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load cash shifts.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshTick])

  const openShifts = shifts.filter(s => s.status === 'open').length

  return (
    <div>
      <PageHeader title="Cash Shifts & Drawer Audits" subtitle={`${openShifts} open shift(s) • ${shifts.length} total synced`} />
      <ErrorBanner message={error} onRetry={load} />

      {!loading && shifts.length === 0 ? (
        <EmptyState title="No cash shifts synced yet" description="Opened and closed register shifts appear automatically after sync." />
      ) : (
        <div className="space-y-3">
          {shifts.map(sh => {
            const expanded = expandedId === sh.id
            return (
              <div key={sh.id} className="rounded-2xl border border-[#dce6f4] bg-white p-4 shadow-xs">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-display font-bold text-[#10243f]">{sh.counter_name || sh.counter_id}</span>
                      <StatusBadge
                        variant={sh.status === 'open' ? 'accent' : sh.status === 'closed' ? 'success' : 'warning'}
                        label={sh.status}
                      />
                    </div>
                    <p className="mt-1 text-xs text-[#55667d]">
                      Cashier: <strong className="text-[#10243f]">{sh.cashier_name || sh.cashier_id}</strong> • Opened{' '}
                      {formatDateTime(sh.opened_at)}
                      {sh.closed_at ? ` • Closed ${formatDateTime(sh.closed_at)}` : ''}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs sm:flex sm:items-center sm:gap-5">
                    <div>
                      <p className="text-[#55667d]">Opening Cash</p>
                      <p className="font-semibold text-[#10243f]">{formatPkr(sh.opening_cash_paisa)}</p>
                    </div>
                    <div>
                      <p className="text-[#55667d]">Expected</p>
                      <p className="font-semibold text-[#10243f]">
                        {sh.expected_cash_paisa !== null ? formatPkr(sh.expected_cash_paisa) : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[#55667d]">Counted / Variance</p>
                      <p className="font-semibold text-[#10243f]">
                        {sh.counted_cash_paisa !== null ? formatPkr(sh.counted_cash_paisa) : 'Open'}{' '}
                        {sh.variance_paisa !== null ? `(${formatPkr(sh.variance_paisa)})` : ''}
                      </p>
                    </div>
                    {sh.movements.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setExpandedId(expanded ? null : sh.id)}
                        className="rounded-lg border border-[#dce6f4] px-3 py-1.5 font-semibold text-[#6d4aff] hover:bg-[#6d4aff]/10"
                      >
                        {expanded ? 'Hide Movements' : `${sh.movements.length} Movements`}
                      </button>
                    )}
                  </div>
                </div>

                {expanded && sh.movements.length > 0 && (
                  <div className="mt-3 border-t border-[#edf2fa] pt-3">
                    <div className="space-y-1.5">
                      {sh.movements.map(m => (
                        <div key={m.id} className="flex flex-wrap items-center justify-between rounded-xl bg-[#f8fbff] px-3 py-2 text-xs">
                          <span>
                            <strong className="uppercase text-[#6d4aff]">{m.movement_type}</strong> — {m.reason || 'Cash movement'}{' '}
                            {m.created_by_name ? `(${m.created_by_name})` : ''}
                          </span>
                          <span className="font-semibold text-[#10243f]">{formatPkr(m.amount_paisa)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function StaffScreen({ refreshTick }: { refreshTick: number }) {
  const [staff, setStaff] = useState<StaffRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await cloudApi.getStaff()
      setStaff(res.staff)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load staff roster.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshTick])

  return (
    <div>
      <PageHeader
        title="Staff Directory & Access Status"
        subtitle="Staff creation, role assignment, and staff PIN/password resets are managed securely on Main PC"
      />
      <ErrorBanner message={error} onRetry={load} />

      {!loading && staff.length === 0 ? (
        <EmptyState title="No staff profiles found" description="Staff members appear after initial credential sync." />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[#dce6f4] bg-white shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#dce6f4] bg-[#f8fbff] text-xs font-semibold uppercase text-[#55667d]">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Username</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Cred Version</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#edf2fa]">
                {staff.map(u => (
                  <tr key={u.id}>
                    <td className="px-4 py-3 font-semibold text-[#10243f]">{u.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-[#55667d]">{u.username || '—'}</td>
                    <td className="px-4 py-3">
                      <StatusBadge variant={u.role === 'Owner' ? 'accent' : 'neutral'} label={u.role} />
                    </td>
                    <td className="px-4 py-3 text-xs text-[#55667d]">
                      v{u.credentialVersion ?? 1}
                      {u.mustChangePassword ? ' (Must Change)' : ''}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge variant={u.isActive ? 'success' : 'danger'} label={u.isActive ? 'Active' : 'Disabled'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

export function CountersScreen({ refreshTick }: { refreshTick: number }) {
  const [counters, setCounters] = useState<CounterRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await cloudApi.getCounters()
      setCounters(res.counters)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load counters.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshTick])

  async function handleRevoke(counter: CounterRecord) {
    if (!window.confirm(`Revoke access for Counter #${counter.counter_number} (${counter.name})? This logs out that terminal.`)) {
      return
    }
    setRevokingId(counter.id)
    setError(null)
    setNotice(null)
    try {
      const res = await cloudApi.revokeCounter(counter.id)
      setNotice(`Counter #${counter.counter_number} revoked (cloud seq #${res.cloudSeq}). Main PC enforces revocation on next pull.`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke counter.')
    } finally {
      setRevokingId(null)
    }
  }

  return (
    <div>
      <PageHeader
        title="Shop Counters (1–20 LAN Architecture)"
        subtitle="Primary Counter 1 runs on Shop Main PC. Secondary LAN counters can be revoked remotely."
      />
      {notice && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-800">
          {notice}
        </div>
      )}
      <ErrorBanner message={error} onRetry={load} />

      {!loading && counters.length === 0 ? (
        <EmptyState title="No counters registered" description="Active POS counters sync from the Main PC LAN coordinator." />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {counters.map(c => {
            const seen = formatRelativeSync(c.last_seen_at)
            return (
              <div key={c.id} className="rounded-2xl border border-[#dce6f4] bg-white p-4 shadow-xs">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-display text-base font-bold text-[#10243f]">
                      Counter #{c.counter_number} — {c.name}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-[#55667d]">{c.id}</p>
                  </div>
                  <StatusBadge
                    variant={c.status === 'active' ? 'success' : 'danger'}
                    label={c.is_primary ? 'Primary Main PC' : c.status}
                  />
                </div>
                <div className="mt-3 space-y-1 text-xs text-[#55667d]">
                  <p>Last Seen: {seen.label}</p>
                  {c.last_ip && <p>LAN IP: {c.last_ip}</p>}
                  {c.app_version && <p>App Version: v{c.app_version}</p>}
                  {c.revoked_at && <p className="text-rose-700">Revoked: {formatDateTime(c.revoked_at)}</p>}
                </div>
                {!c.is_primary && c.status === 'active' && (
                  <button
                    type="button"
                    disabled={revokingId === c.id}
                    onClick={() => handleRevoke(c)}
                    className="mt-4 w-full rounded-xl border border-rose-200 bg-rose-50 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                  >
                    {revokingId === c.id ? 'Revoking...' : 'Revoke Counter Access'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function ReportsScreen({ refreshTick }: { refreshTick: number }) {
  const today = todayKarachiDate()
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
  const [dateFrom, setDateFrom] = useState(thirtyDaysAgo)
  const [dateTo, setDateTo] = useState(today)
  const [report, setReport] = useState<ReportsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await cloudApi.getReports(dateFrom, dateTo)
      setReport(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load reports.')
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo])

  useEffect(() => {
    void load()
  }, [load, refreshTick])

  const totalSales = report?.salesTrend.reduce((s, r) => s + r.salesPaisa, 0) ?? 0
  const totalProfit = report?.salesTrend.reduce((s, r) => s + r.grossProfitPaisa, 0) ?? 0
  const totalExpenses = report?.expensesByCategory.reduce((s, r) => s + r.netPaisa, 0) ?? 0

  return (
    <div>
      <PageHeader title="Owner Financial & Counter Reports" subtitle="Generated directly from synced Supabase sales & expense ledgers" />
      <ErrorBanner message={error} onRetry={load} />

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-[#dce6f4] bg-white p-3.5 text-xs">
        <label className="font-semibold text-[#10243f]">
          From:
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="ml-2 rounded-lg border border-[#dce6f4] px-2.5 py-1.5"
          />
        </label>
        <label className="font-semibold text-[#10243f]">
          To:
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="ml-2 rounded-lg border border-[#dce6f4] px-2.5 py-1.5"
          />
        </label>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard tone="accent" label="Period Sales" value={formatPkr(totalSales)} />
        <KpiCard label="Period Est. Gross Profit" value={formatPkr(totalProfit)} />
        <KpiCard label="Period Expenses" value={formatPkr(totalExpenses)} tone="warning" />
      </div>

      {!loading && report && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="rounded-2xl border border-[#dce6f4] bg-white p-4 shadow-xs">
            <h2 className="font-display mb-3 text-base font-bold text-[#10243f]">Daily Sales Trend</h2>
            {report.salesTrend.length === 0 ? (
              <p className="text-xs text-[#55667d]">No completed sales in selected date range.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-[#dce6f4] text-[#55667d]">
                    <tr>
                      <th className="py-2">Date</th>
                      <th className="py-2 text-right">Invoices</th>
                      <th className="py-2 text-right">Sales</th>
                      <th className="py-2 text-right">Profit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#edf2fa]">
                    {report.salesTrend.map(row => (
                      <tr key={row.date}>
                        <td className="py-2 font-medium text-[#10243f]">{row.date}</td>
                        <td className="py-2 text-right">{row.invoices}</td>
                        <td className="py-2 text-right font-semibold">{formatPkr(row.salesPaisa)}</td>
                        <td className="py-2 text-right text-emerald-700">{formatPkr(row.grossProfitPaisa)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="space-y-5">
            <div className="rounded-2xl border border-[#dce6f4] bg-white p-4 shadow-xs">
              <h2 className="font-display mb-3 text-base font-bold text-[#10243f]">Sales by Counter</h2>
              {report.byCounter.length === 0 ? (
                <p className="text-xs text-[#55667d]">No counter sales data in range.</p>
              ) : (
                <div className="space-y-2">
                  {report.byCounter.map(c => (
                    <div key={c.counterId} className="flex items-center justify-between rounded-xl bg-[#f8fbff] px-3 py-2 text-xs">
                      <span className="font-semibold text-[#10243f]">
                        #{c.counterNumber} {c.name} ({c.invoiceCount} invoices)
                      </span>
                      <span className="font-bold text-[#6d4aff]">{formatPkr(c.salesPaisa)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-[#dce6f4] bg-white p-4 shadow-xs">
              <h2 className="font-display mb-3 text-base font-bold text-[#10243f]">Expenses by Category</h2>
              {report.expensesByCategory.length === 0 ? (
                <p className="text-xs text-[#55667d]">No expenses in selected range.</p>
              ) : (
                <div className="space-y-2">
                  {report.expensesByCategory.map(e => (
                    <div key={e.category} className="flex items-center justify-between rounded-xl bg-[#f8fbff] px-3 py-2 text-xs">
                      <span className="font-semibold text-[#10243f]">{e.category}</span>
                      <span className="font-bold text-amber-800">{formatPkr(e.netPaisa)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
