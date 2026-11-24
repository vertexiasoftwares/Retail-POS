import { useEffect, useRef, useState, type FormEvent } from 'react'
import { motion } from 'framer-motion'
import JsBarcode from 'jsbarcode'
import { Icon } from '../../shared/ui/Icon'
import { PageShell, type PageProps } from '../../shared/layout/PageShell'
import { PosProductVisual } from '../../shared/ui/ProductVisual'
import { useEscapeKey } from '../../shared/hooks/useEscapeKey'
import type { ProductDraft, ProductRecord } from './products.types'
import { useProductsCatalog, type ProductsController } from './useProductsCatalog'

import { TopNavHeader } from '../../shared/layout/TopNavHeader'
import { exportToExcel } from '../../shared/utils/exportUtils'

const emptyDraft: ProductDraft = {
  name: '',
  barcode: '',
  sku: '',
  category: '',
  subcategory: '',
  brand: '',
  unit: 'Piece',
  purchasePriceRupees: 0,
  sellingPriceRupees: 0,
  mrpRupees: 0,
  minimumStock: 5,
  stock: 0,
  status: 'active',
  imageDataUrl: null,
}
const money = (value: number) => value.toLocaleString('en-PK', { maximumFractionDigits: 2 })

function ProductsHeader({ onNavigate }: { onNavigate?: (page: string) => void }) {
  return (
    <TopNavHeader
      title="Products Catalog"
      subtitle="Manage product catalog, pricing and stock"
      onNavigate={onNavigate}
    />
  )
}

