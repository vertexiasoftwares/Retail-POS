import { useAuth } from '../../app/auth/useAuth'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { motion } from 'framer-motion'
import { CustomSelect } from '../../shared/ui/CustomSelect'
import { Icon } from '../../shared/ui/Icon'
import { PosProductVisual } from '../../shared/ui/ProductVisual'
import type { PosPaymentMethod, PosProduct } from '../../types/desktop-api'
import { lineTotal, type PosController } from './usePos'
import { formatPosMoney as money } from './pos-format'
import { PaymentMethodIcon } from './PaymentMethodIcons'

const stock = (milli: number) => (milli / 1000).toLocaleString('en-PK', { maximumFractionDigits: 3 })

function Categories({
  categories,
  selected,
  onSelect,
}: {
  categories: string[]
  selected: string
  onSelect: (category: string) => void
}) {
  const items = ['All', ...categories]
  return (
    <div className="pos-categories">
      {items.map((label, index) => (
        <button key={label} className={selected === label ? 'active' : ''} onClick={() => onSelect(label)}>
          <span>{index === 0 ? '✣' : label.slice(0, 1).toUpperCase()}</span>
          <small>{label}</small>
        </button>
      ))}
    </div>
  )
}

function Catalog({ products, onAdd }: { products: PosProduct[]; onAdd: (product: PosProduct) => void }) {
  return (
    <div className="pos-catalog">
      <div className="product-grid">
        {products.map(product => {
          const out = product.quantityMilli <= 0
          const low = product.quantityMilli <= product.minimumStockMilli
          return (
            <article className={`pos-product-card ${out ? 'out-of-stock' : ''}`} key={product.id}>
              <div className="pos-product-picture">
                <PosProductVisual kind={product.kind} category={product.category} name={product.name} />
              </div>
              <h3>{product.name}</h3>
              <strong>{money(product.sellingPricePaisa)}</strong>
              <div className={`product-stock ${low ? 'low' : ''}`}>
                <span />
                {out ? 'Out of stock' : `Stock: ${stock(product.quantityMilli)} ${product.unit}`}
              </div>
              <button
                disabled={out}
                className="add-product"
                aria-label={`Add ${product.name}`}
                onClick={() => onAdd(product)}
              >
                <Icon name="plus" size={18} />
              </button>
            </article>
          )
        })}
      </div>
      {!products.length && (
        <div className="pos-empty">
          <Icon name="box" size={35} />
          <h3>No products found</h3>
          <p>Add a custom product or change your search.</p>
        </div>
      )}
    </div>
  )
}

function BottomActions({
  pos,
  onCustom,
  onHeld,
  onDiscount,
}: {
  pos: PosController
  onCustom: () => void
  onHeld: () => void
  onDiscount: () => void
}) {
  const clear = () => {
    if (pos.cart.length && window.confirm('Remove all products from the current cart?')) pos.clearCart()
  }
  const { can } = useAuth()
  return (
    <div className="pos-bottom-actions">
      <button disabled={!can('products.manage')} onClick={onCustom}>
        <span>▦</span>
        <div>
          <strong>+ Add Custom Product</strong>
          <small>For non-barcoded items</small>
        </div>
      </button>
      <button onClick={pos.cart.length ? () => void pos.holdSale() : onHeld}>
        <span>Ⅱ</span>
        <div>
          <strong>{pos.cart.length ? 'Hold Sale' : 'Held Sales'}</strong>
          <small>{pos.cart.length ? 'Save current sale' : `${pos.data?.heldSales.length ?? 0} saved sales`}</small>
        </div>
      </button>
      <button className="red" onClick={clear}>
        <span>×</span>
        <div>
          <strong>Clear Cart</strong>
          <small>Remove all items</small>
        </div>
      </button>
      <button disabled={!pos.canDiscount} onClick={onDiscount}>
        <span>%</span>
        <div>
          <strong>Quick Discount</strong>
          <small>Apply cart discount</small>
        </div>
      </button>
    </div>
  )
}

