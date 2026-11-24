import { useAuth } from '../../app/auth/useAuth'
import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Icon, type IconName } from '../../shared/ui/Icon'
import { PageShell, type PageProps } from '../../shared/layout/PageShell'
import { useRetailData } from '../../app/data/useRetailData'
import { useOperationIdentity } from '../../shared/hooks/useOperationIdentity'
import { useEscapeKey } from '../../shared/hooks/useEscapeKey'
import { RetailDataStatus } from '../../shared/ui/RetailDataStatus'
import type { PurchaseDraft, PurchaseRecord } from './purchases.types'

const money = (value: number) => `Rs. ${value.toLocaleString('en-PK')}`
const dateLabel = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
import { TopNavHeader } from '../../shared/layout/TopNavHeader'
import { DateRangeFilter } from '../../shared/ui/DateRangeFilter'
import { exportToExcel } from '../../shared/utils/exportUtils'

const lineTotalPaisa = (item: PurchaseDraft['items'][number]) =>
  Math.round(item.quantity * item.unitCostRupees * 100)

function PurchasesHeader({ onNavigate }: { onNavigate?: (page: string) => void }) {
  return (
    <TopNavHeader
      title="Purchases & Orders"
      subtitle="Manage supplier purchases, invoices and inventory intake"
      onNavigate={onNavigate}
    />
  )
}

function PurchaseStats({ purchases }: { purchases: PurchaseRecord[] }) {
  const totalAmount = purchases.reduce((sum, purchase) => sum + purchase.totalAmountRupees, 0)
  const totalPaid = purchases.reduce((sum, purchase) => sum + purchase.paidAmountRupees, 0)
  const outstanding = purchases.reduce((sum, purchase) => sum + purchase.dueAmountRupees, 0)
  const stats: [IconName, string, string, string, string][] = [
    ['cart', 'Total Purchases', money(totalAmount), 'Live total', 'purple'],
    ['report', 'Total Paid', money(totalPaid), 'Recorded payments', 'green'],
    ['clock', 'Outstanding Amount', money(outstanding), 'Supplier due', 'amber'],
    ['box', 'Total Purchases', String(purchases.length), 'All records', 'blue'],
  ]
  return (
    <div className="purchase-stats">
      {stats.map(([icon, label, value, note, tone], index) => (
        <section className={`card purchase-stat ${tone}`} key={`${label}-${index}`}>
          <span>
            <Icon name={icon} size={24} />
          </span>
          <div>
            <p>{label}</p>
            <strong>{value}</strong>
            <small>{note}</small>
          </div>
        </section>
      ))}
    </div>
  )
}

