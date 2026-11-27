import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { cloudApi, type ProductRecord } from '../services/cloudApi'
import { formatPkr, formatQty } from '../utils/format'
import { EmptyState, ErrorBanner, Modal, PageHeader, StatusBadge } from '../components/UiPrimitives'

export function ProductsScreen({ refreshTick }: { refreshTick: number }) {
  const [products, setProducts] = useState<ProductRecord[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<ProductRecord | null>(null)

  // Form state
  const [name, setName] = useState('')
  const [sku, setSku] = useState('')
  const [barcode, setBarcode] = useState('')
  const [category, setCategory] = useState('General')
  const [unit, setUnit] = useState('Piece')
  const [costPkr, setCostPkr] = useState('0')
  const [salePkr, setSalePkr] = useState('')
  const [minStock, setMinStock] = useState('5')
  const [openingStock, setOpeningStock] = useState('0')
  const [isActive, setIsActive] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await cloudApi.getProducts(search)
      setProducts(res.products)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load products.')
    } finally {
      setLoading(false)
    }
  }, [search])

  useEffect(() => {
    void load()
  }, [load, refreshTick])

  function openCreate() {
    setEditing(null)
    setName('')
    setSku('')
    setBarcode('')
    setCategory('General')
    setUnit('Piece')
    setCostPkr('0')
    setSalePkr('')
    setMinStock('5')
    setOpeningStock('0')
    setCreateOpen(true)
  }

  function openEdit(p: ProductRecord) {
    setEditing(p)
    setName(p.name)
    setSalePkr(String(p.sale_price_paisa / 100))
    setCostPkr(String(p.cost_price_paisa / 100))
    setMinStock(String(p.low_stock_milli / 1000))
    setIsActive(p.is_active)
    setCreateOpen(false)
  }

  async function handleSaveCreate(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const res = await cloudApi.createProduct({
        name: name.trim(),
        sku: sku.trim() || undefined,
        barcode: barcode.trim() || undefined,
        category: category.trim() || 'General',
        unit: unit.trim() || 'Piece',
        costPricePaisa: Math.round((Number(costPkr) || 0) * 100),
        salePricePaisa: Math.round((Number(salePkr) || 0) * 100),
        minimumStockMilli: Math.round((Number(minStock) || 0) * 1000),
        openingStockMilli: Math.round((Number(openingStock) || 0) * 1000),
      })
      setCreateOpen(false)
      setNotice(`Product ${res.sku} created in cloud queue (#${res.cloudSeq}) and will reconcile to Main PC automatically.`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create product.')
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault()
    if (!editing) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const res = await cloudApi.updateProduct(editing.id, {
        name: name.trim(),
        salePricePaisa: Math.round((Number(salePkr) || 0) * 100),
        costPricePaisa: Math.round((Number(costPkr) || 0) * 100),
        minimumStockMilli: Math.round((Number(minStock) || 0) * 1000),
        isActive,
      })
      setEditing(null)
      setNotice(`Product updated (cloud seq #${res.cloudSeq}). Main PC receives changes on next sync cycle.`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update product.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Products Catalog"
        subtitle={`${products.length} synced product(s) • Remote edits apply cleanly even when Main PC is off`}
        action={
          <button
            type="button"
            onClick={openCreate}
            className="rounded-xl bg-[#6d4aff] px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-[#5835eb]"
          >
            + Add Product Remotely
          </button>
        }
      />

      {notice && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-800">
          {notice}
        </div>
      )}
      <ErrorBanner message={error} onRetry={load} />

      <div className="mb-4 rounded-2xl border border-[#dce6f4] bg-white p-3.5">
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search product name, SKU, or barcode..."
          className="w-full rounded-xl border border-[#dce6f4] px-3.5 py-2 text-sm outline-none focus:border-[#6d4aff]"
        />
      </div>

      {!loading && products.length === 0 ? (
        <EmptyState title="No products found" description="Try another search query or add a new product remotely." />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[#dce6f4] bg-white shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#dce6f4] bg-[#f8fbff] text-xs font-semibold uppercase text-[#55667d]">
                <tr>
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">SKU / Barcode</th>
                  <th className="px-4 py-3 text-right">Cost</th>
                  <th className="px-4 py-3 text-right">Sale Price</th>
                  <th className="px-4 py-3 text-right">Stock</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#edf2fa]">
                {products.map(p => (
                  <tr key={p.id} className="hover:bg-[#f2f7fd]/60">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-[#10243f]">{p.name}</p>
                      <p className="text-xs text-[#55667d]">{p.category}</p>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-[#55667d]">
                      {p.sku}
                      {p.barcode ? ` / ${p.barcode}` : ''}
                    </td>
                    <td className="px-4 py-3 text-right text-xs">{formatPkr(p.cost_price_paisa)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-[#10243f]">{formatPkr(p.sale_price_paisa)}</td>
                    <td className="px-4 py-3 text-right">
                      <StatusBadge
                        variant={p.quantity_milli <= p.low_stock_milli ? 'warning' : 'neutral'}
                        label={formatQty(p.quantity_milli, p.unit)}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge variant={p.is_active ? 'success' : 'danger'} label={p.is_active ? 'Active' : 'Inactive'} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => openEdit(p)}
                        className="rounded-lg border border-[#dce6f4] px-3 py-1 text-xs font-semibold text-[#6d4aff] hover:bg-[#6d4aff]/10"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={createOpen} title="Add Product Remotely" onClose={() => setCreateOpen(false)}>
        <form onSubmit={handleSaveCreate} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold">Product Name *</label>
            <input required value={name} onChange={e => setName(e.target.value)} className="w-full rounded-xl border border-[#dce6f4] px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold">SKU (optional)</label>
              <input value={sku} onChange={e => setSku(e.target.value)} placeholder="Auto-generated" className="w-full rounded-xl border border-[#dce6f4] px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold">Barcode (optional)</label>
              <input value={barcode} onChange={e => setBarcode(e.target.value)} className="w-full rounded-xl border border-[#dce6f4] px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold">Category</label>
              <input value={category} onChange={e => setCategory(e.target.value)} className="w-full rounded-xl border border-[#dce6f4] px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold">Unit</label>
              <input value={unit} onChange={e => setUnit(e.target.value)} className="w-full rounded-xl border border-[#dce6f4] px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold">Cost Price (Rs)</label>
              <input type="number" step="0.01" min="0" value={costPkr} onChange={e => setCostPkr(e.target.value)} className="w-full rounded-xl border border-[#dce6f4] px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold">Sale Price (Rs) *</label>
              <input required type="number" step="0.01" min="0.01" value={salePkr} onChange={e => setSalePkr(e.target.value)} className="w-full rounded-xl border border-[#dce6f4] px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold">Opening Stock ({unit})</label>
              <input type="number" step="0.001" min="0" value={openingStock} onChange={e => setOpeningStock(e.target.value)} className="w-full rounded-xl border border-[#dce6f4] px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold">Low Stock Alert ({unit})</label>
              <input type="number" step="0.001" min="0" value={minStock} onChange={e => setMinStock(e.target.value)} className="w-full rounded-xl border border-[#dce6f4] px-3 py-2 text-sm" />
            </div>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-xl bg-[#6d4aff] py-2.5 text-sm font-semibold text-white hover:bg-[#5835eb] disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Create Product'}
          </button>
        </form>
      </Modal>

      <Modal open={Boolean(editing)} title={`Edit ${editing?.name || 'Product'}`} onClose={() => setEditing(null)}>
        <form onSubmit={handleSaveEdit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold">Product Name *</label>
            <input required value={name} onChange={e => setName(e.target.value)} className="w-full rounded-xl border border-[#dce6f4] px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold">Cost Price (Rs)</label>
              <input type="number" step="0.01" min="0" value={costPkr} onChange={e => setCostPkr(e.target.value)} className="w-full rounded-xl border border-[#dce6f4] px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold">Sale Price (Rs) *</label>
              <input required type="number" step="0.01" min="0.01" value={salePkr} onChange={e => setSalePkr(e.target.value)} className="w-full rounded-xl border border-[#dce6f4] px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold">Low Stock Alert</label>
            <input type="number" step="0.001" min="0" value={minStock} onChange={e => setMinStock(e.target.value)} className="w-full rounded-xl border border-[#dce6f4] px-3 py-2 text-sm" />
          </div>
          <label className="flex items-center gap-2 text-xs font-semibold text-[#10243f]">
            <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="h-4 w-4 accent-[#6d4aff]" />
            Active for POS billing
          </label>
          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-xl bg-[#6d4aff] py-2.5 text-sm font-semibold text-white hover:bg-[#5835eb] disabled:opacity-50"
          >
            {saving ? 'Updating...' : 'Save Changes'}
          </button>
        </form>
      </Modal>
    </div>
  )
}

export function InventoryScreen({ refreshTick }: { refreshTick: number }) {
  const [products, setProducts] = useState<ProductRecord[]>([])
  const [search, setSearch] = useState('')
  const [onlyLow, setOnlyLow] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [adjusting, setAdjusting] = useState<ProductRecord | null>(null)
  const [direction, setDirection] = useState<'increase' | 'decrease'>('increase')
  const [qtyUnits, setQtyUnits] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await cloudApi.getProducts(search)
      setProducts(res.products)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load inventory.')
    } finally {
      setLoading(false)
    }
  }, [search])

  useEffect(() => {
    void load()
  }, [load, refreshTick])

  const filtered = onlyLow ? products.filter(p => p.is_active && p.quantity_milli <= p.low_stock_milli) : products

  async function handleAdjust(e: FormEvent) {
    e.preventDefault()
    if (!adjusting) return
    const units = Number(qtyUnits)
    if (!Number.isFinite(units) || units <= 0) {
      setError('Enter a positive adjustment quantity.')
      return
    }
    const deltaMilli = Math.round(units * 1000) * (direction === 'increase' ? 1 : -1)
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const res = await cloudApi.adjustInventory({
        productId: adjusting.id,
        quantityDeltaMilli: deltaMilli,
        reason: reason.trim() || `Remote ${direction}`,
      })
      setNotice(
        `Movement ${res.movementId} recorded (new cloud balance: ${formatQty(res.balanceAfterMilli, adjusting.unit)}). Reconciles to Main PC ledger delta-safely.`,
      )
      setAdjusting(null)
      setQtyUnits('')
      setReason('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Stock adjustment failed.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Inventory & Stock Adjustments"
        subtitle="Uses delta-safe movement ledger events so concurrent counter sales never lose stock accuracy"
      />
      {notice && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-800">
          {notice}
        </div>
      )}
      <ErrorBanner message={error} onRetry={load} />

      <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-[#dce6f4] bg-white p-3.5 sm:flex-row sm:items-center">
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Filter stock by product name or SKU..."
          className="flex-1 rounded-xl border border-[#dce6f4] px-3.5 py-2 text-sm outline-none focus:border-[#6d4aff]"
        />
        <label className="flex items-center gap-2 text-xs font-semibold text-[#10243f]">
          <input type="checkbox" checked={onlyLow} onChange={e => setOnlyLow(e.target.checked)} className="h-4 w-4 accent-[#6d4aff]" />
          Low Stock Only
        </label>
      </div>

      {!loading && filtered.length === 0 ? (
        <EmptyState title="No stock rows match" description="Try disabling Low Stock Only or clearing the filter." />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[#dce6f4] bg-white shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#dce6f4] bg-[#f8fbff] text-xs font-semibold uppercase text-[#55667d]">
                <tr>
                  <th className="px-4 py-3">Item</th>
                  <th className="px-4 py-3 text-right">Current Stock</th>
                  <th className="px-4 py-3 text-right">Low Alert</th>
                  <th className="px-4 py-3">Health</th>
                  <th className="px-4 py-3 text-right">Movement</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#edf2fa]">
                {filtered.map(p => {
                  const isLow = p.quantity_milli <= p.low_stock_milli
                  return (
                    <tr key={p.id}>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-[#10243f]">{p.name}</p>
                        <p className="font-mono text-xs text-[#55667d]">{p.sku}</p>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold">{formatQty(p.quantity_milli, p.unit)}</td>
                      <td className="px-4 py-3 text-right text-xs text-[#55667d]">{formatQty(p.low_stock_milli, p.unit)}</td>
                      <td className="px-4 py-3">
                        <StatusBadge
                          variant={p.quantity_milli <= 0 ? 'danger' : isLow ? 'warning' : 'success'}
                          label={p.quantity_milli <= 0 ? 'Out of Stock' : isLow ? 'Low Stock' : 'Healthy'}
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            setAdjusting(p)
                            setDirection('increase')
                            setQtyUnits('')
                            setReason('')
                          }}
                          className="rounded-lg bg-[#6d4aff]/10 px-3 py-1 text-xs font-semibold text-[#5835eb] hover:bg-[#6d4aff]/20"
                        >
                          Adjust Stock
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={Boolean(adjusting)} title={`Adjust Stock: ${adjusting?.name || ''}`} onClose={() => setAdjusting(null)}>
        <form onSubmit={handleAdjust} className="space-y-3">
          <p className="rounded-xl bg-[#f8fbff] px-3 py-2 text-xs text-[#55667d]">
            Current synced quantity: <strong className="text-[#10243f]">{formatQty(adjusting?.quantity_milli, adjusting?.unit)}</strong>
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setDirection('increase')}
              className={`rounded-xl border py-2 text-xs font-semibold ${
                direction === 'increase'
                  ? 'border-[#6d4aff] bg-[#6d4aff] text-white'
                  : 'border-[#dce6f4] bg-white text-[#10243f]'
              }`}
            >
              + Increase Stock
            </button>
            <button
              type="button"
              onClick={() => setDirection('decrease')}
              className={`rounded-xl border py-2 text-xs font-semibold ${
                direction === 'decrease'
                  ? 'border-rose-600 bg-rose-600 text-white'
                  : 'border-[#dce6f4] bg-white text-[#10243f]'
              }`}
            >
              - Decrease Stock
            </button>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold">Quantity ({adjusting?.unit}) *</label>
            <input
              required
              type="number"
              step="0.001"
              min="0.001"
              value={qtyUnits}
              onChange={e => setQtyUnits(e.target.value)}
              className="w-full rounded-xl border border-[#dce6f4] px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold">Reason</label>
            <input
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="e.g. Physical count correction / Damaged stock"
              className="w-full rounded-xl border border-[#dce6f4] px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-xl bg-[#6d4aff] py-2.5 text-sm font-semibold text-white hover:bg-[#5835eb] disabled:opacity-50"
          >
            {saving ? 'Recording...' : 'Submit Delta Movement'}
          </button>
        </form>
      </Modal>
    </div>
  )
}
