import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { CustomSelect } from '../../shared/ui/CustomSelect'
import { Icon, type IconName } from '../../shared/ui/Icon'
import { PageShell, type PageProps } from '../../shared/layout/PageShell'
import { useRetailData } from '../../app/data/useRetailData'
import { useOperationIdentity } from '../../shared/hooks/useOperationIdentity'
import { useEscapeKey } from '../../shared/hooks/useEscapeKey'
import { parseMoney } from '../../shared/account-format'
import { RetailDataStatus } from '../../shared/ui/RetailDataStatus'
import { exportToExcel } from '../../shared/utils/exportUtils'
import type { PurchaseRecord } from '../purchases/purchases.types'
import type { SupplierLedgerEntry, SupplierPaymentMethod, SupplierPaymentRecord, SupplierRecord } from './suppliers.types'

const money = (value: number) => `Rs. ${value.toLocaleString('en-PK')}`
const dateLabel = (value: string | null) =>
  value
    ? new Date(`${value}T12:00:00`).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : '—'
const tones = ['blue', 'violet', 'red', 'orange', 'teal', 'brown', 'pink', 'green']
const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toUpperCase()

import { TopNavHeader } from '../../shared/layout/TopNavHeader'

function SuppliersHeader({ onNavigate }: { onNavigate?: (page: string) => void }) {
  return (
    <TopNavHeader
      title="Supplier Management"
      subtitle="Manage supplier records, purchases, payments and balances"
      onNavigate={onNavigate}
    />
  )
}

function SupplierStats({ suppliers }: { suppliers: SupplierRecord[] }) {
  const totalPurchases = suppliers.reduce((sum, supplier) => sum + supplier.totalPurchasesRupees, 0)
  const totalPaid = suppliers.reduce((sum, supplier) => sum + supplier.totalPaidRupees, 0)
  const outstanding = suppliers.reduce((sum, supplier) => sum + supplier.outstandingRupees, 0)
  const stats: [IconName, string, string, string, string, string][] = [
    ['users', 'Total Suppliers', String(suppliers.length), 'All registered suppliers', 'Live', 'purple'],
    ['cart', 'Total Purchases', money(totalPurchases), 'Total purchases from suppliers', 'Live', 'green'],
    ['wallet', 'Total Paid', money(totalPaid), 'Total amount paid to suppliers', 'Live', 'amber'],
    ['wallet', 'Outstanding Amount', money(outstanding), 'Total supplier due', 'Live', 'rose'],
  ]
  return (
    <div className="customer-stats">
      {stats.map(([icon, label, value, note, trend, tone]) => (
        <section className={`card customer-stat ${tone}`} key={label}>
          <span>
            <Icon name={icon} size={24} />
          </span>
          <div>
            <p>{label}</p>
            <strong>{value}</strong>
            <small>{note}</small>
          </div>
          <b className={tone === 'rose' ? 'negative' : ''}>{trend}</b>
        </section>
      ))}
    </div>
  )
}

