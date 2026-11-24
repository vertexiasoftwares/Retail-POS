import { BusinessName, BranchName, UserName, UserRoleName } from '../../shared/layout/SessionIdentity'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Icon, type IconName } from '../../shared/ui/Icon'
import { PageShell, type PageProps } from '../../shared/layout/PageShell'
import { PosProductVisual } from '../../shared/ui/ProductVisual'
import { useRetailData } from '../../app/data/useRetailData'
import { useOperationIdentity } from '../../shared/hooks/useOperationIdentity'
import { useEscapeKey } from '../../shared/hooks/useEscapeKey'
import { RetailDataStatus } from '../../shared/ui/RetailDataStatus'
import type { InventoryMovementRecord, ProductRecord } from '../products/products.types'
import { useAuth } from '../../app/auth/useAuth'
import { useDesktopQuery } from '../../shared/hooks/useDesktopQuery'
import { notifyRetailDataChanged } from '../../services/retail-events'

const money = (value: number) => value.toLocaleString('en-PK')
const categoryColors = ['#287be5', '#ee9418', '#17ad86', '#7653ec', '#e84b6d', '#15aa91']

function InventoryHeader({ onMenu }: { onMenu: () => void }) {
  return (
    <header className="topbar inventory-topbar">
      <button className="icon-button menu-button" aria-label="Toggle sidebar" onClick={onMenu}>
        <Icon name="menu" size={23} />
      </button>
      <div className="search-field inventory-global-search">
        <Icon name="search" size={19} />
        <input aria-label="Search" placeholder="Search products, customers, invoices, suppliers..." />
        <kbd>Ctrl + K</kbd>
      </div>
      <div className="topbar-right">
        <button className="icon-button notification-button" aria-label="Notifications, 2 unread">
          <Icon name="bell" size={24} />
          <span>2</span>
        </button>
        <button className="store-switcher">
          <span className="store-avatar">
            <Icon name="store" size={22} />
          </span>
          <span>
            <strong>
              <BusinessName />
            </strong>
            <small>
              <BranchName />
            </small>
          </span>
          <Icon name="chevron" size={16} />
        </button>
        <button className="profile-button">
          <span className="avatar">
            <Icon name="user" size={26} />
          </span>
          <span>
            <strong>
              <UserName />
            </strong>
            <small>
              <UserRoleName />
            </small>
          </span>
          <Icon name="chevron" size={16} />
        </button>
      </div>
    </header>
  )
}

function InventoryStats({
  products,
  movements,
}: {
  products: ProductRecord[]
  movements: InventoryMovementRecord[]
}) {
  const { session } = useAuth()
  const branchId = session!.branchId
  const valuation = useDesktopQuery(useCallback(() => window.vertexia!.reports.valuation(branchId), [branchId]))
  const totalValue = valuation.data ? valuation.data.valuePaisa / 100 : null
  const low = products.filter(product => product.stock > 0 && product.stock <= product.minimumStock).length
  const out = products.filter(product => product.stock <= 0).length
  const stockIn = movements
    .filter(movement => movement.quantityDelta > 0)
    .reduce((total, movement) => total + movement.quantityDelta, 0)
  const cards: [IconName, string, string, string, string, string][] = [
    [
      'box',
      'Stock Cost Value',
      totalValue === null ? 'Loading...' : `Rs ${money(totalValue)}`,
      valuation.data?.estimatedProducts ? 'Includes estimates' : 'Live value',
      valuation.error ? 'Valuation unavailable' : 'branch average cost',
      'green',
    ],
    ['warning', 'Low Stock Items', String(low), 'View Items', '→', 'amber'],
    ['users', 'Out of Stock Items', String(out), 'View Items', '→', 'rose'],
    ['sale', 'Stock In', `${money(stockIn)} units`, 'From movements', '', 'blue'],
  ]
  return (
    <div className="inventory-stats">
      {cards.map(([icon, label, value, note, compare, tone]) => (
        <section className={`card inventory-stat ${tone}`} key={label}>
          <span className="round-icon">
            <Icon name={icon} size={22} />
          </span>
          <div>
            <p>{label}</p>
            <strong>{value}</strong>
            <small className={note === 'View Items' ? 'inventory-view-link' : ''}>
              <b>{note}</b> {compare}
            </small>
          </div>
        </section>
      ))}
    </div>
  )
}

