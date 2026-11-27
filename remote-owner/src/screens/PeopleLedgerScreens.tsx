import { useCallback, useEffect, useState } from 'react'
import {
  cloudApi,
  type CustomerRecord,
  type ExpenseRecord,
  type PurchaseRecord,
  type SupplierRecord,
} from '../services/cloudApi'
import { formatDateTime, formatPkr } from '../utils/format'
import { EmptyState, ErrorBanner, KpiCard, PageHeader, StatusBadge } from '../components/UiPrimitives'

export function CustomersScreen({ refreshTick }: { refreshTick: number }) {
  const [customers, setCustomers] = useState<CustomerRecord[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await cloudApi.getCustomers()
      setCustomers(res.customers)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load customers.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshTick])

  const filtered = customers.filter(
    c => !search.trim() || c.name.toLowerCase().includes(search.trim().toLowerCase()) || c.phone.includes(search.trim()),
  )
  const totalReceivable = filtered.reduce((acc, c) => acc + Math.max(0, c.balance_paisa), 0)

  return (
    <div>
      <PageHeader title="Customers & Udhaar Ledger" subtitle={`${customers.length} synced named customer(s)`} />
      <ErrorBanner message={error} onRetry={load} />
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <KpiCard label="Filtered Customers" value={String(filtered.length)} />
        <KpiCard label="Total Udhaar Receivable" value={formatPkr(totalReceivable)} tone="accent" />
      </div>
      <div className="mb-4 rounded-2xl border border-[#dce6f4] bg-white p-3.5">
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Filter by customer name or phone..."
          className="w-full rounded-xl border border-[#dce6f4] px-3.5 py-2 text-sm outline-none focus:border-[#6d4aff]"
        />
      </div>

      {!loading && filtered.length === 0 ? (
        <EmptyState title="No customers found" description="Named shop customers appear automatically as sales and receipts sync." />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[#dce6f4] bg-white shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#dce6f4] bg-[#f8fbff] text-xs font-semibold uppercase text-[#55667d]">
                <tr>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3 text-right">Ledger Balance</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#edf2fa]">
                {filtered.map(c => (
                  <tr key={c.id}>
                    <td className="px-4 py-3 font-semibold text-[#10243f]">{c.name}</td>
                    <td className="px-4 py-3 text-xs text-[#55667d]">{c.phone || '—'}</td>
                    <td className="px-4 py-3 text-right font-semibold">
                      <span className={c.balance_paisa > 0 ? 'text-amber-700' : 'text-emerald-700'}>
                        {formatPkr(c.balance_paisa)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge variant={c.is_active ? 'success' : 'danger'} label={c.is_active ? 'Active' : 'Inactive'} />
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

export function SuppliersScreen({ refreshTick }: { refreshTick: number }) {
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await cloudApi.getSuppliers()
      setSuppliers(res.suppliers)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load suppliers.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshTick])

  const filtered = suppliers.filter(
    s => !search.trim() || s.name.toLowerCase().includes(search.trim().toLowerCase()) || s.phone.includes(search.trim()),
  )
  const totalPayable = filtered.reduce((acc, s) => acc + Math.max(0, s.balance_paisa), 0)

  return (
    <div>
      <PageHeader title="Suppliers & Payables" subtitle={`${suppliers.length} synced supplier account(s)`} />
      <ErrorBanner message={error} onRetry={load} />
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <KpiCard label="Suppliers" value={String(filtered.length)} />
        <KpiCard label="Outstanding Supplier Payables" value={formatPkr(totalPayable)} tone="warning" />
      </div>
      <div className="mb-4 rounded-2xl border border-[#dce6f4] bg-white p-3.5">
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Filter by supplier name or phone..."
          className="w-full rounded-xl border border-[#dce6f4] px-3.5 py-2 text-sm outline-none focus:border-[#6d4aff]"
        />
      </div>

      {!loading && filtered.length === 0 ? (
        <EmptyState title="No suppliers found" description="Supplier accounts sync from the Main PC purchasing module." />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[#dce6f4] bg-white shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#dce6f4] bg-[#f8fbff] text-xs font-semibold uppercase text-[#55667d]">
                <tr>
                  <th className="px-4 py-3">Supplier</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3 text-right">Net Payable</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#edf2fa]">
                {filtered.map(s => (
                  <tr key={s.id}>
                    <td className="px-4 py-3 font-semibold text-[#10243f]">{s.name}</td>
                    <td className="px-4 py-3 text-xs text-[#55667d]">{s.phone || '—'}</td>
                    <td className="px-4 py-3 text-right font-semibold text-[#10243f]">{formatPkr(s.balance_paisa)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge variant={s.is_active ? 'success' : 'danger'} label={s.is_active ? 'Active' : 'Inactive'} />
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

export function PurchasesScreen({ refreshTick }: { refreshTick: number }) {
  const [purchases, setPurchases] = useState<PurchaseRecord[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await cloudApi.getPurchases({ page, search })
      setPurchases(res.purchases)
      setTotal(res.total)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load purchases.')
    } finally {
      setLoading(false)
    }
  }, [page, search])

  useEffect(() => {
    void load()
  }, [load, refreshTick])

  const totalPages = Math.max(1, Math.ceil(total / 50))

  return (
    <div>
      <PageHeader title="Purchases & Stock Intake" subtitle={`${total} synced purchase invoice(s)`} />
      <ErrorBanner message={error} onRetry={load} />
      <div className="mb-4 rounded-2xl border border-[#dce6f4] bg-white p-3.5">
        <input
          type="search"
          value={search}
          onChange={e => {
            setPage(1)
            setSearch(e.target.value)
          }}
          placeholder="Search purchase number or supplier..."
          className="w-full rounded-xl border border-[#dce6f4] px-3.5 py-2 text-sm outline-none focus:border-[#6d4aff]"
        />
      </div>

      {!loading && purchases.length === 0 ? (
        <EmptyState title="No purchase records synced" description="Purchases recorded on Main PC sync here automatically." />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[#dce6f4] bg-white shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#dce6f4] bg-[#f8fbff] text-xs font-semibold uppercase text-[#55667d]">
                <tr>
                  <th className="px-4 py-3">Purchase #</th>
                  <th className="px-4 py-3">Supplier</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-right">Paid</th>
                  <th className="px-4 py-3">Recorded By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#edf2fa]">
                {purchases.map(p => (
                  <tr key={p.id}>
                    <td className="px-4 py-3 font-semibold text-[#6d4aff]">{p.purchase_number}</td>
                    <td className="px-4 py-3 font-medium text-[#10243f]">{p.supplier_name_snapshot || p.supplier_id}</td>
                    <td className="px-4 py-3 text-xs text-[#55667d]">{formatDateTime(p.occurred_at)}</td>
                    <td className="px-4 py-3 text-right font-semibold">{formatPkr(p.total_paisa)}</td>
                    <td className="px-4 py-3 text-right text-xs text-emerald-700">{formatPkr(p.paid_paisa)}</td>
                    <td className="px-4 py-3 text-xs text-[#55667d]">{p.created_by_name || 'Main PC'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-[#dce6f4] px-4 py-3 text-xs text-[#55667d]">
              <span>
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  className="rounded-lg border border-[#dce6f4] px-3 py-1 font-semibold disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  className="rounded-lg border border-[#dce6f4] px-3 py-1 font-semibold disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function ExpensesScreen({ refreshTick }: { refreshTick: number }) {
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await cloudApi.getExpenses()
      setExpenses(res.expenses)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load expenses.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshTick])

  const totalAmount = expenses.reduce((sum, e) => sum + e.amount_paisa, 0)

  return (
    <div>
      <PageHeader title="Shop Expenses" subtitle={`${expenses.length} synced expense entry/entries`} />
      <ErrorBanner message={error} onRetry={load} />
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <KpiCard label="Recorded Entries" value={String(expenses.length)} />
        <KpiCard label="Cumulative Synced Expenses" value={formatPkr(totalAmount)} tone="warning" />
      </div>

      {!loading && expenses.length === 0 ? (
        <EmptyState title="No expenses recorded yet" description="Shop expenses created on Main PC will sync to this ledger." />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[#dce6f4] bg-white shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#dce6f4] bg-[#f8fbff] text-xs font-semibold uppercase text-[#55667d]">
                <tr>
                  <th className="px-4 py-3">Voucher #</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3">Method</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#edf2fa]">
                {expenses.map(e => (
                  <tr key={e.id}>
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-[#6d4aff]">{e.expense_number}</td>
                    <td className="px-4 py-3 font-semibold text-[#10243f]">{e.category}</td>
                    <td className="px-4 py-3 text-xs text-[#55667d]">{e.description || e.note || '—'}</td>
                    <td className="px-4 py-3 text-xs">{e.method}</td>
                    <td className="px-4 py-3 text-right font-semibold text-[#10243f]">{formatPkr(e.amount_paisa)}</td>
                    <td className="px-4 py-3 text-xs text-[#55667d]">{e.business_date}</td>
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