function SuppliersTable({
  suppliers,
  selectedId,
  onSelect,
  onPaySupplier,
  onNewPurchase,
}: {
  suppliers: SupplierRecord[]
  selectedId: string
  onSelect: (id: string) => void
  onPaySupplier: (supplier: SupplierRecord) => void
  onNewPurchase: () => void
}) {
  const [tab, setTab] = useState('All Suppliers')
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [cityFilter, setCityFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [actionMenuId, setActionMenuId] = useState<string | null>(null)

  useEscapeKey(() => setActionMenuId(null), Boolean(actionMenuId))

  const categoryOptions = useMemo(() => {
    const unique = Array.from(
      new Set(
        suppliers
          .flatMap(s => (s.categories || '').split(',').map(part => part.trim()))
          .filter(Boolean)
      )
    ).sort()
    return [{ value: 'all', label: 'All Categories' }, ...unique.map(c => ({ value: c, label: c }))]
  }, [suppliers])

  const cityOptions = useMemo(() => {
    const unique = Array.from(new Set(suppliers.map(s => (s.city || '').trim()).filter(Boolean))).sort()
    return [{ value: 'all', label: 'All Cities' }, ...unique.map(c => ({ value: c, label: c }))]
  }, [suppliers])

  const filtered = suppliers.filter(supplier => {
    if (tab !== 'All Suppliers' && supplier.status !== tab) return false
    if (statusFilter !== 'all' && supplier.status !== statusFilter) return false
    if (cityFilter !== 'all' && (supplier.city || '').trim().toLowerCase() !== cityFilter.toLowerCase()) return false
    if (
      categoryFilter !== 'all' &&
      !(supplier.categories || '').toLowerCase().includes(categoryFilter.toLowerCase())
    ) {
      return false
    }
    return [supplier.name, supplier.phone, supplier.city, supplier.categories].some(value =>
      (value || '').toLowerCase().includes(search.toLowerCase())
    )
  })

  return (
    <section className="card customers-table-card suppliers-table-card">
      <div className="customer-tabs supplier-tabs">
        {['All Suppliers', 'Active', 'Inactive'].map(label => (
          <button key={label} className={tab === label ? 'active' : ''} onClick={() => setTab(label)}>
            {label}
          </button>
        ))}
      </div>
      <div className="customer-filters">
        <label>
          <Icon name="search" size={17} />
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            aria-label="Search supplier list"
            placeholder="Search suppliers by name, phone, city..."
          />
        </label>
        <CustomSelect
          ariaLabel="Filter suppliers by category"
          value={categoryFilter}
          onChange={setCategoryFilter}
          options={categoryOptions}
          minWidth={145}
        />
        <CustomSelect
          ariaLabel="Filter suppliers by city"
          value={cityFilter}
          onChange={setCityFilter}
          options={cityOptions}
          minWidth={135}
        />
        <CustomSelect
          ariaLabel="Filter suppliers by status"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: 'all', label: 'All Status' },
            { value: 'Active', label: 'Active' },
            { value: 'Inactive', label: 'Inactive' },
          ]}
          minWidth={130}
        />
        <button
          type="button"
          onClick={() => exportToExcel({
            filename: `suppliers-report-${new Date().toISOString().slice(0, 10)}.xls`,
            title: 'Suppliers & Payables Report',
            subtitle: `Total Suppliers: ${filtered.length}`,
            headers: ['Supplier Name', 'Contact Person', 'Phone', 'City', 'Total Purchases (Rs)', 'Balance Due (Rs)', 'Status'],
            rows: filtered.map(s => [
              s.name,
              s.contactPerson || '',
              s.phone || '',
              s.city || '',
              s.totalPurchasesRupees.toFixed(2),
              s.outstandingRupees.toFixed(2),
              s.status,
            ]),
          })}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            height: '40px',
            padding: '0 13px',
            border: '1px solid #dce4ef',
            borderRadius: '10px',
            background: '#ffffff',
            color: '#1e293b',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
            marginLeft: 'auto',
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>
          </svg>
          <span>Export Excel</span>
        </button>
        <button
          type="button"
          className="clear"
          onClick={() => {
            setSearch('')
            setCategoryFilter('all')
            setCityFilter('all')
            setStatusFilter('all')
          }}
        >
          Clear
        </button>
      </div>
      <div className="customers-table-scroll">
        <table>
          <thead>
            <tr>
              <th>
                <input type="checkbox" aria-label="Select all suppliers" />
              </th>
              <th>Supplier Name</th>
              <th>Phone</th>
              <th>City</th>
              <th>Total Purchases</th>
              <th>Total Paid</th>
              <th>Outstanding</th>
              <th>Last Purchase</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((supplier, index) => (
              <tr
                className={selectedId === supplier.id ? 'selected-supplier-row' : ''}
                key={supplier.id}
                onClick={() => onSelect(supplier.id)}
              >
                <td>
                  <input type="checkbox" aria-label={`Select ${supplier.name}`} />
                </td>
                <td>
                  <div className="customer-name">
                    <span className={tones[index % tones.length]}>{initials(supplier.name)}</span>
                    <strong>{supplier.name}</strong>
                  </div>
                </td>
                <td>{supplier.phone || '—'}</td>
                <td>{supplier.city || '—'}</td>
                <td>{money(supplier.totalPurchasesRupees)}</td>
                <td>{money(supplier.totalPaidRupees)}</td>
                <td className={supplier.outstandingRupees === 0 ? 'settled' : 'customer-due'}>
                  {money(supplier.outstandingRupees)}
                </td>
                <td>{dateLabel(supplier.lastPurchaseDate)}</td>
                <td>
                  <span className={`customer-status ${supplier.status.toLowerCase()}`}>{supplier.status}</span>
                </td>
                <td style={{ position: 'relative', zIndex: actionMenuId === supplier.id ? 60 : 1 }} onClick={event => event.stopPropagation()}>
                  <button
                    className="customer-more"
                    onClick={() => setActionMenuId(actionMenuId === supplier.id ? null : supplier.id)}
                    aria-label={`More actions for ${supplier.name}`}
                  >
                    •••
                  </button>
                  {actionMenuId === supplier.id && (
                    <div
                      className={`absolute right-2 ${index >= 2 || (filtered.length <= 4 && index >= 1) ? 'bottom-8' : 'top-8'} z-50 w-44 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 text-left text-xs animate-in fade-in`}
                      onClick={e => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setActionMenuId(null)
                          onSelect(supplier.id)
                        }}
                        className="w-full px-3 py-2 text-slate-700 hover:bg-purple-50 hover:text-[#5E0CF3] flex items-center gap-2 font-medium"
                      >
                        <Icon name="user" size={14} /> View Details
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActionMenuId(null)
                          onSelect(supplier.id)
                          onPaySupplier(supplier)
                        }}
                        className="w-full px-3 py-2 text-slate-700 hover:bg-purple-50 hover:text-[#5E0CF3] flex items-center gap-2 font-medium"
                      >
                        <Icon name="cash" size={14} /> Pay Supplier
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActionMenuId(null)
                          onNewPurchase()
                        }}
                        className="w-full px-3 py-2 text-slate-700 hover:bg-purple-50 hover:text-[#5E0CF3] flex items-center gap-2 font-medium"
                      >
                        <Icon name="cart" size={14} /> New Purchase
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="customer-pagination">
        <span>
          Showing {filtered.length ? 1 : 0} to {filtered.length} of {filtered.length} entries
        </span>
        <div>
          <button>‹</button>
          <button className="active">1</button>
          <button>›</button>
          <button className="page-size">
            10 / page <Icon name="chevron" size={13} />
          </button>
        </div>
      </div>
    </section>
  )
}