function PurchasesTable({
  purchases,
  onViewPurchase,
}: {
  purchases: PurchaseRecord[]
  onViewPurchase?: (purchase: PurchaseRecord) => void
}) {
  const [tab, setTab] = useState('All Purchases')
  const [search, setSearch] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [supplier, setSupplier] = useState('all')
  const [status, setStatus] = useState('all')
  const [actionMenuId, setActionMenuId] = useState<string | null>(null)
  const [copiedInvoice, setCopiedInvoice] = useState<string | null>(null)

  useEscapeKey(() => setActionMenuId(null), Boolean(actionMenuId))

  const filtered = purchases.filter(
    purchase =>
      (tab !== 'Pending Payments' || purchase.dueAmountRupees > 0) &&
      (!fromDate || purchase.purchaseDate >= fromDate) &&
      (!toDate || purchase.purchaseDate <= toDate) &&
      (supplier === 'all' || purchase.supplier === supplier) &&
      (status === 'all' || purchase.status === status) &&
      [purchase.purchaseNumber, purchase.supplier, purchase.supplierInvoiceNumber].some(value =>
        value.toLowerCase().includes(search.toLowerCase())
      )
  )

  const copyInvoiceNumber = (num: string) => {
    navigator.clipboard?.writeText(num)
    setCopiedInvoice(num)
    setTimeout(() => setCopiedInvoice(null), 2000)
  }

  return (
    <section className="card purchases-table-card">
      <div className="purchase-tabs">
        {['All Purchases', 'Purchase Orders', 'Pending Payments'].map(label => (
          <button
            key={label}
            className={tab === label ? 'active' : ''}
            disabled={label === 'Purchase Orders'}
            title={label === 'Purchase Orders' ? 'Purchase orders are planned for a later phase.' : undefined}
            onClick={() => setTab(label)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="purchase-filters">
        <label>
          <Icon name="search" size={17} />
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            aria-label="Search purchase list"
            placeholder="Search by invoice no, supplier name..."
          />
        </label>
        <input
          type="date"
          aria-label="Purchases from date"
          value={fromDate}
          onChange={event => setFromDate(event.target.value)}
        />
        <input
          type="date"
          aria-label="Purchases to date"
          value={toDate}
          onChange={event => setToDate(event.target.value)}
        />
        <select
          aria-label="Filter purchases by supplier"
          value={supplier}
          onChange={event => setSupplier(event.target.value)}
        >
          <option value="all">All Suppliers</option>
          {Array.from(new Set(purchases.map(item => item.supplier))).map(name => (
            <option key={name}>{name}</option>
          ))}
        </select>
        <select
          aria-label="Filter purchases by status"
          value={status}
          onChange={event => setStatus(event.target.value)}
        >
          {['all', 'Paid', 'Partial', 'Unpaid'].map(value => (
            <option value={value} key={value}>
              {value === 'all' ? 'All Status' : value}
            </option>
          ))}
        </select>
        <button
          className="clear"
          onClick={() => {
            setSearch('')
            setFromDate('')
            setToDate('')
            setSupplier('all')
            setStatus('all')
          }}
        >
          Clear
        </button>
        <button
          type="button"
          onClick={() => exportToExcel({
            filename: `purchases-report-${new Date().toISOString().slice(0, 10)}.xls`,
            title: 'Purchases & Inward Orders Report',
            subtitle: `Total Purchases: ${filtered.length}`,
            headers: ['Purchase #', 'Date', 'Supplier', 'Invoice #', 'Total Amount (Rs)', 'Paid Amount (Rs)', 'Due Amount (Rs)', 'Status'],
            rows: filtered.map(p => [
              p.purchaseNumber,
              dateLabel(p.purchaseDate),
              p.supplier,
              p.supplierInvoiceNumber || '',
              p.totalAmountRupees.toFixed(2),
              p.paidAmountRupees.toFixed(2),
              p.dueAmountRupees.toFixed(2),
              p.status,
            ]),
          })}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            height: '38px',
            padding: '0 13px',
            border: '1px solid #dce4ef',
            borderRadius: '8px',
            background: '#ffffff',
            color: '#1e293b',
            fontSize: '12.5px',
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>
          </svg>
          <span>Export Excel</span>
        </button>
      </div>
      <div className="purchases-table-scroll">
        <table>
          <thead>
            <tr>
              <th>
                <input type="checkbox" aria-label="Select all purchases" />
              </th>
              <th>Invoice #</th>
              <th>Date</th>
              <th>Supplier</th>
              <th>Items</th>
              <th>Total Amount</th>
              <th>Paid Amount</th>
              <th>Due Amount</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((purchase, index) => (
              <tr key={purchase.id}>
                <td>
                  <input type="checkbox" aria-label={`Select ${purchase.purchaseNumber}`} />
                </td>
                <td>
                  <b>{purchase.purchaseNumber}</b>
                </td>
                <td>{dateLabel(purchase.purchaseDate)}</td>
                <td>
                  <strong>{purchase.supplier}</strong>
                </td>
                <td>{purchase.itemCount} Items</td>
                <td>
                  <strong>{money(purchase.totalAmountRupees)}</strong>
                </td>
                <td>{money(purchase.paidAmountRupees)}</td>
                <td>{money(purchase.dueAmountRupees)}</td>
                <td>
                  <span className={`purchase-status ${purchase.status.toLowerCase()}`}>{purchase.status}</span>
                </td>
                <td style={{ position: 'relative', zIndex: actionMenuId === purchase.id ? 60 : 1 }}>
                  <button
                    className="purchase-more"
                    onClick={() => setActionMenuId(actionMenuId === purchase.id ? null : purchase.id)}
                    aria-label={`More actions for ${purchase.purchaseNumber}`}
                  >
                    •••
                  </button>
                  {actionMenuId === purchase.id && (
                    <div
                      className={`absolute right-2 ${index >= 2 || (filtered.length <= 4 && index >= 1) ? 'bottom-8' : 'top-8'} z-50 w-48 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 text-left text-xs animate-in fade-in`}
                      onClick={e => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setActionMenuId(null)
                          onViewPurchase?.(purchase)
                        }}
                        className="w-full px-3 py-2 text-slate-700 hover:bg-purple-50 hover:text-[#5E0CF3] flex items-center gap-2 font-medium"
                      >
                        <Icon name="report" size={14} /> View Details
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActionMenuId(null)
                          window.print()
                        }}
                        className="w-full px-3 py-2 text-slate-700 hover:bg-purple-50 hover:text-[#5E0CF3] flex items-center gap-2 font-medium"
                      >
                        <Icon name="receipt" size={14} /> Print Invoice
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActionMenuId(null)
                          copyInvoiceNumber(purchase.purchaseNumber)
                        }}
                        className="w-full px-3 py-2 text-slate-700 hover:bg-purple-50 hover:text-[#5E0CF3] flex items-center gap-2 font-medium"
                      >
                        <Icon name="key" size={14} />{' '}
                        {copiedInvoice === purchase.purchaseNumber ? 'Copied!' : 'Copy Invoice #'}
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="purchase-pagination">
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

function PurchaseQuickActions({
  onNew,
  onNavigate,
  disabled,
}: {
  onNew: () => void
  onNavigate: (page: string) => void
  disabled: boolean
}) {
  const actions: [IconName, string][] = [
    ['plus', 'New Purchase'],
    ['receipt', 'Import Purchases'],
    ['download', 'Export Purchases'],
    ['users', 'Manage Suppliers'],
    ['box', 'Stock Adjustment'],
  ]
  return (
    <section className="card purchase-quick-actions">
      <div className="purchase-side-heading">
        <h2>
          <Icon name="bolt" size={19} /> Quick Actions
        </h2>
      </div>
      <div>
        {actions.map(([icon, label], index) => (
          <button
            disabled={
              (label === 'New Purchase' && disabled) || ['Import Purchases', 'Export Purchases'].includes(label)
            }
            onClick={
              label === 'New Purchase'
                ? onNew
                : label === 'Manage Suppliers'
                ? () => onNavigate('Suppliers')
                : label === 'Stock Adjustment'
                ? () => onNavigate('Inventory')
                : undefined
            }
            key={label}
            className={index === 0 ? 'primary' : ''}
          >
            <Icon name={icon} size={17} />
            {label}
          </button>
        ))}
      </div>
    </section>
  )
}

function RecentPurchasesPanel({ purchases }: { purchases: PurchaseRecord[] }) {
  return (
    <section className="card recent-purchases">
      <div className="purchase-side-heading">
        <h2>
          <Icon name="clock" size={19} /> Recent Purchases
        </h2>
        <button>View All</button>
      </div>
      <div>
        {purchases.slice(0, 5).map(purchase => (
          <button className="recent-purchase-row" key={purchase.id}>
            <span>
              <strong>{purchase.supplier}</strong>
              <small>{dateLabel(purchase.purchaseDate)}</small>
            </span>
            <span>
              <strong>{money(purchase.totalAmountRupees)}</strong>
              <small className={`purchase-status ${purchase.status.toLowerCase()}`}>{purchase.status}</small>
            </span>
            <Icon name="chevron" size={16} />
          </button>
        ))}
      </div>
    </section>
  )
}

function NewPurchaseModal({ onClose }: { onClose: () => void }) {
  const { can } = useAuth()
  const { products, receivePurchase, busy, businessDate } = useRetailData()
  const operation = useOperationIdentity('purchase')
  const available = products.filter(product => product.status === 'active')
  const [draft, setDraft] = useState<PurchaseDraft>({
    supplier: '',
    supplierInvoiceNumber: '',
    purchaseDate: businessDate,
    paidAmountRupees: 0,
    paymentMethod: 'Cash',
    items: [
      {
        productId: available[0]?.id ?? '',
        quantity: 1,
        unitCostRupees: available[0]?.purchasePriceRupees ?? 0,
      },
    ],
  })
  const [error, setError] = useState('')

  useEscapeKey(onClose)

  const total = useMemo(
    () => draft.items.reduce((sum, item) => sum + lineTotalPaisa(item), 0) / 100,
    [draft.items]
  )
  const setItem = (index: number, patch: Partial<PurchaseDraft['items'][number]>) =>
    setDraft(current => ({
      ...current,
      items: current.items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    }))
  const submit = async () => {
    setError('')
    try {
      const result = await receivePurchase(draft, operation.idFor(draft))
      if (!result.ok) return setError(result.error)
      operation.reset()
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Purchase could not be submitted.')
    }
  }

  return (
    <div className="purchase-modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="card purchase-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-purchase-title"
        onClick={e => e.stopPropagation()}
      >
        <div className="purchase-modal-heading">
          <div>
            <h2 id="new-purchase-title">New Purchase</h2>
            <p>Receive supplier stock and record payment</p>
          </div>
          <button onClick={onClose} aria-label="Close new purchase" disabled={busy}>
            ×
          </button>
        </div>
        <div className="purchase-modal-body">
          <div className="purchase-document-fields">
            <label>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                Supplier <em style={{ color: '#e63650', fontStyle: 'normal' }}>*</em>
              </span>
              <input
                disabled={busy}
                value={draft.supplier}
                onChange={event => setDraft(current => ({ ...current, supplier: event.target.value }))}
                placeholder="Supplier name"
              />
            </label>
            <label>
              <span>Supplier Invoice</span>
              <input
                disabled={busy}
                value={draft.supplierInvoiceNumber}
                onChange={event =>
                  setDraft(current => ({ ...current, supplierInvoiceNumber: event.target.value }))
                }
                placeholder="Optional reference"
              />
            </label>
            <label>
              <span>Purchase Date</span>
              <input
                disabled={busy}
                type="date"
                value={draft.purchaseDate}
                onChange={event => setDraft(current => ({ ...current, purchaseDate: event.target.value }))}
              />
            </label>
          </div>
          <div className="purchase-items-heading">
            <h3>Purchase Items</h3>
            <button
              disabled={busy}
              onClick={() =>
                setDraft(current => ({
                  ...current,
                  items: [...current.items, { productId: '', quantity: 1, unitCostRupees: 0 }],
                }))
              }
            >
              <Icon name="plus" size={14} /> Add Item
            </button>
          </div>
          <div className="purchase-line-list">
            {draft.items.map((item, index) => (
              <div className="purchase-line" key={index}>
                <label>
                  <span>Product</span>
                  <select
                    disabled={busy}
                    value={item.productId}
                    onChange={event => {
                      const product = products.find(entry => entry.id === event.target.value)
                      setItem(index, {
                        productId: event.target.value,
                        unitCostRupees: product?.purchasePriceRupees ?? 0,
                      })
                    }}
                  >
                    <option value="">Select product</option>
                    {available.map(product => (
                      <option value={product.id} key={product.id}>
                        {product.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Quantity</span>
                  <input
                    disabled={busy}
                    type="number"
                    min="0.001"
                    step="0.001"
                    value={item.quantity}
                    onChange={event => setItem(index, { quantity: Number(event.target.value) })}
                  />
                </label>
                <label>
                  <span>Unit Cost</span>
                  <input
                    disabled={busy}
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.unitCostRupees || ''}
                    onChange={event => setItem(index, { unitCostRupees: Number(event.target.value) })}
                  />
                </label>
                <strong>{money(lineTotalPaisa(item) / 100)}</strong>
                <button
                  disabled={busy}
                  onClick={() =>
                    setDraft(current => ({
                      ...current,
                      items: current.items.filter((_, itemIndex) => itemIndex !== index),
                    }))
                  }
                  aria-label="Remove purchase item"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className="purchase-payment-fields">
            <label>
              <span>Amount Paid (Rs)</span>
              <input
                disabled={busy || !can('suppliers.pay')}
                type="number"
                min="0"
                step="0.01"
                max={total}
                value={draft.paidAmountRupees || ''}
                onChange={event => setDraft(current => ({ ...current, paidAmountRupees: Number(event.target.value) }))}
              />
            </label>
            <label>
              <span>Payment Method</span>
              <select
                disabled={busy || !can('suppliers.pay')}
                value={draft.paymentMethod}
                onChange={event =>
                  setDraft(current => ({
                    ...current,
                    paymentMethod: event.target.value as PurchaseDraft['paymentMethod'],
                  }))
                }
              >
                {['Cash', 'Bank Transfer', 'JazzCash', 'Easypaisa', 'Card'].map(method => (
                  <option key={method}>{method}</option>
                ))}
              </select>
            </label>
            <div>
              <span>Total</span>
              <strong>{money(total)}</strong>
            </div>
            <div>
              <span>Due</span>
              <strong>{money(Math.max(0, total - draft.paidAmountRupees))}</strong>
            </div>
          </div>
          {error && <p className="purchase-form-error">{error}</p>}
        </div>
        <div className="purchase-modal-actions">
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="primary" disabled={busy} onClick={() => void submit()} style={{ color: '#ffffff' }}>
            <Icon name="check" size={15} />
            <span style={{ color: '#ffffff' }}>Receive Purchase</span>
          </button>
        </div>
      </section>
    </div>
  )
}

function PurchaseDetailModal({
  purchase,
  onClose,
}: {
  purchase: PurchaseRecord
  onClose: () => void
}) {
  useEscapeKey(onClose)
  return (
    <div className="purchase-modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="card purchase-modal"
        role="dialog"
        aria-modal="true"
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: 540 }}
      >
        <div className="purchase-modal-heading">
          <div>
            <h2>Invoice #{purchase.purchaseNumber}</h2>
            <p>
              {purchase.supplier} · {dateLabel(purchase.purchaseDate)}
            </p>
          </div>
          <button onClick={onClose}>×</button>
        </div>
        <div className="purchase-modal-body space-y-3">
          <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded-xl text-xs">
            <div>
              <span className="text-slate-400 block">Supplier</span>
              <strong className="text-slate-800 text-sm">{purchase.supplier}</strong>
            </div>
            <div>
              <span className="text-slate-400 block">Supplier Invoice</span>
              <strong className="text-slate-800 text-sm">{purchase.supplierInvoiceNumber || '—'}</strong>
            </div>
            <div>
              <span className="text-slate-400 block">Total Amount</span>
              <strong className="text-purple-600 text-sm">{money(purchase.totalAmountRupees)}</strong>
            </div>
            <div>
              <span className="text-slate-400 block">Paid Amount</span>
              <strong className="text-emerald-600 text-sm">{money(purchase.paidAmountRupees)}</strong>
            </div>
            <div>
              <span className="text-slate-400 block">Due Amount</span>
              <strong className={purchase.dueAmountRupees > 0 ? 'text-rose-600 text-sm' : 'text-slate-800 text-sm'}>
                {money(purchase.dueAmountRupees)}
              </strong>
            </div>
            <div>
              <span className="text-slate-400 block">Status</span>
              <span className={`purchase-status ${purchase.status.toLowerCase()}`}>{purchase.status}</span>
            </div>
          </div>
        </div>
        <div className="purchase-modal-actions">
          <button onClick={onClose}>Close</button>
          <button className="primary" onClick={() => window.print()} style={{ color: '#ffffff' }}>
            <Icon name="receipt" size={15} />
            <span style={{ color: '#ffffff' }}>Print Invoice</span>
          </button>
        </div>
      </section>
    </div>
  )
}

function PurchasesScreen({ onNavigate }: { onNavigate: (page: string) => void }) {
  const { purchases, loading, busy, error } = useRetailData()
  const [showForm, setShowForm] = useState(false)
  const [selectedPurchase, setSelectedPurchase] = useState<PurchaseRecord | null>(null)

  useEscapeKey(() => {
    setShowForm(false)
    setSelectedPurchase(null)
  }, showForm || Boolean(selectedPurchase))

  return (
    <motion.main
      className="purchases-page"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18 }}
    >
      <div className="purchases-title-row">
        <div className="purchases-title">
          <span>
            <Icon name="cart" size={28} />
          </span>
          <div>
            <h1>Purchases</h1>
            <p>Manage supplier purchases and stock inward</p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <DateRangeFilter />
          <button
            className="new-purchase"
            disabled={loading || busy || Boolean(error)}
            onClick={() => setShowForm(true)}
            style={{ color: '#ffffff' }}
          >
            <Icon name="plus" size={18} />
            <span style={{ color: '#ffffff' }}>New Purchase</span>
          </button>
        </div>
      </div>
      <RetailDataStatus />
      <PurchaseStats purchases={purchases} />
      <div className="purchases-layout">
        <PurchasesTable purchases={purchases} onViewPurchase={setSelectedPurchase} />
        <aside className="purchases-side">
          <PurchaseQuickActions
            onNew={() => setShowForm(true)}
            onNavigate={onNavigate}
            disabled={loading || busy || Boolean(error)}
          />
          <RecentPurchasesPanel purchases={purchases} />
        </aside>
      </div>
      {showForm && <NewPurchaseModal onClose={() => setShowForm(false)} />}
      {selectedPurchase && (
        <PurchaseDetailModal purchase={selectedPurchase} onClose={() => setSelectedPurchase(null)} />
      )}
    </motion.main>
  )
}

export default function PurchasesPage(props: PageProps) {
  return (
    <PageShell
      {...props}
      activePage="Purchases"
      className="purchases-app"
      header={() => <PurchasesHeader onNavigate={props.onNavigate} />}
    >
      <PurchasesScreen onNavigate={props.onNavigate} />
    </PageShell>
  )
}