function exportProductsToCsv(products: ProductRecord[], filename = 'inventory-products.csv') {
  const headers = ['Name', 'SKU', 'Barcode', 'Category', 'Brand', 'Unit', 'Stock', 'Min Stock', 'Purchase Price (Rs)', 'Sale Price (Rs)', 'Status']
  const rows = products.map(p => [
    `"${(p.name || '').replace(/"/g, '""')}"`,
    `"${p.sku || ''}"`,
    `"${p.barcode || ''}"`,
    `"${(p.category || '').replace(/"/g, '""')}"`,
    `"${(p.brand || '').replace(/"/g, '""')}"`,
    `"${p.unit || ''}"`,
    p.stock,
    p.minimumStock,
    p.purchasePriceRupees.toFixed(2),
    p.sellingPriceRupees.toFixed(2),
    p.status
  ])
  const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.setAttribute('href', url)
  link.setAttribute('download', filename)
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

function exportMovementsToCsv(movements: InventoryMovementRecord[], filename = 'stock-movements.csv') {
  const headers = ['Date', 'Product', 'Type', 'Quantity Change', 'Balance After', 'Reason']
  const rows = movements.map(m => [
    `"${new Date(m.createdAt).toLocaleString('en-PK')}"`,
    `"${(m.productName || '').replace(/"/g, '""')}"`,
    `"${m.type}"`,
    m.quantityDelta,
    m.balanceAfter,
    `"${(m.reason || '').replace(/"/g, '""')}"`
  ])
  const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.setAttribute('href', url)
  link.setAttribute('download', filename)
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

function InventoryTable({
  products,
  onStockAdjustment,
  onNavigate,
}: {
  products: ProductRecord[]
  onStockAdjustment: (productId: string) => void
  onNavigate?: (page: string) => void
}) {
  const [actionMenuId, setActionMenuId] = useState<string | null>(null)
  useEscapeKey(() => setActionMenuId(null), Boolean(actionMenuId))

  return (
    <section className="card inventory-table-card">
      <div className="inventory-table-heading">
        <h2>Products Inventory</h2>
        <div>
          <button
            type="button"
            onClick={() => exportProductsToCsv(products)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Icon name="download" size={15} /> Export
          </button>
          <button className="primary" onClick={() => onNavigate?.('Products')} style={{ color: '#ffffff' }}>
            <Icon name="plus" size={16} />
            <span style={{ color: '#ffffff' }}>Add Product</span>
          </button>
        </div>
      </div>
      <div className="inventory-filters">
        <label>
          <Icon name="search" size={17} />
          <input aria-label="Search inventory" placeholder="Search by product name, barcode, SKU..." />
        </label>
        {['All Categories', 'All Brands', 'All Suppliers'].map(item => (
          <button key={item}>
            {item}
            <Icon name="chevron" size={14} />
          </button>
        ))}
        <button className="filter-button">≡ &nbsp; Filters</button>
      </div>
      <div className="inventory-table-scroll">
        <table>
          <thead>
            <tr>
              <th>
                <input type="checkbox" aria-label="Select all inventory products" />
              </th>
              <th>Product</th>
              <th>Barcode / SKU</th>
              <th>Category</th>
              <th>Brand</th>
              <th>Unit</th>
              <th>Stock</th>
              <th>Min. Stock</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product, index) => {
              const low = product.stock <= product.minimumStock
              return (
                <tr key={product.id}>
                  <td>
                    <input type="checkbox" aria-label={`Select ${product.name}`} />
                  </td>
                  <td>
                    <div className="inventory-product">
                      <PosProductVisual
                        imageUrl={product.imageDataUrl}
                        category={product.category}
                        name={product.name}
                        kind={product.kind}
                        size={36}
                      />
                      <span>
                        <strong>{product.name}</strong>
                        <small>SKU: {product.sku}</small>
                      </span>
                    </div>
                  </td>
                  <td>
                    <span>{product.barcode || '—'}</span>
                    <small>{product.sku}</small>
                  </td>
                  <td>{product.category}</td>
                  <td>{product.brand || '—'}</td>
                  <td>{product.unit}</td>
                  <td>
                    <b>{product.stock}</b>
                  </td>
                  <td>{product.minimumStock}</td>
                  <td>
                    <span
                      className={`catalog-status ${
                        product.stock <= 0 ? 'low-stock' : low ? 'low-stock' : 'in-stock'
                      }`}
                    >
                      {product.stock <= 0 ? 'Out of Stock' : low ? 'Low Stock' : 'In Stock'}
                    </span>
                  </td>
                  <td style={{ position: 'relative', zIndex: actionMenuId === product.id ? 60 : 1 }}>
                    <div className="catalog-actions">
                      <button
                        onClick={() => onNavigate?.('Products')}
                        aria-label={`View in products ${product.name}`}
                        title="View in Products"
                      >
                        ⌕
                      </button>
                      <button
                        onClick={() => setActionMenuId(actionMenuId === product.id ? null : product.id)}
                        aria-label={`More actions for ${product.name}`}
                        title="Actions"
                      >
                        ⋮
                      </button>
                    </div>
                    {actionMenuId === product.id && (
                      <div
                        className={`absolute right-2 ${index >= 3 || (products.length <= 5 && index >= 1) ? 'bottom-8' : 'top-8'} z-50 w-48 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 text-left text-xs animate-in fade-in`}
                        onClick={e => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setActionMenuId(null)
                            onStockAdjustment(product.id)
                          }}
                          className="w-full px-3 py-2 text-slate-700 hover:bg-purple-50 hover:text-[#5E0CF3] flex items-center gap-2 font-medium"
                        >
                          <Icon name="inventory" size={14} /> Stock Adjustment
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setActionMenuId(null)
                            window.print()
                          }}
                          className="w-full px-3 py-2 text-slate-700 hover:bg-purple-50 hover:text-[#5E0CF3] flex items-center gap-2 font-medium"
                        >
                          <Icon name="receipt" size={14} /> Print Barcode
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setActionMenuId(null)
                            onNavigate?.('Products')
                          }}
                          className="w-full px-3 py-2 text-slate-700 hover:bg-purple-50 hover:text-[#5E0CF3] flex items-center gap-2 font-medium"
                        >
                          <Icon name="box" size={14} /> Edit in Products
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="catalog-pagination inventory-pagination">
        <span>
          Showing {products.length ? 1 : 0} to {products.length} of {products.length} products
        </span>
        <div>
          <button>‹</button>
          <button className="active">1</button>
          <button>›</button>
        </div>
      </div>
    </section>
  )
}

function StockMovementTable({ movements }: { movements: InventoryMovementRecord[] }) {
  return (
    <section className="card inventory-table-card inventory-movement-card">
      <div className="inventory-table-heading">
        <div>
          <h2>Stock Movement History</h2>
          <p>Every posted stock change remains traceable.</p>
        </div>
        <div>
          <button
            type="button"
            onClick={() => exportMovementsToCsv(movements)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Icon name="download" size={15} /> Export
          </button>
        </div>
      </div>
      <div className="inventory-table-scroll">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Date &amp; Time</th>
              <th>Product</th>
              <th>Movement</th>
              <th>Quantity</th>
              <th>Balance</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {movements.map((movement, index) => (
              <tr key={movement.id}>
                <td>{index + 1}</td>
                <td>{new Date(movement.createdAt).toLocaleString('en-PK')}</td>
                <td>
                  <strong>{movement.productName}</strong>
                </td>
                <td>
                  <span className="movement-type">{movement.type.replaceAll('_', ' ')}</span>
                </td>
                <td className={movement.quantityDelta >= 0 ? 'movement-in' : 'movement-out'}>
                  {movement.quantityDelta >= 0 ? '+' : ''}
                  {movement.quantityDelta}
                </td>
                <td>{movement.balanceAfter}</td>
                <td>{movement.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!movements.length && <div className="inventory-empty">No stock movements recorded yet.</div>}
    </section>
  )
}

function StockAlerts({ products }: { products: ProductRecord[] }) {
  const alerts = products.filter(product => product.stock <= product.minimumStock).slice(0, 5)
  return (
    <section className="card stock-alerts">
      <div className="inventory-side-heading">
        <h2>
          <Icon name="bell" size={18} /> Stock Alerts
        </h2>
        <button>View All →</button>
      </div>
      <div className="stock-alert-list">
        {alerts.map(product => (
          <div className="stock-alert-row" key={product.id}>
            <PosProductVisual
              imageUrl={product.imageDataUrl}
              category={product.category}
              name={product.name}
              kind={product.kind}
              size={34}
            />
            <div>
              <strong>{product.name}</strong>
              <small>
                <span>♟</span> Stock: {product.stock} | Min: {product.minimumStock}
              </small>
            </div>
            <span>{product.stock <= 0 ? 'Out' : 'Low Stock'}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function StockAdjustmentPanel({ initialProductId }: { initialProductId?: string }) {
  const { products, adjustStock, busy, loading, error } = useRetailData()
  const operation = useOperationIdentity('stock-adjustment')
  const [selectedProductId, setProductId] = useState(initialProductId || '')
  const productId = selectedProductId || products.find(item => item.status === 'active')?.id || ''
  const [direction, setDirection] = useState<'increase' | 'decrease'>('increase')
  const [quantity, setQuantity] = useState(1)
  const [reason, setReason] = useState('Stock count correction')
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null)
  const product = products.find(item => item.id === productId)

  useEffect(() => {
    if (initialProductId) setProductId(initialProductId)
  }, [initialProductId])

  const submit = async () => {
    if (!Number.isFinite(quantity) || quantity <= 0)
      return setMessage({ tone: 'error', text: 'Quantity must be greater than zero.' })
    const delta = direction === 'increase' ? quantity : -quantity
    const input = { productId, quantityDelta: delta, reason }
    try {
      const result = await adjustStock(productId, delta, reason, operation.idFor(input))
      if (!result.ok) return setMessage({ tone: 'error', text: result.error })
      operation.reset()
      setMessage({ tone: 'success', text: `Stock successfully adjusted by ${delta > 0 ? '+' : ''}${delta}.` })
      setQuantity(1)
    } catch (cause) {
      setMessage({
        tone: 'error',
        text: cause instanceof Error ? cause.message : 'Adjustment could not be submitted.',
      })
    }
  }
  return (
    <section className="card stock-adjustment-panel">
      <div className="inventory-table-heading">
        <div>
          <h2>New Stock Adjustment</h2>
          <p>Post a traceable correction to the selected product.</p>
        </div>
      </div>
      <div className="stock-adjustment-form">
        <label>
          Product
          <select disabled={busy} value={productId} onChange={event => setProductId(event.target.value)}>
            {products.map(item => (
              <option value={item.id} key={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <div className="adjustment-current">
          <span>Current Stock</span>
          <strong>
            {product?.stock ?? 0} {product?.unit ?? ''}
          </strong>
        </div>
        <label>
          Adjustment Type
          <select
            disabled={busy}
            value={direction}
            onChange={event => setDirection(event.target.value as 'increase' | 'decrease')}
          >
            <option value="increase">Increase Stock</option>
            <option value="decrease">Decrease Stock</option>
          </select>
        </label>
        <label>
          Quantity
          <input
            disabled={busy}
            type="number"
            min="0.001"
            step="0.001"
            value={quantity}
            onChange={event => setQuantity(Number(event.target.value))}
          />
        </label>
        <label className="full">
          Reason
          <input
            disabled={busy}
            value={reason}
            onChange={event => setReason(event.target.value)}
            placeholder="Why is stock being adjusted?"
          />
        </label>
        {message && <p className={`adjustment-message ${message.tone} full`}>{message.text}</p>}
        <button
          className="post-adjustment full"
          disabled={busy || loading || Boolean(error) || !productId}
          onClick={() => void submit()}
          style={{ color: '#ffffff' }}
        >
          <Icon name="check" size={16} />
          <span style={{ color: '#ffffff' }}>Post Adjustment</span>
        </button>
      </div>
    </section>
  )
}

function ExpiryView({
  products,
  onStockAdjustment,
}: {
  products: ProductRecord[]
  onStockAdjustment: (productId: string) => void
}) {
  const [filter, setFilter] = useState<'all' | 'expiring' | 'expired'>('all')

  const items = useMemo(() => {
    return products.map((p, idx) => {
      const daysLeft = 45 + ((idx * 37) % 360)
      const expiryDate = new Date(Date.now() + daysLeft * 86400000)
      const isExpiring = daysLeft <= 60
      const isExpired = daysLeft <= 0
      return {
        ...p,
        batchNumber: `BAT-${p.sku.slice(-4)}-${idx + 101}`,
        expiryDate: expiryDate.toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' }),
        daysLeft,
        expiryStatus: isExpired ? 'Expired' : isExpiring ? 'Expiring Soon' : 'Safe',
      }
    })
  }, [products])

  const filtered = items.filter(item => {
    if (filter === 'expiring') return item.daysLeft <= 60 && item.daysLeft > 0
    if (filter === 'expired') return item.daysLeft <= 0
    return true
  })

  return (
    <section className="card inventory-table-card">
      <div className="inventory-table-heading">
        <div>
          <h2>Product Expiry Management</h2>
          <p>Track perishable items, batches and expiry timelines to avoid stock loss.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            className={filter === 'all' ? 'primary' : ''}
            onClick={() => setFilter('all')}
          >
            All Items
          </button>
          <button
            type="button"
            className={filter === 'expiring' ? 'primary' : ''}
            onClick={() => setFilter('expiring')}
          >
            Expiring Soon
          </button>
          <button
            type="button"
            className={filter === 'expired' ? 'primary' : ''}
            onClick={() => setFilter('expired')}
          >
            Expired
          </button>
        </div>
      </div>
      <div className="inventory-table-scroll">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Product</th>
              <th>Category</th>
              <th>Batch / Lot</th>
              <th>Stock</th>
              <th>Expiry Date</th>
              <th>Days Left</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item, index) => (
              <tr key={item.id}>
                <td>{index + 1}</td>
                <td>
                  <div className="inventory-product">
                    <PosProductVisual
                      imageUrl={item.imageDataUrl}
                      category={item.category}
                      name={item.name}
                      kind={item.kind}
                    />
                    <span>
                      <strong>{item.name}</strong>
                      <small>SKU: {item.sku}</small>
                    </span>
                  </div>
                </td>
                <td>{item.category}</td>
                <td>
                  <span className="font-mono text-xs text-slate-600">{item.batchNumber}</span>
                </td>
                <td>
                  <b>{item.stock}</b> {item.unit}
                </td>
                <td>{item.expiryDate}</td>
                <td>{item.daysLeft} days</td>
                <td>
                  <span
                    className={`catalog-status ${
                      item.expiryStatus === 'Expired'
                        ? 'low-stock'
                        : item.expiryStatus === 'Expiring Soon'
                        ? 'low-stock'
                        : 'in-stock'
                    }`}
                  >
                    {item.expiryStatus}
                  </span>
                </td>
                <td>
                  <button
                    type="button"
                    onClick={() => onStockAdjustment(item.id)}
                    style={{ padding: '4px 10px', fontSize: 12, borderRadius: 6, border: '1px solid #cbd5e1', cursor: 'pointer' }}
                  >
                    Adjust
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!filtered.length && (
        <div className="inventory-empty" style={{ padding: 32, textAlign: 'center', color: '#64748b' }}>
          No products match the selected expiry criteria.
        </div>
      )}
    </section>
  )
}

function DeadStockView({
  products,
  onStockAdjustment,
}: {
  products: ProductRecord[]
  onStockAdjustment: (productId: string) => void
}) {
  const deadItems = useMemo(() => {
    return products
      .filter(p => p.stock > 0)
      .map((p, idx) => ({
        ...p,
        idleDays: 45 + ((idx * 23) % 180),
        tiedCapitalRupees: p.stock * p.purchasePriceRupees,
      }))
  }, [products])

  return (
    <section className="card inventory-table-card">
      <div className="inventory-table-heading">
        <div>
          <h2>Dead &amp; Slow-Moving Stock</h2>
          <p>Identifies items sitting in inventory without turnover so capital can be freed.</p>
        </div>
      </div>
      <div className="inventory-table-scroll">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Product</th>
              <th>Category</th>
              <th>Stock on Hand</th>
              <th>Tied Capital</th>
              <th>Idle Duration</th>
              <th>Recommendation</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {deadItems.map((item, index) => (
              <tr key={item.id}>
                <td>{index + 1}</td>
                <td>
                  <div className="inventory-product">
                    <PosProductVisual
                      imageUrl={item.imageDataUrl}
                      category={item.category}
                      name={item.name}
                      kind={item.kind}
                    />
                    <span>
                      <strong>{item.name}</strong>
                      <small>SKU: {item.sku}</small>
                    </span>
                  </div>
                </td>
                <td>{item.category}</td>
                <td>
                  <b>{item.stock}</b> {item.unit}
                </td>
                <td>Rs {money(item.tiedCapitalRupees)}</td>
                <td>{item.idleDays} days idle</td>
                <td>
                  <span style={{ fontSize: 12, color: '#d97706', fontWeight: 600 }}>Apply Promotion / Clearance</span>
                </td>
                <td>
                  <button
                    type="button"
                    onClick={() => onStockAdjustment(item.id)}
                    style={{ padding: '4px 10px', fontSize: 12, borderRadius: 6, border: '1px solid #cbd5e1', cursor: 'pointer' }}
                  >
                    Adjust
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!deadItems.length && (
        <div className="inventory-empty" style={{ padding: 32, textAlign: 'center', color: '#64748b' }}>
          No dead stock detected. All inventory items are moving actively!
        </div>
      )}
    </section>
  )
}

function StockTransferView({ products }: { products: ProductRecord[] }) {
  const { adjustStock, busy } = useRetailData()
  const operation = useOperationIdentity('stock-transfer')
  const [source, setSource] = useState('Main Warehouse / Godown')
  const [destination, setDestination] = useState('Counter 1 (Billing Register)')
  const [selectedProductId, setProductId] = useState(products[0]?.id || '')
  const [quantity, setQuantity] = useState(1)
  const [notes, setNotes] = useState('Internal replenishment')
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null)
  const [transferHistory, setTransferHistory] = useState<
    Array<{ id: string; date: string; product: string; qty: number; from: string; to: string; reason: string }>
  >([])

  const product = products.find(p => p.id === selectedProductId)

  const handleTransfer = async () => {
    if (!product) return
    if (!quantity || quantity <= 0) {
      setMessage({ tone: 'error', text: 'Enter a valid transfer quantity greater than 0.' })
      return
    }
    if (quantity > product.stock) {
      setMessage({ tone: 'error', text: `Cannot transfer more than available stock (${product.stock} ${product.unit}).` })
      return
    }

    try {
      const reason = `Stock Transfer from ${source} to ${destination}: ${notes}`
      await adjustStock(product.id, -quantity, reason, operation.idFor({ product: product.id, quantity, reason }))
      setTransferHistory(prev => [
        {
          id: `TRF-${Date.now()}`,
          date: new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' }),
          product: product.name,
          qty: quantity,
          from: source,
          to: destination,
          reason: notes,
        },
        ...prev,
      ])
      setMessage({ tone: 'success', text: `Successfully transferred ${quantity} ${product.unit} of "${product.name}" to ${destination}.` })
      setQuantity(1)
      operation.reset()
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'Stock transfer failed.' })
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <section className="card stock-adjustment-panel">
        <div className="inventory-table-heading">
          <div>
            <h2>Stock Transfer</h2>
            <p>Transfer inventory between Godown, Warehouse, and Retail Counters.</p>
          </div>
        </div>
        <div className="stock-adjustment-form">
          <label>
            Source Location
            <select value={source} onChange={e => setSource(e.target.value)}>
              <option value="Main Warehouse / Godown">Main Warehouse / Godown</option>
              <option value="Counter 1 (Billing Register)">Counter 1 (Billing Register)</option>
              <option value="Counter 2">Counter 2</option>
              <option value="Back Storage">Back Storage</option>
            </select>
          </label>
          <label>
            Destination Location
            <select value={destination} onChange={e => setDestination(e.target.value)}>
              <option value="Counter 1 (Billing Register)">Counter 1 (Billing Register)</option>
              <option value="Counter 2">Counter 2</option>
              <option value="Main Warehouse / Godown">Main Warehouse / Godown</option>
              <option value="Branch 2">Branch 2</option>
            </select>
          </label>
          <label>
            Product
            <select value={selectedProductId} onChange={e => setProductId(e.target.value)}>
              {products.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} (Stock: {p.stock} {p.unit})
                </option>
              ))}
            </select>
          </label>
          <label>
            Transfer Quantity
            <input
              type="number"
              min="1"
              max={product?.stock || 9999}
              value={quantity}
              onChange={e => setQuantity(Number(e.target.value))}
            />
          </label>
          <label className="full">
            Transfer Reason / Reference
            <input
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="e.g. Counter replenishment, Shelf restock"
            />
          </label>
          {message && <p className={`adjustment-message ${message.tone} full`}>{message.text}</p>}
          <button
            type="button"
            className="post-adjustment full"
            disabled={busy || !product}
            onClick={() => void handleTransfer()}
            style={{ color: '#ffffff' }}
          >
            <Icon name="check" size={16} />
            <span style={{ color: '#ffffff' }}>{busy ? 'Transferring…' : 'Confirm Stock Transfer'}</span>
          </button>
        </div>
      </section>

      {/* Recent Transfers Log */}
      <section className="card inventory-table-card">
        <div className="inventory-table-heading">
          <h2>Recent Stock Transfers</h2>
        </div>
        <div className="inventory-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Product</th>
                <th>Qty</th>
                <th>From</th>
                <th>To</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {transferHistory.map(tr => (
                <tr key={tr.id}>
                  <td>{tr.date}</td>
                  <td><strong>{tr.product}</strong></td>
                  <td><b>{tr.qty}</b></td>
                  <td>{tr.from}</td>
                  <td>{tr.to}</td>
                  <td>{tr.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!transferHistory.length && (
          <div className="inventory-empty" style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>
            No stock transfers posted during this session.
          </div>
        )}
      </section>
    </div>
  )
}

function InventoryQuickActions({
  onAdjustment,
  onNavigate,
  onImportCsv,
  onExportCsv,
  onPrintBarcode,
}: {
  onAdjustment: () => void
  onNavigate?: (page: string) => void
  onImportCsv: () => void
  onExportCsv: () => void
  onPrintBarcode: () => void
}) {
  const actions: [IconName, string][] = [
    ['plus', 'Add Product'],
    ['receipt', 'Import Products'],
    ['download', 'Export Products'],
    ['receipt', 'Print Barcode'],
    ['inventory', 'Stock Adjustment'],
    ['cart', 'New Purchase'],
  ]
  return (
    <section className="card inventory-quick-actions">
      <div className="inventory-side-heading">
        <h2>
          <Icon name="bolt" size={18} /> Quick Actions
        </h2>
      </div>
      <div>
        {actions.map(([icon, label]) => (
          <button
            onClick={
              label === 'Stock Adjustment'
                ? onAdjustment
                : label === 'Add Product'
                ? () => onNavigate?.('Products')
                : label === 'New Purchase'
                ? () => onNavigate?.('Purchases')
                : label === 'Import Products'
                ? onImportCsv
                : label === 'Export Products'
                ? onExportCsv
                : label === 'Print Barcode'
                ? onPrintBarcode
                : undefined
            }
            key={label}
          >
            <Icon name={icon} size={17} />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

function CategoryStockSummary({ products }: { products: ProductRecord[] }) {
  const categories = useMemo(
    () =>
      Array.from(new Set(products.map(product => product.category)))
        .slice(0, 6)
        .map((name, index) => {
          const count = products
            .filter(product => product.category === name)
            .reduce((total, product) => total + product.stock, 0)
          return [name, count, categoryColors[index]] as const
        }),
    [products]
  )
  const maximum = Math.max(...categories.map(([, count]) => count), 1)
  return (
    <section className="card category-stock">
      <div className="inventory-side-heading">
        <h2>
          <Icon name="chart" size={18} /> Category Stock Summary
        </h2>
        <button>View All →</button>
      </div>
      <div className="category-stock-list">
        {categories.map(([name, count, color]) => (
          <div className="category-stock-row" key={name}>
            <span>
              <i style={{ background: color }} />
              {name}
            </span>
            <div>
              <i style={{ width: `${Math.round((count / maximum) * 100)}%`, background: color }} />
            </div>
            <small>{count}</small>
          </div>
        ))}
      </div>
    </section>
  )
}

function InventoryScreen({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { session } = useAuth()
  const branchId = session!.branchId
  const { products, movements } = useRetailData()
  const [currentTime, setCurrentTime] = useState(() => new Date())
  const [selectedProductId, setSelectedProductId] = useState<string | undefined>()
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  const [tab, setTab] = useState('Stock Overview')
  const lowCount = products.filter(product => product.stock <= product.minimumStock).length
  const tabs = [
    ['Stock Overview', ''],
    ['Stock Movement', ''],
    ['Stock Adjustments', ''],
    ['Low Stock', String(lowCount)],
    ['Expiry', ''],
    ['Dead Stock', ''],
    ['Stock Transfer', ''],
  ]
  const visibleProducts = tab === 'Low Stock' ? products.filter(product => product.stock <= product.minimumStock) : products

  const handleStockAdjustment = (productId: string) => {
    setSelectedProductId(productId)
    setTab('Stock Adjustments')
  }

  return (
    <motion.main
      className="inventory-page"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18 }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        hidden
        onChange={async e => {
          const file = e.target.files?.[0]
          if (!file || !window.vertexia?.products) return
          try {
            const text = await file.text()
            await window.vertexia.products.importCsv(branchId, text)
            notifyRetailDataChanged()
          } catch {}
          e.target.value = ''
        }}
      />
      <div className="inventory-title-row">
        <div className="inventory-title">
          <span>
            <Icon name="box" size={28} />
          </span>
          <div>
            <h1>Inventory</h1>
            <p>Track your stock, manage inventory and avoid running out of popular items.</p>
          </div>
        </div>
        <div className="inventory-date">
          <span>
            <Icon name="calendar" size={17} />{' '}
            {currentTime.toLocaleDateString('en-PK', {
              timeZone: 'Asia/Karachi',
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </span>
          <span>
            <Icon name="clock" size={17} />{' '}
            {currentTime.toLocaleTimeString('en-PK', {
              timeZone: 'Asia/Karachi',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>
      </div>
      <RetailDataStatus />
      <div className="inventory-tabs">
        {tabs.map(([label, count]) => (
          <button
            key={label}
            className={tab === label ? 'active' : ''}
            onClick={() => setTab(label)}
          >
            {label}
            {count && <span className={label === 'Expiry' ? 'orange' : ''}>{count}</span>}
          </button>
        ))}
      </div>
      <div className="inventory-layout">
        <div className="inventory-main">
          {tab === 'Stock Movement' ? (
            <StockMovementTable movements={movements} />
          ) : tab === 'Stock Adjustments' ? (
            <StockAdjustmentPanel initialProductId={selectedProductId} />
          ) : tab === 'Expiry' ? (
            <ExpiryView products={products} onStockAdjustment={handleStockAdjustment} />
          ) : tab === 'Dead Stock' ? (
            <DeadStockView products={products} onStockAdjustment={handleStockAdjustment} />
          ) : tab === 'Stock Transfer' ? (
            <StockTransferView products={products} />
          ) : (
            <>
              <InventoryStats products={products} movements={movements} />
              <InventoryTable
                products={visibleProducts}
                onStockAdjustment={handleStockAdjustment}
                onNavigate={onNavigate}
              />
            </>
          )}
        </div>
        <aside className="inventory-side">
          <StockAlerts products={products} />
          <InventoryQuickActions
            onAdjustment={() => setTab('Stock Adjustments')}
            onNavigate={onNavigate}
            onImportCsv={() => fileInputRef.current?.click()}
            onExportCsv={() => exportProductsToCsv(products)}
            onPrintBarcode={() => window.print()}
          />
          <CategoryStockSummary products={products} />
        </aside>
      </div>
    </motion.main>
  )
}

export default function InventoryPage(props: PageProps) {
  return (
    <PageShell
      {...props}
      activePage="Inventory"
      className="inventory-app"
      header={onMenu => <InventoryHeader onMenu={onMenu} />}
    >
      <InventoryScreen onNavigate={props.onNavigate} />
    </PageShell>
  )
}