function SupplierDetails({
  supplier,
  purchases,
  payments,
  ledger,
  onPay,
  onNewPurchase,
  onViewAllPurchases,
}: {
  supplier: SupplierRecord
  purchases: PurchaseRecord[]
  payments: SupplierPaymentRecord[]
  ledger: SupplierLedgerEntry[]
  onPay: () => void
  onNewPurchase: () => void
  onViewAllPurchases: () => void
}) {
  const [tab, setTab] = useState('Purchase History')
  return (
    <section className="card customer-details supplier-details">
      <div className="customer-profile">
        <div className="customer-profile-heading">
          <span>{initials(supplier.name)}</span>
          <div>
            <h2>{supplier.name}</h2>
            <small className={supplier.status.toLowerCase()}>{supplier.status}</small>
          </div>
          <button>⌕ &nbsp; Edit</button>
        </div>
        <ul>
          <li>● <span>{supplier.phone || 'No phone available'}</span></li>
          <li>◆ <span>{supplier.city || 'No city available'}</span></li>
          <li>✉ <span>{supplier.email || 'No email available'}</span></li>
          <li>◆ <span>{supplier.categories || 'General'}</span></li>
          <li>◩ <span>{supplier.note || 'No notes available'}</span></li>
        </ul>
        <div className="customer-balance-cards">
          <div>
            <small>Total Purchases</small>
            <strong>{money(supplier.totalPurchasesRupees)}</strong>
          </div>
          <div>
            <small>Total Paid</small>
            <strong>{money(supplier.totalPaidRupees)}</strong>
          </div>
          <div>
            <small>Outstanding</small>
            <strong>{money(supplier.outstandingRupees)}</strong>
          </div>
        </div>
        <div className="customer-profile-actions">
          <button className="primary" onClick={onPay} disabled={supplier.outstandingRupees <= 0}>
            <Icon name="cash" size={16} /> Pay Supplier
          </button>
          <button onClick={onNewPurchase}>
            <Icon name="cart" size={16} /> New Purchase
          </button>
        </div>
      </div>
      <div className="customer-history-tabs">
        {['Purchase History', 'Payment History', 'Ledger'].map(label => (
          <button className={tab === label ? 'active' : ''} onClick={() => setTab(label)} key={label}>
            {label}
          </button>
        ))}
      </div>
      <div className="customer-history-scroll">
        {tab === 'Purchase History' && (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Invoice #</th>
                <th>Items</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {purchases.map(purchase => (
                <tr key={purchase.id}>
                  <td>{dateLabel(purchase.purchaseDate)}</td>
                  <td>{purchase.purchaseNumber}</td>
                  <td>{purchase.itemCount}</td>
                  <td>{money(purchase.totalAmountRupees)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'Payment History' && (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Method</th>
                <th>Reference</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {payments.map(payment => (
                <tr key={payment.id}>
                  <td>{dateLabel(payment.date)}</td>
                  <td>{payment.method}</td>
                  <td>{payment.reference || '—'}</td>
                  <td>{money(payment.amountRupees)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'Ledger' && (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Debit</th>
                <th>Credit</th>
                <th>Balance</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map(entry => (
                <tr key={entry.id}>
                  <td>{dateLabel(entry.date)}</td>
                  <td className="supplier-ledger-type">{entry.type.replaceAll('_', ' ')}</td>
                  <td>{money(entry.debitRupees)}</td>
                  <td>{money(entry.creditRupees)}</td>
                  <td>{money(entry.balanceAfterRupees)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {tab === 'Purchase History' && (
        <button className="view-customer-purchases" onClick={onViewAllPurchases}>
          View All Purchases
        </button>
      )}
    </section>
  )
}

function RecentSupplierPayments({
  payments,
  suppliers,
}: {
  payments: SupplierPaymentRecord[]
  suppliers: SupplierRecord[]
}) {
  return (
    <section className="card recent-customer-payments">
      <div className="customer-side-heading">
        <h2>
          <Icon name="money" size={18} /> Recent Payments
        </h2>
        <button>View All</button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Supplier</th>
            <th>Method</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {payments.slice(0, 5).map(payment => (
            <tr key={payment.id}>
              <td>{suppliers.find(supplier => supplier.id === payment.supplierId)?.name ?? 'Supplier'}</td>
              <td>{payment.method}</td>
              <td>{money(payment.amountRupees)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function SupplierPaymentModal({ supplier, onClose }: { supplier: SupplierRecord; onClose: () => void }) {
  const { paySupplier, busy } = useRetailData()
  const operation = useOperationIdentity('supplier-payment')
  const [amount, setAmount] = useState(supplier.outstandingRupees)
  const [method, setMethod] = useState<SupplierPaymentMethod>('Cash')
  const [reference, setReference] = useState('')
  const [error, setError] = useState('')

  useEscapeKey(onClose)

  const submit = async () => {
    setError('')
    try {
      const input = { supplierId: supplier.id, amount, method, reference }
      const result = await paySupplier(supplier.id, amount, method, reference, operation.idFor(input))
      if (!result.ok) return setError(result.error)
      operation.reset()
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Payment could not be submitted.')
    }
  }

  return (
    <div className="supplier-payment-backdrop" role="presentation" onClick={onClose}>
      <section
        className="card supplier-payment-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pay-supplier-title"
        onClick={e => e.stopPropagation()}
      >
        <div className="supplier-payment-heading">
          <div>
            <h2 id="pay-supplier-title">Pay Supplier</h2>
            <p>{supplier.name}</p>
          </div>
          <button onClick={onClose} aria-label="Close supplier payment" disabled={busy}>
            ×
          </button>
        </div>
        <div className="supplier-payment-body">
          <div className="supplier-payment-balance">
            <span>Outstanding Amount</span>
            <strong>{money(supplier.outstandingRupees)}</strong>
          </div>
          <label>
            Payment Amount (Rs)
            <input
              disabled={busy}
              type="number"
              min="0.01"
              step="0.01"
              max={supplier.outstandingRupees}
              value={amount || ''}
              onChange={event => setAmount(Number(event.target.value))}
            />
          </label>
          <label>
            Payment Method
            <CustomSelect
              disabled={busy}
              ariaLabel="Payment Method"
              value={method}
              onChange={val => setMethod(val as SupplierPaymentMethod)}
              options={['Cash', 'Bank Transfer', 'JazzCash', 'Easypaisa', 'Card'].map(value => ({
                value,
                label: value,
              }))}
              fullWidth
            />
          </label>
          <label>
            Reference
            <input
              disabled={busy}
              value={reference}
              onChange={event => setReference(event.target.value)}
              placeholder="Optional payment reference"
            />
          </label>
          {error && <p className="text-rose-600 text-sm font-semibold">{error}</p>}
        </div>
        <div className="supplier-payment-actions">
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="primary" disabled={busy} onClick={() => void submit()}>
            <Icon name="cash" size={15} /> Save Payment
          </button>
        </div>
      </section>
    </div>
  )
}

function AddSupplierModal({ onClose }: { onClose: () => void }) {
  const { createSupplier, busy } = useRetailData()
  const createOperation = useOperationIdentity('supplier-create')
  const [name, setName] = useState('')
  const [contactPerson, setContactPerson] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [ntnStrn, setNtnStrn] = useState('')
  const [city, setCity] = useState('')
  const [address, setAddress] = useState('')
  const [categories, setCategories] = useState('')
  const [openingBalance, setOpeningBalance] = useState('')
  const [paymentTerms, setPaymentTerms] = useState('Net 30')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEscapeKey(onClose)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('Supplier name is required.')
      return
    }
    setError('')
    setSubmitting(true)
    try {
      const openingBalancePaisa = openingBalance.trim() ? parseMoney(openingBalance) : 0
      const payload = {
        name: name.trim(),
        contactPerson: contactPerson.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        ntnStrn: ntnStrn.trim() || undefined,
        city: city.trim() || undefined,
        address: address.trim() || undefined,
        categories: categories.trim() || undefined,
        openingBalancePaisa,
        paymentTerms: paymentTerms.trim() || undefined,
        note: note.trim() || undefined,
      }
      const result = await createSupplier({
        ...payload,
        operationId: createOperation.idFor(payload),
      } as any)
      if (!result.ok) {
        setError(result.error || 'Failed to create supplier')
        return
      }
      createOperation.reset()
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to create supplier')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="supplier-payment-backdrop" role="presentation" onClick={onClose}>
      <section
        className="card supplier-payment-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-supplier-title"
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: 680, width: 'min(680px, 96vw)' }}
      >
        <div className="supplier-payment-heading">
          <div>
            <h2 id="add-supplier-title">Add New Supplier</h2>
            <p>Create a registered supplier for inventory purchases, tax records, and ledger tracking</p>
          </div>
          <button onClick={onClose} aria-label="Close add supplier" disabled={busy || submitting}>
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="supplier-payment-body" style={{ maxHeight: 'calc(80vh - 120px)', overflowY: 'auto', paddingRight: 4 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '14px 16px' }}>
              <label style={{ display: 'grid', gap: 6, fontSize: 13, fontWeight: 600, color: '#1e293b', gridColumn: 'span 2' }}>
                Company / Supplier Name *
                <input
                  required
                  autoFocus
                  disabled={busy || submitting}
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Al-Madina Wholesale Distributors"
                  style={{
                    height: 41,
                    padding: '0 12px',
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    fontSize: 14,
                  }}
                />
              </label>

              <label style={{ display: 'grid', gap: 6, fontSize: 13, fontWeight: 600, color: '#1e293b' }}>
                Contact Person Name
                <input
                  disabled={busy || submitting}
                  value={contactPerson}
                  onChange={e => setContactPerson(e.target.value)}
                  placeholder="e.g. Muhammad Aslam"
                  style={{
                    height: 41,
                    padding: '0 12px',
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    fontSize: 14,
                  }}
                />
              </label>

              <label style={{ display: 'grid', gap: 6, fontSize: 13, fontWeight: 600, color: '#1e293b' }}>
                Phone Number
                <input
                  disabled={busy || submitting}
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="e.g. 0300-1234567"
                  style={{
                    height: 41,
                    padding: '0 12px',
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    fontSize: 14,
                  }}
                />
              </label>

              <label style={{ display: 'grid', gap: 6, fontSize: 13, fontWeight: 600, color: '#1e293b' }}>
                Email Address
                <input
                  type="email"
                  disabled={busy || submitting}
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="e.g. supplier@domain.com"
                  style={{
                    height: 41,
                    padding: '0 12px',
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    fontSize: 14,
                  }}
                />
              </label>

              <label style={{ display: 'grid', gap: 6, fontSize: 13, fontWeight: 600, color: '#1e293b' }}>
                NTN / STRN (Tax ID)
                <input
                  disabled={busy || submitting}
                  value={ntnStrn}
                  onChange={e => setNtnStrn(e.target.value)}
                  placeholder="e.g. 1234567-8"
                  style={{
                    height: 41,
                    padding: '0 12px',
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    fontSize: 14,
                  }}
                />
              </label>

              <label style={{ display: 'grid', gap: 6, fontSize: 13, fontWeight: 600, color: '#1e293b' }}>
                City
                <input
                  disabled={busy || submitting}
                  value={city}
                  onChange={e => setCity(e.target.value)}
                  placeholder="e.g. Karachi"
                  style={{
                    height: 41,
                    padding: '0 12px',
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    fontSize: 14,
                  }}
                />
              </label>

              <label style={{ display: 'grid', gap: 6, fontSize: 13, fontWeight: 600, color: '#1e293b' }}>
                Category / Product Line
                <input
                  disabled={busy || submitting}
                  value={categories}
                  onChange={e => setCategories(e.target.value)}
                  placeholder="e.g. Grocery, Beverages"
                  style={{
                    height: 41,
                    padding: '0 12px',
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    fontSize: 14,
                  }}
                />
              </label>

              <label style={{ display: 'grid', gap: 6, fontSize: 13, fontWeight: 600, color: '#1e293b', gridColumn: 'span 2' }}>
                Street Address
                <input
                  disabled={busy || submitting}
                  value={address}
                  onChange={e => setAddress(e.target.value)}
                  placeholder="e.g. Shop # 14, Wholesale Market, Jodia Bazar"
                  style={{
                    height: 41,
                    padding: '0 12px',
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    fontSize: 14,
                  }}
                />
              </label>

              <label style={{ display: 'grid', gap: 6, fontSize: 13, fontWeight: 600, color: '#1e293b' }}>
                Opening Payable Balance (Rs)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  disabled={busy || submitting}
                  value={openingBalance}
                  onChange={e => setOpeningBalance(e.target.value)}
                  placeholder="0.00"
                  style={{
                    height: 41,
                    padding: '0 12px',
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    fontSize: 14,
                  }}
                />
              </label>

              <label style={{ display: 'grid', gap: 6, fontSize: 13, fontWeight: 600, color: '#1e293b' }}>
                Payment Terms
                <CustomSelect
                  disabled={busy || submitting}
                  ariaLabel="Payment Terms"
                  value={paymentTerms}
                  onChange={setPaymentTerms}
                  options={[
                    { value: 'Cash on Delivery', label: 'Cash on Delivery (COD)' },
                    { value: 'Net 7', label: 'Net 7 Days' },
                    { value: 'Net 15', label: 'Net 15 Days' },
                    { value: 'Net 30', label: 'Net 30 Days' },
                    { value: 'Advance', label: 'Advance Payment' },
                  ]}
                  fullWidth
                />
              </label>

              <label style={{ display: 'grid', gap: 6, fontSize: 13, fontWeight: 600, color: '#1e293b', gridColumn: 'span 2' }}>
                Notes / Terms
                <textarea
                  rows={2}
                  disabled={busy || submitting}
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="Any delivery instructions, contact timings, or agreement details..."
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    fontSize: 14,
                    resize: 'vertical',
                  }}
                />
              </label>
            </div>
            {error && <p className="text-rose-600 text-sm font-semibold mt-3">{error}</p>}
          </div>
          <div className="supplier-payment-actions">
            <button type="button" onClick={onClose} disabled={busy || submitting}>
              Cancel
            </button>
            <button
              type="submit"
              className="primary"
              disabled={busy || submitting || !name.trim()}
              style={{ color: '#ffffff' }}
            >
              <Icon name="check" size={15} />
              <span style={{ color: '#ffffff' }}>{submitting ? 'Saving…' : 'Save Supplier'}</span>
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

function ViewAllPurchasesModal({
  supplier,
  purchases,
  onClose,
}: {
  supplier: SupplierRecord
  purchases: PurchaseRecord[]
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  useEscapeKey(onClose)

  const filtered = purchases.filter(p =>
    p.purchaseNumber.toLowerCase().includes(search.toLowerCase()) ||
    (p.purchaseDate && p.purchaseDate.includes(search))
  )

  const totalAmount = purchases.reduce((sum, p) => sum + p.totalAmountRupees, 0)
  const totalPaid = purchases.reduce((sum, p) => sum + p.paidAmountRupees, 0)
  const totalDue = purchases.reduce((sum, p) => sum + p.dueAmountRupees, 0)

  return (
    <div className="product-modal-backdrop" role="presentation" onClick={onClose}>
      <aside
        className="card"
        role="dialog"
        aria-modal="true"
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(960px, 96vw)',
          maxHeight: 'calc(100vh - 48px)',
          borderRadius: 18,
          boxShadow: '0 24px 70px rgba(0,0,0,0.35)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          background: '#ffffff',
        }}
      >
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: 0 }}>
              Lifetime Purchase History — {supplier.name}
            </h2>
            <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0' }}>
              Complete record of all purchases received from this supplier
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', fontSize: 20, color: '#94a3b8', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, padding: '16px 24px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
          <div style={{ background: '#fff', padding: '12px 14px', borderRadius: 12, border: '1px solid #e2e8f0' }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block' }}>Total Invoices</span>
            <strong style={{ fontSize: 18, fontWeight: 700, color: '#0f172a' }}>{purchases.length}</strong>
          </div>
          <div style={{ background: '#fff', padding: '12px 14px', borderRadius: 12, border: '1px solid #e2e8f0' }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block' }}>Lifetime Purchases</span>
            <strong style={{ fontSize: 18, fontWeight: 700, color: '#10b981' }}>{money(totalAmount)}</strong>
          </div>
          <div style={{ background: '#fff', padding: '12px 14px', borderRadius: 12, border: '1px solid #e2e8f0' }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block' }}>Total Paid</span>
            <strong style={{ fontSize: 18, fontWeight: 700, color: '#6366f1' }}>{money(totalPaid)}</strong>
          </div>
          <div style={{ background: '#fff', padding: '12px 14px', borderRadius: 12, border: '1px solid #e2e8f0' }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block' }}>Outstanding Balance</span>
            <strong style={{ fontSize: 18, fontWeight: 700, color: totalDue > 0 ? '#ef4444' : '#10b981' }}>{money(totalDue)}</strong>
          </div>
        </div>

        <div style={{ padding: '12px 24px', borderBottom: '1px solid #f1f5f9' }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by invoice number or date (YYYY-MM-DD)..."
            style={{ width: '100%', height: 38, padding: '0 14px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13 }}
          />
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 24px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', height: 42 }}>
                <th style={{ padding: '8px 12px', fontWeight: 700, color: '#475569' }}>Invoice #</th>
                <th style={{ padding: '8px 12px', fontWeight: 700, color: '#475569' }}>Date</th>
                <th style={{ padding: '8px 12px', fontWeight: 700, color: '#475569' }}>Items</th>
                <th style={{ padding: '8px 12px', fontWeight: 700, color: '#475569' }}>Total Amount</th>
                <th style={{ padding: '8px 12px', fontWeight: 700, color: '#475569' }}>Paid</th>
                <th style={{ padding: '8px 12px', fontWeight: 700, color: '#475569' }}>Due</th>
                <th style={{ padding: '8px 12px', fontWeight: 700, color: '#475569' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '36px', color: '#94a3b8' }}>
                    No purchase records found.
                  </td>
                </tr>
              ) : (
                filtered.map(purchase => (
                  <tr key={purchase.id} style={{ borderBottom: '1px solid #f1f5f9', height: 46 }}>
                    <td style={{ padding: '8px 12px', fontWeight: 600, color: '#5E0CF3' }}>{purchase.purchaseNumber}</td>
                    <td style={{ padding: '8px 12px', color: '#64748b' }}>{dateLabel(purchase.purchaseDate)}</td>
                    <td style={{ padding: '8px 12px', color: '#334155' }}>{purchase.itemCount} items</td>
                    <td style={{ padding: '8px 12px', fontWeight: 700, color: '#0f172a' }}>{money(purchase.totalAmountRupees)}</td>
                    <td style={{ padding: '8px 12px', color: '#10b981', fontWeight: 600 }}>{money(purchase.paidAmountRupees)}</td>
                    <td style={{ padding: '8px 12px', color: purchase.dueAmountRupees > 0 ? '#ef4444' : '#10b981', fontWeight: 600 }}>
                      {money(purchase.dueAmountRupees)}
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      <span className={`purchase-status ${purchase.status.toLowerCase()}`}>
                        {purchase.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div style={{ padding: '16px 24px', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'flex-end', background: '#f8fafc' }}>
          <button
            onClick={onClose}
            style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', fontSize: 13, fontWeight: 600, color: '#475569', cursor: 'pointer' }}
          >
            Close
          </button>
        </div>
      </aside>
    </div>
  )
}

function SuppliersScreen({ onNavigate }: { onNavigate: (page: string) => void }) {
  const { suppliers, purchases, supplierPayments, supplierLedger } = useRetailData()
  const [selectedId, setSelectedId] = useState(suppliers[0]?.id ?? '')
  const [showPayment, setShowPayment] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [showLifetimePurchases, setShowLifetimePurchases] = useState(false)
  const [payingSupplier, setPayingSupplier] = useState<SupplierRecord | null>(null)

  useEscapeKey(() => {
    setShowPayment(false)
    setShowAddModal(false)
    setPayingSupplier(null)
    setShowLifetimePurchases(false)
  }, showPayment || showAddModal || Boolean(payingSupplier) || showLifetimePurchases)

  const selected = suppliers.find(supplier => supplier.id === selectedId) ?? suppliers[0]
  const selectedPurchases = useMemo(
    () => (selected ? purchases.filter(purchase => purchase.supplierId === selected.id) : []),
    [purchases, selected]
  )
  const selectedPayments = supplierPayments.filter(payment => payment.supplierId === selected?.id)
  const selectedLedger = supplierLedger.filter(entry => entry.supplierId === selected?.id)

  const handlePaySupplier = (supplier: SupplierRecord) => {
    setPayingSupplier(supplier)
    setShowPayment(true)
  }

  return (
    <motion.main
      className="customers-page suppliers-page"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18 }}
    >
      <div className="customers-title-row">
        <div className="customers-title">
          <span>
            <Icon name="supplier" size={28} />
          </span>
          <div>
            <h1>Suppliers</h1>
            <p>Manage supplier records, purchases, payments and outstanding balances</p>
          </div>
        </div>
        <button
          className="add-customer"
          onClick={() => setShowAddModal(true)}
          title="Add a new supplier"
          style={{ color: '#ffffff' }}
        >
          <Icon name="plus" size={18} />
          <span style={{ color: '#ffffff' }}>+ Add Supplier</span>
        </button>
      </div>
      <RetailDataStatus />
      <SupplierStats suppliers={suppliers} />
      <div className="customers-layout">
        <SuppliersTable
          suppliers={suppliers}
          selectedId={selected?.id ?? ''}
          onSelect={setSelectedId}
          onPaySupplier={handlePaySupplier}
          onNewPurchase={() => onNavigate('Purchases')}
        />
        <aside className="customers-side">
          {selected && (
            <SupplierDetails
              supplier={selected}
              purchases={selectedPurchases}
              payments={selectedPayments}
              ledger={selectedLedger}
              onPay={() => {
                setPayingSupplier(selected)
                setShowPayment(true)
              }}
              onNewPurchase={() => onNavigate('Purchases')}
              onViewAllPurchases={() => setShowLifetimePurchases(true)}
            />
          )}
          <RecentSupplierPayments payments={supplierPayments} suppliers={suppliers} />
        </aside>
      </div>
      {showPayment && (payingSupplier || selected) && (
        <SupplierPaymentModal
          supplier={payingSupplier || selected}
          onClose={() => {
            setShowPayment(false)
            setPayingSupplier(null)
          }}
        />
      )}
      {showAddModal && <AddSupplierModal onClose={() => setShowAddModal(false)} />}
      {showLifetimePurchases && selected && (
        <ViewAllPurchasesModal
          supplier={selected}
          purchases={selectedPurchases}
          onClose={() => setShowLifetimePurchases(false)}
        />
      )}
    </motion.main>
  )
}

export default function SuppliersPage(props: PageProps) {
  return (
    <PageShell
      {...props}
      activePage="Suppliers"
      className="customers-app suppliers-app"
      header={() => <SuppliersHeader onNavigate={props.onNavigate} />}
    >
      <SuppliersScreen onNavigate={props.onNavigate} />
    </PageShell>
  )
}