function SalePanel({
  pos,
  onHeld,
  onOpenShift,
}: {
  pos: PosController
  onHeld: () => void
  onOpenShift: () => void
}) {
  const cashInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (
      pos.paymentMethod === 'Cash' &&
      (pos.error.includes('Cash Received') || pos.error.includes('Cash received'))
    ) {
      cashInputRef.current?.focus()
    }
  }, [pos.error, pos.paymentMethod])

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'F5') {
        event.preventDefault()
        pos.openBillPreview()
      }
    }
    window.addEventListener('keydown', keyboard)
    return () => window.removeEventListener('keydown', keyboard)
  }, [pos])

  const savedCustomers = useMemo(
    () => (pos.data?.customers ?? []).filter(c => !c.isWalkIn),
    [pos.data?.customers]
  )
  const paymentMethods: PosPaymentMethod[] = ['Cash', 'Card', 'JazzCash', 'Easypaisa', 'Udhaar']
  const cashMissing = pos.paymentMethod === 'Cash' && pos.cart.length > 0 && !pos.cashReceived.trim()
  const cashInsufficient =
    pos.paymentMethod === 'Cash' &&
    pos.cart.length > 0 &&
    pos.cashReceived.trim() !== '' &&
    pos.cashReceivedPaisa < pos.totalPaisa

  return (
    <aside className="sale-panel">
      <div className="sale-panel-title">
        <div>
          <h2>Current Sale</h2>
          <span>Items: {pos.cart.length}</span>
          {Boolean(pos.data?.heldSales.length) && (
            <button type="button" className="held-count" onClick={onHeld} title="View & resume held bills">
              <Icon name="clock" size={14} />
              <b>Held Bills ({pos.data!.heldSales.length})</b>
            </button>
          )}
        </div>
        <button
          onClick={() => {
            if (pos.cart.length && window.confirm('Clear the current sale?')) {
              pos.clearCart()
              pos.clearCustomer()
            }
          }}
        >
          <span>×</span> Clear
        </button>
      </div>

      {!pos.data?.activeShiftId && (
        <button className="pos-shift-warning" onClick={onOpenShift}>
          <Icon name="warning" size={17} />
          <span>
            <strong>Cash shift is closed</strong>
            <small>Open a shift before billing.</small>
          </span>
          Open Shift
        </button>
      )}

      <div className="sale-table-wrap">
        <table className="sale-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Product</th>
              <th>Qty</th>
              <th>Price</th>
              <th>Discount</th>
              <th>Total</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {pos.cart.map((row, index) => (
              <tr key={row.id}>
                <td>{index + 1}.</td>
                <td>
                  <div className="sale-product">
                    <PosProductVisual kind={row.kind} category={row.category} name={row.name} />
                    <span>
                      <strong>{row.name}</strong>
                      <small>{row.barcode ? `Barcode: ${row.barcode}` : `SKU: ${row.sku}`}</small>
                    </span>
                  </div>
                </td>
                <td>
                  <div className="quantity">
                    <button
                      aria-label={`Decrease ${row.name}`}
                      onClick={() =>
                        row.quantityInCartMilli <= 1000
                          ? pos.removeLine(row.id)
                          : pos.setQuantity(row.id, row.quantityInCartMilli - 1000)
                      }
                    >
                      −
                    </button>
                    <input
                      aria-label={`${row.name} quantity`}
                      type="number"
                      min="0.001"
                      max={row.quantityMilli / 1000}
                      step="0.001"
                      value={row.quantityInCartMilli / 1000}
                      onChange={event => pos.setQuantity(row.id, Math.round(Number(event.target.value) * 1000))}
                    />
                    <button
                      aria-label={`Increase ${row.name}`}
                      onClick={() => pos.setQuantity(row.id, row.quantityInCartMilli + 1000)}
                    >
                      +
                    </button>
                  </div>
                </td>
                <td>{money(row.sellingPricePaisa).replace('Rs ', '')}</td>
                <td>
                  <CustomSelect
                    size="xs"
                    disabled={!pos.canDiscount}
                    ariaLabel={`${row.name} discount`}
                    value={String(row.discountBasisPoints)}
                    onChange={val => pos.setDiscount(row.id, Number(val))}
                    options={[0, 500, 1000, 1500, 2000].map(value => ({
                      value: String(value),
                      label: `${value / 100}%`,
                    }))}
                  />
                </td>
                <td>
                  <b>{money(lineTotal(row)).replace('Rs ', '')}</b>
                </td>
                <td>
                  <button
                    className="more-button remove-line"
                    onClick={() => pos.removeLine(row.id)}
                    aria-label={`Remove ${row.name}`}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!pos.cart.length && (
          <div className="empty-cart">
            <Icon name="cart" size={38} />
            <h3>Cart is empty</h3>
            <p>Scan a barcode or select a product.</p>
          </div>
        )}
      </div>

      <div className="sale-summary">
        <div>
          <span>Subtotal</span>
          <b>{money(pos.subtotalPaisa)}</b>
        </div>
        <div>
          <span>Discount</span>
          <b>{money(pos.discountPaisa)}</b>
        </div>
        <div className="sale-total">
          <span>TOTAL</span>
          <b>{money(pos.totalPaisa)}</b>
        </div>
      </div>

      {/* Direct Customer Details (Always available, no Walk-in Customer clutter) */}
      <div className="pos-sale-customer-strip">
        <div className="pos-sale-customer-row">
          <span className="pos-sale-customer-info">
            <Icon name="user" size={14} />
            <strong>Customer Details</strong>
          </span>
          <div className="pos-sale-customer-controls">
            {savedCustomers.length > 0 && (
              <CustomSelect
                size="sm"
                align="right"
                ariaLabel="Saved customer"
                value={pos.selectedSavedCustomer ? pos.customerId : ''}
                onChange={val => pos.setCustomerId(val || 'customer-walk-in')}
                options={[
                  { value: '', label: 'Saved Customer (Optional)' },
                  ...savedCustomers.map(c => ({
                    value: c.id,
                    label: c.name,
                    badge: c.balancePaisa > 0 ? `Due Rs ${(c.balancePaisa / 100).toLocaleString('en-PK')}` : undefined,
                  })),
                ]}
              />
            )}
            {(pos.draftCustomerName || pos.draftCustomerPhone || pos.selectedSavedCustomer) && (
              <button type="button" className="pos-cust-clear-btn" onClick={() => pos.clearCustomer()}>
                Clear
              </button>
            )}
          </div>
        </div>
        <div className="pos-quick-cust-form pos-quick-cust-two">
          <input
            type="text"
            placeholder="Customer Name (optional)"
            value={pos.draftCustomerName}
            maxLength={100}
            onChange={e => pos.updateCustomerName(e.target.value)}
            aria-label="Customer Name"
          />
          <input
            type="text"
            placeholder="Phone (optional)"
            value={pos.draftCustomerPhone}
            maxLength={25}
            onChange={e => pos.updateCustomerPhone(e.target.value)}
            aria-label="Customer Phone"
          />
        </div>
      </div>

      <div className="payment-area">
        <h3>Payment Method</h3>
        <div className="payment-methods">
          {paymentMethods.map(name => (
            <button
              type="button"
              key={name}
              className={pos.paymentMethod === name ? 'selected' : ''}
              onClick={() => pos.setPaymentMethod(name)}
            >
              <PaymentMethodIcon method={name} selected={pos.paymentMethod === name} />
              <span>{name}</span>
            </button>
          ))}
        </div>
        {pos.paymentMethod === 'Cash' ? (
          <div className="cash-fields">
            <label>
              <span className="pos-cash-label-row">
                <span>
                  Cash Received <em style={{ color: '#e11d48', fontStyle: 'normal' }}>*</em>
                </span>
                {pos.totalPaisa > 0 && (
                  <button
                    type="button"
                    className="pos-exact-cash-btn"
                    onClick={() => {
                      pos.setCashReceived((pos.totalPaisa / 100).toFixed(2).replace(/\.00$/, ''))
                      pos.setError('')
                    }}
                  >
                    Exact
                  </button>
                )}
              </span>
              <div className={`money-input ${cashMissing || cashInsufficient ? 'is-required' : ''}`}>
                <span>Rs</span>
                <input
                  ref={cashInputRef}
                  inputMode="decimal"
                  type="number"
                  min="0"
                  step="0.01"
                  value={pos.cashReceived}
                  onChange={event => pos.setCashReceived(event.target.value)}
                  placeholder="Enter amount"
                />
              </div>
              {cashMissing && (
                <small className="pos-cash-hint">Enter cash amount received before billing</small>
              )}
              {cashInsufficient && (
                <small className="pos-cash-hint">Amount is less than total ({money(pos.totalPaisa)})</small>
              )}
            </label>
            <label>
              <span>Change</span>
              <output>{money(pos.changePaisa)}</output>
            </label>
          </div>
        ) : pos.paymentMethod === 'Udhaar' ? (
          <div className={`pos-payment-note ${!pos.hasNamedCustomer ? 'error' : ''}`}>
            {!pos.hasNamedCustomer
              ? 'Enter customer name above before using Udhaar.'
              : `${pos.effectiveCustomerName} will be charged ${money(pos.totalPaisa)} as Udhaar.`}
          </div>
        ) : (
          <div className="pos-payment-note">Full amount will be recorded as {pos.paymentMethod} payment.</div>
        )}
      </div>

      <button
        disabled={pos.busy || !pos.cart.length || !pos.data?.activeShiftId}
        className="complete-sale"
        onClick={() => pos.openBillPreview()}
      >
        <span>▣</span>
        <b>{pos.busy ? 'Processing…' : 'Review & Generate Bill'}</b>
        <kbd>F5</kbd>
      </button>
    </aside>
  )
}

export function PosWorkspace({
  pos,
  search,
  onCustom,
  onHeld,
  onDiscount,
  onOpenShift,
}: {
  pos: PosController
  search: string
  onCustom: () => void
  onHeld: () => void
  onDiscount: () => void
  onOpenShift: () => void
}) {
  const [category, setCategory] = useState('All')
  const products = useMemo(
    () =>
      (pos.data?.products ?? []).filter(
        product =>
          (category === 'All' || product.category === category) &&
          (!search.trim() ||
            `${product.name} ${product.sku} ${product.barcode ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()))
      ),
    [pos.data, category, search]
  )
  const columns = Math.min(9, Math.max(1, (pos.data?.categories.length ?? 0) + 1))
  return (
    <motion.main className="pos-screen" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}>
      <section className="pos-products">
        <div style={{ '--pos-category-count': columns } as CSSProperties}>
          <Categories categories={pos.data?.categories ?? []} selected={category} onSelect={setCategory} />
        </div>
        <Catalog products={products} onAdd={pos.addProduct} />
        <BottomActions pos={pos} onCustom={onCustom} onHeld={onHeld} onDiscount={onDiscount} />
      </section>
      <SalePanel pos={pos} onHeld={onHeld} onOpenShift={onOpenShift} />
    </motion.main>
  )
}