function ProductsToolbar({
  controller,
  view,
  onView,
}: {
  controller: ProductsController
  view: 'list' | 'grid'
  onView: (view: 'list' | 'grid') => void
}) {
  const tabs = ['all', ...controller.categories]
  return (
    <>
      <div className="product-category-tabs">
        {tabs.map(name => (
          <button
            key={name}
            className={controller.category === name ? 'active' : ''}
            onClick={() => controller.setCategory(name)}
          >
            <strong>{name === 'all' ? 'All Products' : name}</strong>
            {name === 'all' && <small>◊ &nbsp;{controller.total}</small>}
          </button>
        ))}
      </div>
      <div className="product-filters">
        <label>
          <Icon name="search" size={17} />
          <input
            value={controller.search}
            onChange={event => controller.setSearch(event.target.value)}
            placeholder="Search products..."
            aria-label="Search product list"
          />
        </label>
        <select
          aria-label="Filter category"
          value={controller.category}
          onChange={event => controller.setCategory(event.target.value)}
        >
          <option value="all">All Categories</option>
          {controller.categories.map(value => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <select
          aria-label="Filter brand"
          value={controller.brand}
          onChange={event => controller.setBrand(event.target.value)}
        >
          <option value="all">All Brands</option>
          {controller.brands.map(value => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <select
          aria-label="Filter status"
          value={controller.status}
          onChange={event => controller.setStatus(event.target.value as ProductsController['status'])}
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="low_stock">Low Stock</option>
          <option value="out_of_stock">Out of Stock</option>
        </select>
        <div className="product-view-toggle">
          <button
            className={view === 'list' ? 'active' : ''}
            onClick={() => onView('list')}
            aria-label="List view"
          >
            ☷
          </button>
          <button
            className={view === 'grid' ? 'active' : ''}
            onClick={() => onView('grid')}
            aria-label="Grid view"
          >
            ⊞
          </button>
        </div>
      </div>
    </>
  )
}

function ProductPicture({ product }: { product: ProductRecord }) {
  return (
    <PosProductVisual
      imageUrl={product.imageDataUrl}
      category={product.category}
      name={product.name}
      kind={product.kind}
      size={38}
    />
  )
}

function CatalogTable({
  controller,
  selected,
  onSelection,
  onEdit,
  onPrintBarcode,
  onDelete,
}: {
  controller: ProductsController
  selected: Set<string>
  onSelection: (ids: Set<string>) => void
  onEdit: (product: ProductRecord) => void
  onPrintBarcode: (product: ProductRecord) => void
  onDelete?: (product: ProductRecord) => void
}) {
  const [actionMenuId, setActionMenuId] = useState<string | null>(null)
  useEscapeKey(() => setActionMenuId(null), Boolean(actionMenuId))

  const allSelected =
    Boolean(controller.products.length) && controller.products.every(product => selected.has(product.id))
  const toggleAll = () =>
    onSelection(allSelected ? new Set() : new Set(controller.products.map(product => product.id)))

  return (
    <section className="card catalog-table-card">
      <div className="catalog-table-scroll">
        <table>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Select all products"
                />
              </th>
              <th>Product</th>
              <th>Barcode / SKU</th>
              <th>Category</th>
              <th>Brand</th>
              <th>Unit</th>
              <th>Stock</th>
              <th>Purchase Price</th>
              <th>Sale Price</th>
              <th>MRP</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {controller.products.map((product, index) => (
              <tr key={product.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.has(product.id)}
                    onChange={() => {
                      const next = new Set(selected)
                      if (next.has(product.id)) next.delete(product.id)
                      else next.add(product.id)
                      onSelection(next)
                    }}
                    aria-label={`Select ${product.name}`}
                  />
                </td>
                <td>
                  <div className="catalog-product">
                    <ProductPicture product={product} />
                    <strong>{product.name}</strong>
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
                  <b className={product.stock <= product.minimumStock ? 'catalog-low-number' : ''}>
                    {product.stock}
                  </b>
                </td>
                <td>{money(product.purchasePriceRupees)}</td>
                <td>{money(product.sellingPriceRupees)}</td>
                <td>{money(product.mrpRupees)}</td>
                <td>
                  <span
                    className={`catalog-status ${
                      product.status === 'active'
                        ? product.stock <= 0
                          ? 'low-stock'
                          : product.stock <= product.minimumStock
                          ? 'low-stock'
                          : 'in-stock'
                        : 'inactive'
                    }`}
                  >
                    {product.status === 'inactive'
                      ? 'Inactive'
                      : product.stock <= 0
                      ? 'Out of Stock'
                      : product.stock <= product.minimumStock
                      ? 'Low Stock'
                      : 'In Stock'}
                  </span>
                </td>
                <td style={{ position: 'relative', zIndex: actionMenuId === product.id ? 60 : 1 }}>
                  <div className="catalog-actions">
                    <button onClick={() => onEdit(product)} aria-label={`Edit ${product.name}`} title="Edit">
                      ✎
                    </button>
                    <button
                      disabled={controller.busy}
                      onClick={() => setActionMenuId(actionMenuId === product.id ? null : product.id)}
                      aria-label={`More actions for ${product.name}`}
                      title="More actions"
                    >
                      ⋮
                    </button>
                  </div>
                  {actionMenuId === product.id && (
                    <div
                      className={`absolute right-2 ${index >= 3 || (controller.products.length <= 5 && index >= 1) ? 'bottom-8' : 'top-8'} z-50 w-48 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 text-left text-xs animate-in fade-in`}
                      onClick={e => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setActionMenuId(null)
                          onEdit(product)
                        }}
                        className="w-full px-3 py-2 text-slate-700 hover:bg-purple-50 hover:text-[#5E0CF3] flex items-center gap-2 font-medium"
                      >
                        <span>✏️</span> Edit Product
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActionMenuId(null)
                          onPrintBarcode(product)
                        }}
                        className="w-full px-3 py-2 text-slate-700 hover:bg-purple-50 hover:text-[#5E0CF3] flex items-center gap-2 font-medium"
                      >
                        <Icon name="report" size={14} /> Print Barcode
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActionMenuId(null)
                          void controller.toggle(product.id)
                        }}
                        className={`w-full px-3 py-2 flex items-center gap-2 font-medium ${
                          product.status === 'active'
                            ? 'text-amber-600 hover:bg-amber-50'
                            : 'text-emerald-600 hover:bg-emerald-50'
                        }`}
                      >
                        <Icon name={product.status === 'active' ? 'lock' : 'check'} size={14} />
                        {product.status === 'active' ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActionMenuId(null)
                          if (onDelete) {
                            onDelete(product)
                          } else {
                            void controller.remove(product.id)
                          }
                        }}
                        className="w-full px-3 py-2 text-rose-600 hover:bg-rose-50 flex items-center gap-2 font-medium border-t border-slate-100"
                      >
                        <Icon name="close" size={14} className="text-rose-500" /> Delete Product
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination controller={controller} />
    </section>
  )
}

function CatalogGrid({
  controller,
  selected,
  onSelection,
  onEdit,
}: {
  controller: ProductsController
  selected: Set<string>
  onSelection: (ids: Set<string>) => void
  onEdit: (product: ProductRecord) => void
}) {
  return (
    <>
      <div className="catalog-grid-view">
        {controller.products.map(product => (
          <article className="card" key={product.id}>
            <input
              type="checkbox"
              checked={selected.has(product.id)}
              onChange={() => {
                const next = new Set(selected)
                if (next.has(product.id)) next.delete(product.id)
                else next.add(product.id)
                onSelection(next)
              }}
              aria-label={`Select ${product.name}`}
            />
            <div className="catalog-grid-picture">
              <ProductPicture product={product} />
            </div>
            <h3>{product.name}</h3>
            <small>
              {product.sku} · {product.category}
            </small>
            <strong>Rs {money(product.sellingPriceRupees)}</strong>
            <span className={product.stock <= product.minimumStock ? 'low' : ''}>
              Stock: {product.stock} {product.unit}
            </span>
            <footer>
              <button onClick={() => onEdit(product)}>Edit</button>
              <button onClick={() => void controller.toggle(product.id)}>
                {product.status === 'active' ? 'Deactivate' : 'Activate'}
              </button>
            </footer>
          </article>
        ))}
      </div>
      <section className="card catalog-table-card catalog-grid-pagination">
        <Pagination controller={controller} />
      </section>
    </>
  )
}

function Pagination({ controller }: { controller: ProductsController }) {
  const pages = Array.from(
    { length: Math.min(controller.pageCount, 5) },
    (_, index) => index + Math.max(1, Math.min(controller.page - 2, controller.pageCount - 4))
  )
  return (
    <div className="catalog-pagination">
      <span>
        Showing {controller.products.length ? (controller.page - 1) * controller.pageSize + 1 : 0} to{' '}
        {(controller.page - 1) * controller.pageSize + controller.products.length} of {controller.total} products
      </span>
      <div>
        <select
          value={controller.pageSize}
          onChange={event => controller.setPageSize(Number(event.target.value))}
        >
          <option value="12">12 / page</option>
          <option value="25">25 / page</option>
          <option value="50">50 / page</option>
        </select>
        <button disabled={controller.page <= 1} onClick={() => controller.setPage(controller.page - 1)}>
          ‹
        </button>
        {pages.map(page => (
          <button
            className={page === controller.page ? 'active' : ''}
            onClick={() => controller.setPage(page)}
            key={page}
          >
            {page}
          </button>
        ))}
        <button
          disabled={controller.page >= controller.pageCount}
          onClick={() => controller.setPage(controller.page + 1)}
        >
          ›
        </button>
      </div>
    </div>
  )
}

function ProductFormModal({
  controller,
  editing,
  onClose,
  onDelete,
}: {
  controller: ProductsController
  editing: ProductRecord | null
  onClose: () => void
  onDelete?: (product: ProductRecord) => void
}) {
  const [tab, setTab] = useState('Basic Info')
  const [draft, setDraft] = useState<ProductDraft>(editing ? { ...editing } : { ...emptyDraft })
  const [message, setMessage] = useState('')

  // Advanced POS settings state
  const [taxRate, setTaxRate] = useState('0')
  const [trackExpiry, setTrackExpiry] = useState(false)
  const [allowDiscount, setAllowDiscount] = useState(true)
  const [scaleProduct, setScaleProduct] = useState(false)
  const [storageShelf, setStorageShelf] = useState('')
  const [notes, setNotes] = useState('')

  useEscapeKey(onClose)

  const set = <K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) =>
    setDraft(current => ({ ...current, [key]: value }))

  const save = async (event?: FormEvent) => {
    event?.preventDefault()
    setMessage('')
    if (await controller.save(draft, editing?.id)) onClose()
    else setMessage('Please review the highlighted product details.')
  }

  const handleDelete = () => {
    if (!editing) return
    if (onDelete) {
      onDelete(editing)
    } else {
      void controller.remove(editing.id).then(success => {
        if (success) onClose()
      })
    }
  }

  const image = async (file?: File) => {
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
      setMessage('Image must be PNG or JPG and no larger than 2 MB.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => set('imageDataUrl', String(reader.result))
    reader.readAsDataURL(file)
  }

  const profitRupees = draft.sellingPriceRupees - (draft.purchasePriceRupees || 0)
  const marginPercent = draft.sellingPriceRupees > 0
    ? ((profitRupees / draft.sellingPriceRupees) * 100).toFixed(1)
    : '0'

  return (
    <div className="product-modal-backdrop" role="presentation" onClick={onClose}>
      <aside
        className="card add-product-panel"
        role="dialog"
        aria-modal="true"
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(780px, 96vw)',
          maxHeight: 'calc(100vh - 40px)',
          borderRadius: 18,
          boxShadow: '0 24px 70px rgba(0,0,0,0.3)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          background: '#fff',
        }}
      >
        <div className="add-product-heading" style={{ padding: '18px 24px', borderBottom: '1px solid #f1f5f9' }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: 0 }}>
              {editing ? 'Edit Product' : 'Add New Product'}
            </h2>
            <p style={{ fontSize: 12.5, color: '#64748b', margin: '3px 0 0' }}>
              Configure product catalog, barcode, pricing, and inventory
            </p>
          </div>
          <button onClick={onClose} aria-label="Close add product" style={{ fontSize: 20, color: '#94a3b8' }}>
            ×
          </button>
        </div>

        <div className="product-form-tabs" style={{ padding: '0 24px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
          {['Basic Info', 'Pricing', 'Inventory', 'Advanced'].map(item => (
            <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>
              {item}
            </button>
          ))}
        </div>

        <form onSubmit={save} style={{ overflowY: 'auto', flex: 1, padding: '20px 24px' }}>
          {tab === 'Basic Info' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '14px 18px' }}>
              <label style={{ gridColumn: 'span 2', display: 'grid', gap: 4, fontSize: 12.5, fontWeight: 600, color: '#334155' }}>
                <span className="flex justify-between items-center">
                  <span>Product Name <em style={{ color: '#ef4444' }}>*</em></span>
                  <small style={{ color: '#94a3b8', fontWeight: 400 }}>{draft.name.length}/120</small>
                </span>
                <input
                  maxLength={120}
                  value={draft.name}
                  onChange={event => set('name', event.target.value)}
                  placeholder="e.g. Nestle Milkpak 1 Ltr"
                  required
                  style={{ height: 40, padding: '0 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13.5 }}
                />
              </label>

              <label style={{ display: 'grid', gap: 4, fontSize: 12.5, fontWeight: 600, color: '#334155' }}>
                Barcode (EAN/UPC)
                <input
                  value={draft.barcode}
                  onChange={event => set('barcode', event.target.value)}
                  placeholder="Scan or enter barcode"
                  style={{ height: 40, padding: '0 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13.5 }}
                />
              </label>

              <label style={{ display: 'grid', gap: 4, fontSize: 12.5, fontWeight: 600, color: '#334155' }}>
                SKU / Item Code
                <input
                  value={draft.sku}
                  onChange={event => set('sku', event.target.value)}
                  placeholder="Auto-generated if empty"
                  style={{ height: 40, padding: '0 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13.5 }}
                />
              </label>

              <label style={{ display: 'grid', gap: 4, fontSize: 12.5, fontWeight: 600, color: '#334155' }}>
                Category <em style={{ color: '#ef4444' }}>*</em>
                <input
                  list="product-categories"
                  value={draft.category}
                  onChange={event => set('category', event.target.value)}
                  placeholder="e.g. Dairy, Grocery"
                  required
                  style={{ height: 40, padding: '0 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13.5 }}
                />
                <datalist id="product-categories">
                  {controller.categories.map(value => (
                    <option key={value}>{value}</option>
                  ))}
                </datalist>
              </label>

              <label style={{ display: 'grid', gap: 4, fontSize: 12.5, fontWeight: 600, color: '#334155' }}>
                Subcategory
                <input
                  value={draft.subcategory}
                  onChange={event => set('subcategory', event.target.value)}
                  placeholder="e.g. Milk, Cheese"
                  style={{ height: 40, padding: '0 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13.5 }}
                />
              </label>

              <label style={{ display: 'grid', gap: 4, fontSize: 12.5, fontWeight: 600, color: '#334155' }}>
                Brand Name
                <input
                  value={draft.brand}
                  onChange={event => set('brand', event.target.value)}
                  placeholder="e.g. Nestle, Olpers"
                  style={{ height: 40, padding: '0 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13.5 }}
                />
              </label>

              <label style={{ display: 'grid', gap: 4, fontSize: 12.5, fontWeight: 600, color: '#334155' }}>
                Unit of Measure <em style={{ color: '#ef4444' }}>*</em>
                <select
                  value={draft.unit}
                  onChange={event => set('unit', event.target.value)}
                  style={{ height: 40, padding: '0 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13.5, background: '#fff' }}
                >
                  {['Piece', 'Kg', 'Gram', 'Liter', 'Pack', 'Tray', 'Carton', 'Box'].map(value => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>

              {/* Enhanced Image Upload Dropzone */}
              <div style={{ gridColumn: 'span 2', display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: '#334155' }}>Product Image</span>
                {draft.imageDataUrl ? (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    padding: '12px 16px',
                    border: '1px solid #e2e8f0',
                    borderRadius: 12,
                    background: '#f8fafc',
                  }}>
                    <img
                      src={draft.imageDataUrl}
                      alt="Product preview"
                      style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 10, border: '1px solid #cbd5e1' }}
                    />
                    <div style={{ flex: 1 }}>
                      <strong style={{ fontSize: 13, color: '#0f172a', display: 'block' }}>Product Image Uploaded</strong>
                      <span style={{ fontSize: 12, color: '#64748b' }}>PNG or JPG format preview</span>
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <label style={{
                          padding: '5px 12px',
                          borderRadius: 6,
                          background: '#fff',
                          border: '1px solid #cbd5e1',
                          fontSize: 12,
                          fontWeight: 600,
                          color: '#5E0CF3',
                          cursor: 'pointer',
                        }}>
                          Change Image
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            onChange={event => void image(event.target.files?.[0])}
                            style={{ display: 'none' }}
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => set('imageDataUrl', null)}
                          style={{
                            padding: '5px 12px',
                            borderRadius: 6,
                            background: '#fff',
                            border: '1px solid #cbd5e1',
                            fontSize: 12,
                            fontWeight: 600,
                            color: '#ef4444',
                            cursor: 'pointer',
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <label style={{
                    border: '2px dashed #cbd5e1',
                    borderRadius: 12,
                    padding: '24px',
                    textAlign: 'center',
                    background: '#f8fafc',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 6,
                    transition: 'all 0.2s',
                  }}>
                    <div style={{ width: 44, height: 44, borderRadius: 22, background: '#ede9fe', color: '#7c3aed', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="box" size={24} />
                    </div>
                    <strong style={{ fontSize: 13.5, color: '#1e293b' }}>Click to upload product image</strong>
                    <span style={{ fontSize: 12, color: '#64748b' }}>Drag & drop PNG or JPG (max 2 MB)</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={event => void image(event.target.files?.[0])}
                      style={{ display: 'none' }}
                    />
                  </label>
                )}
              </div>

              {/* Status Switch */}
              <div style={{
                gridColumn: 'span 2',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: 12,
              }}>
                <div>
                  <strong style={{ fontSize: 13, color: '#0f172a', display: 'block' }}>Product Status: {draft.status === 'active' ? 'Active' : 'Inactive'}</strong>
                  <span style={{ fontSize: 12, color: '#64748b' }}>Active products are immediately available for POS billing and inventory tracking</span>
                </div>
                <button
                  type="button"
                  className={draft.status === 'active' ? 'on' : ''}
                  onClick={() => set('status', draft.status === 'active' ? 'inactive' : 'active')}
                  style={{
                    width: 44,
                    height: 24,
                    borderRadius: 12,
                    background: draft.status === 'active' ? '#5E0CF3' : '#cbd5e1',
                    position: 'relative',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'background 0.2s',
                  }}
                >
                  <span style={{
                    display: 'block',
                    width: 18,
                    height: 18,
                    borderRadius: 9,
                    background: '#fff',
                    position: 'absolute',
                    top: 3,
                    left: draft.status === 'active' ? 23 : 3,
                    transition: 'left 0.2s',
                  }} />
                </button>
              </div>
            </div>
          )}

          {tab === 'Pricing' && (
            <div style={{ display: 'grid', gap: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 16 }}>
                <label style={{ display: 'grid', gap: 4, fontSize: 12.5, fontWeight: 600, color: '#334155' }}>
                  Purchase / Cost Price (Rs)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={draft.purchasePriceRupees || ''}
                    onChange={event => set('purchasePriceRupees', Number(event.target.value))}
                    placeholder="0.00"
                    style={{ height: 40, padding: '0 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13.5 }}
                  />
                </label>
                <label style={{ display: 'grid', gap: 4, fontSize: 12.5, fontWeight: 600, color: '#334155' }}>
                  Selling Price (Rs) <em style={{ color: '#ef4444' }}>*</em>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={draft.sellingPriceRupees || ''}
                    onChange={event => set('sellingPriceRupees', Number(event.target.value))}
                    placeholder="0.00"
                    required
                    style={{ height: 40, padding: '0 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13.5 }}
                  />
                </label>
                <label style={{ display: 'grid', gap: 4, fontSize: 12.5, fontWeight: 600, color: '#334155' }}>
                  Maximum Retail Price / MRP (Rs)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={draft.mrpRupees || ''}
                    onChange={event => set('mrpRupees', Number(event.target.value))}
                    placeholder="0.00"
                    style={{ height: 40, padding: '0 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13.5 }}
                  />
                </label>
              </div>

              {/* Live Profit Margin Card */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: 12,
                padding: '16px',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: 12,
              }}>
                <div>
                  <span style={{ fontSize: 12, color: '#64748b', fontWeight: 500, display: 'block' }}>Estimated Profit / Unit</span>
                  <strong style={{ fontSize: 18, color: profitRupees >= 0 ? '#10b981' : '#ef4444', fontWeight: 700 }}>
                    Rs. {profitRupees.toFixed(2)}
                  </strong>
                </div>
                <div>
                  <span style={{ fontSize: 12, color: '#64748b', fontWeight: 500, display: 'block' }}>Gross Margin</span>
                  <strong style={{ fontSize: 18, color: Number(marginPercent) >= 0 ? '#6366f1' : '#ef4444', fontWeight: 700 }}>
                    {marginPercent}%
                  </strong>
                </div>
              </div>
            </div>
          )}

          {tab === 'Inventory' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '14px 18px' }}>
              <label style={{ display: 'grid', gap: 4, fontSize: 12.5, fontWeight: 600, color: '#334155' }}>
                {editing ? 'Current Stock in Hand' : 'Opening Stock'}
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  disabled={Boolean(editing)}
                  value={draft.stock || ''}
                  onChange={event => set('stock', Number(event.target.value))}
                  placeholder="0"
                  style={{ height: 40, padding: '0 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13.5 }}
                />
              </label>

              <label style={{ display: 'grid', gap: 4, fontSize: 12.5, fontWeight: 600, color: '#334155' }}>
                Low Stock Alert Threshold
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  value={draft.minimumStock || ''}
                  onChange={event => set('minimumStock', Number(event.target.value))}
                  placeholder="e.g. 5"
                  style={{ height: 40, padding: '0 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13.5 }}
                />
              </label>

              {editing && (
                <div style={{ gridColumn: 'span 2', padding: '12px 14px', background: '#eff6ff', borderRadius: 10, border: '1px solid #bfdbfe', color: '#1e40af', fontSize: 12.5 }}>
                  ℹ️ To adjust or recount physical stock, use the <strong>Inventory Adjustments</strong> module to maintain audit trails.
                </div>
              )}
            </div>
          )}

          {tab === 'Advanced' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '14px 18px' }}>
              <label style={{ display: 'grid', gap: 4, fontSize: 12.5, fontWeight: 600, color: '#334155' }}>
                GST / Sales Tax Rate (%)
                <select
                  value={taxRate}
                  onChange={e => setTaxRate(e.target.value)}
                  style={{ height: 40, padding: '0 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13.5, background: '#fff' }}
                >
                  <option value="0">0% (Tax Exempt / Zero-Rated)</option>
                  <option value="18">18% (Standard Retail Sales Tax)</option>
                  <option value="5">5% (Concessional)</option>
                </select>
              </label>

              <label style={{ display: 'grid', gap: 4, fontSize: 12.5, fontWeight: 600, color: '#334155' }}>
                Shelf / Storage Location
                <input
                  value={storageShelf}
                  onChange={e => setStorageShelf(e.target.value)}
                  placeholder="e.g. Aisle 4, Rack B-2"
                  style={{ height: 40, padding: '0 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13.5 }}
                />
              </label>

              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 14px',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: 10,
              }}>
                <div>
                  <strong style={{ fontSize: 13, color: '#1e293b', display: 'block' }}>Batch & Expiry Tracking</strong>
                  <span style={{ fontSize: 11.5, color: '#64748b' }}>Prompt for batch & expiry on purchase & POS</span>
                </div>
                <input
                  type="checkbox"
                  checked={trackExpiry}
                  onChange={e => setTrackExpiry(e.target.checked)}
                  style={{ width: 18, height: 18, accentColor: '#5E0CF3' }}
                />
              </div>

              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 14px',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: 10,
              }}>
                <div>
                  <strong style={{ fontSize: 13, color: '#1e293b', display: 'block' }}>Allow POS Cashier Discount</strong>
                  <span style={{ fontSize: 11.5, color: '#64748b' }}>Permit cashier to apply item-level discounts</span>
                </div>
                <input
                  type="checkbox"
                  checked={allowDiscount}
                  onChange={e => setAllowDiscount(e.target.checked)}
                  style={{ width: 18, height: 18, accentColor: '#5E0CF3' }}
                />
              </div>

              <div style={{
                gridColumn: 'span 2',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 14px',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: 10,
              }}>
                <div>
                  <strong style={{ fontSize: 13, color: '#1e293b', display: 'block' }}>Electronic Weight Scale Item</strong>
                  <span style={{ fontSize: 11.5, color: '#64748b' }}>Product is weighed on scale during checkout (meat, fruits, bulk)</span>
                </div>
                <input
                  type="checkbox"
                  checked={scaleProduct}
                  onChange={e => setScaleProduct(e.target.checked)}
                  style={{ width: 18, height: 18, accentColor: '#5E0CF3' }}
                />
              </div>

              <label style={{ gridColumn: 'span 2', display: 'grid', gap: 4, fontSize: 12.5, fontWeight: 600, color: '#334155' }}>
                Internal Notes & Description
                <textarea
                  rows={2}
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Optional internal remarks, storage instructions, or vendor information..."
                  style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13, resize: 'vertical' }}
                />
              </label>

              {editing && (
                <div style={{ gridColumn: 'span 2', padding: '12px 16px', background: '#f1f5f9', borderRadius: 10, fontSize: 12, color: '#64748b' }}>
                  <strong>System Metadata:</strong> ID: <code>{editing.id}</code> · Created: {new Date(editing.createdAt).toLocaleString('en-PK')} · Last Updated: {new Date(editing.updatedAt).toLocaleString('en-PK')}
                </div>
              )}
            </div>
          )}

          {message && <p className="product-form-message error" style={{ marginTop: 14 }}>{controller.error || message}</p>}
          <button className="form-submit-proxy" type="submit">Save</button>
        </form>

        <div className="product-form-actions" style={{
          padding: '14px 24px',
          borderTop: '1px solid #f1f5f9',
          display: 'flex',
          alignItems: 'center',
          justifyContent: editing ? 'space-between' : 'flex-end',
          background: '#f8fafc',
        }}>
          {editing && (
            <button
              type="button"
              disabled={controller.busy}
              onClick={() => void handleDelete()}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                background: '#fee2e2',
                border: '1px solid #fca5a5',
                color: '#dc2626',
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              🗑️ Delete Product
            </button>
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={onClose} style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', fontSize: 13, fontWeight: 600, color: '#475569', cursor: 'pointer' }}>
              Cancel
            </button>
            <button
              className="save-product"
              disabled={controller.busy}
              onClick={() => void save()}
              style={{
                padding: '8px 22px',
                borderRadius: 8,
                background: 'linear-gradient(135deg, #6435ef, #2c48eb)',
                border: 'none',
                color: '#ffffff',
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              <span style={{ color: '#ffffff' }}>
                {controller.busy ? 'Saving…' : editing ? 'Update Product' : 'Save Product'}
              </span>
            </button>
          </div>
        </div>
      </aside>
    </div>
  )
}

function BarcodeGraphic({ value }: { value: string }) {
  const target = useRef<SVGSVGElement>(null)
  useEffect(() => {
    if (target.current)
      JsBarcode(target.current, value, {
        format: 'CODE128',
        displayValue: false,
        height: 46,
        width: 1.5,
        margin: 0,
      })
  }, [value])
  return <svg ref={target} className="barcode-bars" aria-label={`Barcode ${value}`} />
}

function BarcodeSheet({ products, onClose }: { products: ProductRecord[]; onClose: () => void }) {
  useEscapeKey(onClose)
  return (
    <div className="product-modal-backdrop" role="presentation" onClick={onClose}>
      <section className="barcode-sheet" onClick={e => e.stopPropagation()}>
        <header>
          <h2>Print Barcodes</h2>
          <button onClick={onClose}>×</button>
        </header>
        <div className="barcode-print-area">
          {products.map(product => {
            const value = product.barcode || product.sku
            return (
              <article key={product.id}>
                <strong>{product.name}</strong>
                <BarcodeGraphic value={value} />
                <b>{value}</b>
                <small>Rs {money(product.sellingPriceRupees)}</small>
              </article>
            )
          })}
        </div>
        <footer>
          <button onClick={onClose}>Close</button>
          <button className="primary" onClick={() => window.print()} style={{ color: '#ffffff' }}>
            <span style={{ color: '#ffffff' }}>Print</span>
          </button>
        </footer>
      </section>
    </div>
  )
}

function ProductsScreen({ controller }: { controller: ProductsController }) {
  const [editing, setEditing] = useState<ProductRecord | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [view, setView] = useState<'list' | 'grid'>('list')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [barcodes, setBarcodes] = useState<ProductRecord[] | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)

  useEscapeKey(() => {
    setPanelOpen(false)
    setBarcodes(null)
    setDeleteTarget(null)
  }, panelOpen || Boolean(barcodes) || Boolean(deleteTarget))

  const openAdd = () => {
    setEditing(null)
    setPanelOpen(true)
  }
  const openEdit = (product: ProductRecord) => {
    setEditing(product)
    setPanelOpen(true)
  }

  const print = () => {
    const products = selected.size
      ? controller.products.filter(product => selected.has(product.id))
      : controller.products
    if (!products.length) {
      controller.setError('No products available to print barcodes.')
      return
    }
    setBarcodes(products)
  }

  const printSingleBarcode = (product: ProductRecord) => {
    setBarcodes([product])
  }

  return (
    <>
      <motion.main
        className="products-page products-page-full"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.18 }}
      >
        <div className="products-content">
          <div className="products-title-row">
            <div className="products-title">
              <span>
                <Icon name="box" size={28} />
              </span>
              <div>
                <h1>Products</h1>
                <p>Manage your product catalog, pricing, stock and categories.</p>
              </div>
            </div>
            <div className="products-page-actions">
              <input
                ref={importRef}
                hidden
                type="file"
                accept=".csv,text/csv"
                onChange={event => {
                  const file = event.target.files?.[0]
                  if (file) void controller.importCsv(file)
                  event.currentTarget.value = ''
                }}
              />
              <button
                type="button"
                onClick={() => importRef.current?.click()}
                disabled={controller.busy}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Icon name="receipt" size={15} /> Import Products
              </button>
              <button
                type="button"
                onClick={() => exportToExcel({
                  filename: `products-catalog-${new Date().toISOString().slice(0, 10)}.xls`,
                  title: 'Products Catalog Report',
                  subtitle: `Total Products: ${controller.products.length}`,
                  headers: ['Product Name', 'SKU', 'Barcode', 'Category', 'Brand', 'Unit', 'Stock Qty', 'Minimum Stock', 'Purchase Price (Rs)', 'Selling Price (Rs)', 'MRP (Rs)', 'Status'],
                  rows: controller.products.map(p => [
                    p.name || '',
                    p.sku || '',
                    p.barcode || '',
                    p.category || '',
                    p.brand || '',
                    p.unit || '',
                    p.stock,
                    p.minimumStock,
                    p.purchasePriceRupees.toFixed(2),
                    p.sellingPriceRupees.toFixed(2),
                    p.mrpRupees.toFixed(2),
                    p.status,
                  ]),
                })}
                disabled={controller.busy}
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
                  cursor: controller.busy ? 'not-allowed' : 'pointer',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
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
                onClick={print}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Icon name="receipt" size={15} /> Print Barcode
              </button>
              <button className="primary" onClick={openAdd} style={{ color: '#ffffff' }}>
                <Icon name="plus" size={17} />
                <span style={{ color: '#ffffff' }}>Add Product</span>
              </button>
            </div>
          </div>
          <ProductsToolbar controller={controller} view={view} onView={setView} />
          {controller.loading ? (
            <div className="products-loading">
              <span className="dashboard-spinner" />
              Loading products…
            </div>
          ) : view === 'list' ? (
            <CatalogTable
              controller={controller}
              selected={selected}
              onSelection={setSelected}
              onEdit={openEdit}
              onPrintBarcode={printSingleBarcode}
              onDelete={prod => setDeleteTarget({ id: prod.id, name: prod.name })}
            />
          ) : (
            <CatalogGrid
              controller={controller}
              selected={selected}
              onSelection={setSelected}
              onEdit={openEdit}
            />
          )}
        </div>
      </motion.main>
      {panelOpen && (
        <ProductFormModal
          key={editing?.id ?? 'new'}
          controller={controller}
          editing={editing}
          onClose={() => setPanelOpen(false)}
          onDelete={prod => setDeleteTarget({ id: prod.id, name: prod.name })}
        />
      )}

      {/* Modern POS Delete Confirmation Modal */}
      {deleteTarget && (
        <div
          className="medkit-modal-backdrop"
          onClick={() => !deleting && setDeleteTarget(null)}
          style={{ zIndex: 1100 }}
        >
          <div
            className="medkit-modal"
            style={{ maxWidth: 440, borderRadius: 20, overflow: 'hidden' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="p-7 text-center">
              <div
                style={{
                  width: 58,
                  height: 58,
                  borderRadius: 16,
                  background: '#fff1f2',
                  color: '#e11d48',
                  border: '1px solid #fecdd3',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 16px',
                }}
              >
                <Icon name="warning" size={28} />
              </div>
              <h3
                style={{
                  fontSize: 19,
                  fontWeight: 700,
                  color: '#0f172a',
                  marginBottom: 8,
                }}
              >
                Delete Product
              </h3>
              <p
                style={{
                  fontSize: 14,
                  color: '#64748b',
                  lineHeight: 1.5,
                  marginBottom: 24,
                }}
              >
                Are you sure you want to permanently delete{' '}
                <strong style={{ color: '#0f172a' }}>"{deleteTarget.name}"</strong>?
                This item will be completely removed from your inventory catalog and database.
              </p>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 12,
                }}
              >
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => setDeleteTarget(null)}
                  className="medkit-btn-clear"
                  style={{
                    padding: '10px 22px',
                    borderRadius: 12,
                    fontWeight: 600,
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={async () => {
                    setDeleting(true)
                    const ok = await controller.remove(deleteTarget.id)
                    setDeleting(false)
                    if (ok) {
                      setDeleteTarget(null)
                      setPanelOpen(false)
                    }
                  }}
                  style={{
                    padding: '10px 22px',
                    borderRadius: 12,
                    background: '#e11d48',
                    color: '#ffffff',
                    fontWeight: 600,
                    fontSize: 14,
                    border: 'none',
                    cursor: deleting ? 'not-allowed' : 'pointer',
                    boxShadow: '0 2px 8px rgba(225, 29, 72, 0.3)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  {deleting ? 'Deleting…' : 'Yes, Delete Product'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {controller.error && (
        <div className="pos-toast error">
          <Icon name="warning" size={17} />
          {controller.error}
          <button onClick={() => controller.setError('')}>×</button>
        </div>
      )}
      {controller.notice && (
        <div className="pos-toast success">
          <Icon name="check" size={17} />
          {controller.notice}
        </div>
      )}
      {barcodes && <BarcodeSheet products={barcodes} onClose={() => setBarcodes(null)} />}
    </>
  )
}

export default function ProductsPage(props: PageProps) {
  const controller = useProductsCatalog()
  return (
    <PageShell
      {...props}
      activePage="Products"
      className="products-app"
      header={() => <ProductsHeader onNavigate={props.onNavigate} />}
    >
      <ProductsScreen controller={controller} />
    </PageShell>
  )
}
