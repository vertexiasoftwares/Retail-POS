import { randomUUID } from 'node:crypto';
import { changeStockValue, proportionalCost, stockCost } from './valuation.mjs';
import { nextDocumentNumber, postOperation, requireBusinessDate, requireSafeInteger, requireText } from './posting.mjs';
const methods = new Set(['Cash', 'Bank Transfer', 'JazzCash', 'Easypaisa', 'Card']);
const newId = (kind) => `${kind}-${randomUUID()}`;
export function retailBusinessDate(now) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const part = (type) => parts.find(item => item.type === type).value;
    return `${part('year')}-${part('month')}-${part('day')}`;
}
export class RetailRepository {
    db;
    businessId;
    actorId;
    now;
    constructor(db, businessId, actorId, now) {
        this.db = db;
        this.businessId = businessId;
        this.actorId = actorId;
        this.now = now;
    }
    branch(id) {
        requireText(id, 'Branch', 100);
        if (!this.db.prepare('SELECT id FROM branches WHERE id=? AND business_id=? AND is_active=1').get(id, this.businessId))
            throw new Error('The selected branch is unavailable.');
    }
    product(branchId, id) {
        requireText(id, 'Product', 100);
        const row = this.db.prepare(`SELECT p.*,COALESCE(s.quantity_milli,0) AS quantity_milli FROM products p
      LEFT JOIN stock_levels s ON s.product_id=p.id AND s.branch_id=? WHERE p.id=? AND p.business_id=?`).get(branchId, id, this.businessId);
        if (!row || Number(row.is_active) !== 1)
            throw new Error('Select an active product from this business.');
        return row;
    }
    shift(branchId) {
        const actorId = this.actorId();
        const row = this.db.prepare("SELECT id FROM cash_shifts WHERE branch_id=? AND cashier_id=? AND status='open' ORDER BY opened_at DESC LIMIT 1").get(branchId, actorId)
            ?? this.db.prepare("SELECT id FROM cash_shifts WHERE branch_id=? AND status='open' ORDER BY opened_at DESC LIMIT 1").get(branchId);
        if (!row)
            throw new Error('Open a cash shift before paying a supplier in cash.');
        return String(row.id);
    }
    outstanding(branchId, supplierId) {
        return Number(this.db.prepare('SELECT COALESCE(SUM(debit_paisa-credit_paisa),0) AS value FROM supplier_ledger WHERE branch_id=? AND supplier_id=?').get(branchId, supplierId).value);
    }
    audit(branchId, type, id, description, reference, occurredAt) {
        this.db.prepare('INSERT INTO audit_events VALUES (?,?,?,?,?,?,?,?,?)').run(newId('audit'), branchId, this.actorId(), type, type.toLowerCase(), id, description, reference, occurredAt);
    }
    payment(branchId, supplierId, amount, method, reference, date, time) {
        const shiftId = method === 'Cash' ? this.shift(branchId) : null;
        const id = newId('supplier-payment');
        this.db.prepare('INSERT INTO supplier_payments VALUES (?,?,?,?,?,?,?,?)').run(id, branchId, supplierId, date, method, amount, reference, time);
        this.db.prepare('INSERT INTO supplier_ledger VALUES (?,?,?,?,?,?,?,?)').run(newId('supplier-ledger'), branchId, supplierId, 'payment', 0, amount, id, time);
        if (shiftId)
            this.db.prepare('INSERT INTO cash_transactions VALUES (?,?,?,?,?,?,?,?,?,?)').run(newId('cash'), shiftId, branchId, retailBusinessDate(new Date(time)), 'supplier_payment', 'out', amount, 'Cash', id, time);
        return id;
    }
    adjustStock(request) {
        if (!request || typeof request !== 'object')
            throw new Error('Invalid stock adjustment.');
        requireText(request.operationId, 'Operation identifier', 100);
        const reason = requireText(request.reason, 'Adjustment reason', 250);
        if (typeof request.quantityDeltaMilli !== 'number' || !Number.isSafeInteger(request.quantityDeltaMilli) || request.quantityDeltaMilli === 0)
            throw new Error('Adjustment quantity must be a non-zero safe integer in milli-units.');
        return postOperation(this.db, request.branchId, request.operationId, 'stock.adjust', request, this.now().toISOString(), () => {
            this.branch(request.branchId);
            const product = this.product(request.branchId, request.productId);
            const balance = Number(product.quantity_milli) + request.quantityDeltaMilli;
            if (balance < 0)
                throw new Error('Adjustment cannot reduce stock below zero.');
            requireSafeInteger(balance, 'Stock balance');
            const time = this.now().toISOString(), id = newId('stock');
            const quantityBefore = Number(product.quantity_milli);
            const valueDelta = request.quantityDeltaMilli < 0 ? -stockCost(this.db, request.branchId, request.productId, -request.quantityDeltaMilli).costPaisa : quantityBefore ? proportionalCost(Number(this.db.prepare('SELECT total_cost_paisa FROM stock_values WHERE branch_id=? AND product_id=?').get(request.branchId, request.productId).total_cost_paisa), request.quantityDeltaMilli, quantityBefore) : proportionalCost(Number(product.purchase_price_paisa), request.quantityDeltaMilli);
            this.db.prepare(`INSERT INTO stock_levels(branch_id,product_id,quantity_milli,updated_at) VALUES (?,?,?,?)
        ON CONFLICT(branch_id,product_id) DO UPDATE SET quantity_milli=excluded.quantity_milli,updated_at=excluded.updated_at`).run(request.branchId, request.productId, balance, time);
            const type = request.quantityDeltaMilli > 0 ? 'adjustment_increase' : 'adjustment_decrease';
            this.db.prepare('INSERT INTO stock_movements VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, request.branchId, request.productId, type, request.quantityDeltaMilli, balance, 'stock_adjustment', id, reason, time);
            changeStockValue(this.db, request.branchId, request.productId, valueDelta, request.quantityDeltaMilli > 0, time, id);
            this.audit(request.branchId, 'Inventory', id, reason, String(product.name), time);
            return { movementId: id, balanceAfterMilli: balance };
        });
    }
    receivePurchase(request) {
        if (!request || typeof request !== 'object')
            throw new Error('Invalid purchase request.');
        requireText(request.operationId, 'Operation identifier', 100);
        const name = requireText(request.supplierName, 'Supplier name', 120);
        const invoice = requireText(request.supplierInvoiceNumber, 'Supplier invoice number', 100, true);
        const date = requireBusinessDate(request.businessDate);
        requireSafeInteger(request.paidAmountPaisa, 'Paid amount');
        if (!methods.has(request.paymentMethod))
            throw new Error('Select a valid payment method.');
        if (!Array.isArray(request.lines) || !request.lines.length || request.lines.length > 500)
            throw new Error('Add between 1 and 500 purchase items.');
        return postOperation(this.db, request.branchId, request.operationId, 'purchase.receive', request, this.now().toISOString(), () => {
            this.branch(request.branchId);
            const seen = new Set();
            const lines = request.lines.map(input => {
                if (!input || typeof input !== 'object')
                    throw new Error('Invalid purchase item.');
                const quantity = requireSafeInteger(input.quantityMilli, 'Purchase quantity', 1);
                const cost = requireSafeInteger(input.unitCostPaisa, 'Unit cost');
                if (seen.has(input.productId))
                    throw new Error('Add each product only once per purchase.');
                seen.add(input.productId);
                const product = this.product(request.branchId, input.productId);
                requireSafeInteger(quantity * cost, 'Purchase calculation');
                const total = requireSafeInteger(Math.round(quantity * cost / 1000), 'Line total');
                requireSafeInteger(Number(product.quantity_milli) + quantity, 'Stock balance');
                return { product, quantity, cost, total };
            });
            const total = requireSafeInteger(lines.reduce((sum, line) => sum + line.total, 0), 'Purchase total', 1);
            if (request.paidAmountPaisa > total)
                throw new Error('Paid amount cannot exceed the purchase total.');
            if (request.paidAmountPaisa > 0 && request.paymentMethod === 'Cash')
                this.shift(request.branchId);
            const time = this.now().toISOString();
            let supplier = this.db.prepare('SELECT id,is_active FROM suppliers WHERE business_id=? AND name=? COLLATE NOCASE ORDER BY rowid LIMIT 1').get(this.businessId, name);
            if (supplier && Number(supplier.is_active) !== 1)
                throw new Error('This supplier is inactive.');
            if (!supplier) {
                const id = newId('supplier');
                this.db.prepare('INSERT INTO suppliers(id,business_id,name,phone,is_active,created_at) VALUES (?,?,?,?,?,?)').run(id, this.businessId, name, null, 1, time);
                supplier = { id, is_active: 1 };
            }
            const supplierId = String(supplier.id);
            if (invoice && this.db.prepare('SELECT id FROM purchases WHERE business_id=? AND supplier_id=? AND supplier_invoice_number=? COLLATE NOCASE').get(this.businessId, supplierId, invoice))
                throw new Error('This supplier invoice has already been received.');
            const id = newId('purchase'), number = nextDocumentNumber(this.db, request.branchId, 'purchase', date);
            this.db.prepare('INSERT INTO purchases VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, this.businessId, request.branchId, supplierId, name, number, invoice, date, total, time);
            for (const line of lines) {
                const productId = String(line.product.id), balance = Number(line.product.quantity_milli) + line.quantity;
                this.db.prepare('INSERT INTO purchase_items VALUES (?,?,?,?,?,?,?)').run(newId('purchase-item'), id, productId, String(line.product.name), line.quantity, line.cost, line.total);
                this.db.prepare(`INSERT INTO stock_levels(branch_id,product_id,quantity_milli,updated_at) VALUES (?,?,?,?)
          ON CONFLICT(branch_id,product_id) DO UPDATE SET quantity_milli=excluded.quantity_milli,updated_at=excluded.updated_at`).run(request.branchId, productId, balance, time);
                const movementId = newId('stock');
                this.db.prepare('INSERT INTO stock_movements VALUES (?,?,?,?,?,?,?,?,?,?)').run(movementId, request.branchId, productId, 'purchase', line.quantity, balance, 'purchase', id, `Purchase ${number} from ${name}`, time);
                changeStockValue(this.db, request.branchId, productId, line.total, false, time, movementId);
                // Catalog cost is a reference; valuation and sale cost use the branch basis.
                this.db.prepare('UPDATE products SET purchase_price_paisa=?,updated_at=? WHERE id=? AND business_id=?').run(line.cost, time, productId, this.businessId);
            }
            this.db.prepare('INSERT INTO supplier_ledger VALUES (?,?,?,?,?,?,?,?)').run(newId('supplier-ledger'), request.branchId, supplierId, 'purchase', total, 0, id, time);
            if (request.paidAmountPaisa > 0) {
                const paymentId = this.payment(request.branchId, supplierId, request.paidAmountPaisa, request.paymentMethod, number, date, time);
                this.db.prepare('INSERT INTO supplier_payment_allocations VALUES (?,?,?)').run(paymentId, id, request.paidAmountPaisa);
            }
            this.audit(request.branchId, 'Purchase', id, 'Purchase received', number, time);
            return { purchaseId: id, purchaseNumber: number, supplierId, totalPaisa: total };
        });
    }
    createSupplier(nameOrInput, phone) {
        const isObj = typeof nameOrInput === 'object' && nameOrInput !== null;
        const name = (isObj ? nameOrInput.name : nameOrInput)?.trim();
        if (!name)
            throw new Error('Supplier name is required.');
        const existing = this.db.prepare('SELECT id FROM suppliers WHERE business_id=? AND name=? COLLATE NOCASE').get(this.businessId, name);
        if (existing)
            throw new Error('A supplier with this name already exists.');
        const id = `sup-${randomUUID()}`;
        const time = this.now().toISOString();
        const p = isObj ? (nameOrInput.phone?.trim() || null) : (phone?.trim() || null);
        this.db.prepare('INSERT INTO suppliers(id, business_id, name, phone, is_active, created_at) VALUES (?, ?, ?, ?, 1, ?)').run(id, this.businessId, name, p, time);
        if (isObj) {
            const contactPerson = nameOrInput.contactPerson?.trim() || null;
            const email = nameOrInput.email?.trim() || null;
            const ntnStrn = nameOrInput.ntnStrn?.trim() || null;
            const city = nameOrInput.city?.trim() || null;
            const address = nameOrInput.address?.trim() || null;
            const categories = nameOrInput.categories?.trim() || null;
            const paymentTerms = nameOrInput.paymentTerms?.trim() || null;
            const note = nameOrInput.note?.trim() || null;
            const openingBalancePaisa = nameOrInput.openingBalanceRupees ? Math.round(Number(nameOrInput.openingBalanceRupees) * 100) : 0;
            this.db.prepare('INSERT INTO supplier_profiles(supplier_id, contact_person, email, ntn_strn, city, address, categories, opening_balance_paisa, payment_terms, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, contactPerson, email, ntnStrn, city, address, categories, openingBalancePaisa, paymentTerms, note);
        }
        return { id, name };
    }
    paySupplier(request) {
        if (!request || typeof request !== 'object')
            throw new Error('Invalid supplier payment.');
        requireText(request.operationId, 'Operation identifier', 100);
        requireText(request.supplierId, 'Supplier', 100);
        const amount = requireSafeInteger(request.amountPaisa, 'Payment amount', 1);
        const reference = requireText(request.reference, 'Payment reference', 100, true);
        if (!methods.has(request.method))
            throw new Error('Select a valid payment method.');
        return postOperation(this.db, request.branchId, request.operationId, 'supplier.pay', request, this.now().toISOString(), () => {
            this.branch(request.branchId);
            if (!this.db.prepare('SELECT id FROM suppliers WHERE id=? AND business_id=? AND is_active=1').get(request.supplierId, this.businessId))
                throw new Error('Select an active supplier from this business.');
            const due = this.outstanding(request.branchId, request.supplierId);
            if (amount > due)
                throw new Error('Payment cannot exceed supplier outstanding.');
            const time = this.now().toISOString();
            const id = this.payment(request.branchId, request.supplierId, amount, request.method, reference, retailBusinessDate(this.now()), time);
            // Allocate oldest invoices first. Existing opening balances may have no invoice.
            const purchases = this.db.prepare(`SELECT p.id,p.total_paisa-COALESCE(SUM(a.amount_paisa),0) AS due FROM purchases p
        LEFT JOIN supplier_payment_allocations a ON a.purchase_id=p.id WHERE p.branch_id=? AND p.supplier_id=?
        GROUP BY p.id HAVING due>0 ORDER BY p.business_date,p.created_at,p.rowid`).all(request.branchId, request.supplierId);
            let remaining = amount;
            for (const purchase of purchases) {
                if (!remaining)
                    break;
                const allocated = Math.min(remaining, Number(purchase.due));
                this.db.prepare('INSERT INTO supplier_payment_allocations VALUES (?,?,?)').run(id, String(purchase.id), allocated);
                remaining -= allocated;
            }
            this.audit(request.branchId, 'Payment', id, 'Supplier payment posted', reference, time);
            return { paymentId: id, outstandingPaisa: due - amount };
        });
    }
    getSnapshot(branchId) {
        this.branch(branchId);
        this.db.exec('BEGIN');
        try {
            const products = this.db.prepare(`SELECT p.*,COALESCE(s.quantity_milli,0) AS stock FROM products p
        LEFT JOIN stock_levels s ON s.product_id=p.id AND s.branch_id=? WHERE p.business_id=? ORDER BY p.name,p.id`).all(branchId, this.businessId).map((row) => ({
                id: String(row.id), name: String(row.name), sku: String(row.sku), barcode: String(row.barcode ?? ''), category: String(row.category), subcategory: String(row.subcategory), brand: String(row.brand ?? ''), unit: String(row.unit), kind: String(row.visual_kind),
                purchasePricePaisa: Number(row.purchase_price_paisa), sellingPricePaisa: Number(row.selling_price_paisa), mrpPaisa: Number(row.mrp_paisa), minimumStockMilli: Number(row.minimum_stock_milli), stockMilli: Number(row.stock), status: Number(row.is_active) ? 'active' : 'inactive',
                imageDataUrl: row.image_data_url === null ? null : String(row.image_data_url), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
            }));
            const movements = this.db.prepare(`SELECT m.*,p.name FROM stock_movements m JOIN products p ON p.id=m.product_id WHERE m.branch_id=? AND p.business_id=? ORDER BY m.occurred_at DESC,m.rowid DESC`).all(branchId, this.businessId).map(row => ({ id: String(row.id), productId: String(row.product_id), productName: String(row.name), type: String(row.movement_type), quantityDeltaMilli: Number(row.quantity_delta_milli), balanceAfterMilli: Number(row.balance_after_milli), reason: String(row.reason ?? row.reference_type), referenceId: String(row.reference_id), occurredAt: String(row.occurred_at) }));
            const items = this.db.prepare('SELECT pi.* FROM purchase_items pi JOIN purchases p ON p.id=pi.purchase_id WHERE p.branch_id=? AND p.business_id=? ORDER BY pi.rowid').all(branchId, this.businessId);
            const itemMap = new Map();
            for (const item of items) {
                const lines = itemMap.get(String(item.purchase_id)) ?? [];
                lines.push({ productId: String(item.product_id), quantityMilli: Number(item.quantity_milli), unitCostPaisa: Number(item.unit_cost_paisa) });
                itemMap.set(String(item.purchase_id), lines);
            }
            const purchases = this.db.prepare(`SELECT p.*,COALESCE(SUM(a.amount_paisa),0) AS paid FROM purchases p
        LEFT JOIN supplier_payment_allocations a ON a.purchase_id=p.id WHERE p.branch_id=? AND p.business_id=?
        GROUP BY p.id ORDER BY p.created_at DESC,p.rowid DESC`).all(branchId, this.businessId).map(row => ({ id: String(row.id), supplierId: String(row.supplier_id), purchaseNumber: String(row.purchase_number), supplierName: String(row.supplier_name_snapshot), supplierInvoiceNumber: String(row.supplier_invoice_number), businessDate: String(row.business_date), totalPaisa: Number(row.total_paisa), paidPaisa: Number(row.paid), duePaisa: Number(row.total_paisa) - Number(row.paid), createdAt: String(row.created_at), lines: itemMap.get(String(row.id)) ?? [] }));
            const suppliers = this.db.prepare(`SELECT s.*,
        sp.contact_person, sp.email, sp.ntn_strn, sp.city, sp.address, sp.categories, sp.payment_terms, sp.note,
        COALESCE((SELECT SUM(CASE WHEN entry_type='purchase' THEN debit_paisa ELSE 0 END) FROM supplier_ledger l WHERE l.supplier_id=s.id AND l.branch_id=?),0) AS total_purchases,
        COALESCE((SELECT SUM(credit_paisa) FROM supplier_ledger l WHERE l.supplier_id=s.id AND l.branch_id=?),0) AS total_paid,
        (SELECT MAX(business_date) FROM purchases p WHERE p.supplier_id=s.id AND p.branch_id=?) AS last_purchase,
        (COALESCE(sp.opening_balance_paisa, 0) + COALESCE((SELECT SUM(debit_paisa-credit_paisa) FROM supplier_ledger l WHERE l.supplier_id=s.id AND l.branch_id=?),0)) AS outstanding
        FROM suppliers s
        LEFT JOIN supplier_profiles sp ON sp.supplier_id=s.id
        WHERE s.business_id=? ORDER BY s.name,s.id`).all(branchId, branchId, branchId, branchId, this.businessId).map(row => ({
                id: String(row.id),
                name: String(row.name),
                phone: String(row.phone ?? ''),
                isActive: Boolean(row.is_active),
                totalPurchasesPaisa: Number(row.total_purchases),
                totalPaidPaisa: Number(row.total_paid),
                outstandingPaisa: Number(row.outstanding),
                lastPurchaseDate: row.last_purchase === null ? null : String(row.last_purchase),
                contactPerson: String(row.contact_person ?? ''),
                email: String(row.email ?? ''),
                ntnStrn: String(row.ntn_strn ?? ''),
                city: String(row.city ?? ''),
                address: String(row.address ?? ''),
                categories: String(row.categories ?? ''),
                paymentTerms: String(row.payment_terms ?? ''),
                note: String(row.note ?? ''),
            }));
            const payments = this.db.prepare(`SELECT sp.* FROM supplier_payments sp JOIN suppliers s ON s.id=sp.supplier_id WHERE sp.branch_id=? AND s.business_id=? ORDER BY sp.created_at DESC,sp.rowid DESC`).all(branchId, this.businessId).map(row => ({ id: String(row.id), supplierId: String(row.supplier_id), businessDate: String(row.business_date), method: String(row.method), amountPaisa: Number(row.amount_paisa), reference: String(row.reference), createdAt: String(row.created_at) }));
            const supplierLedger = this.db.prepare(`SELECT l.*,COALESCE(p.business_date,sp.business_date,date(l.occurred_at,'+5 hours')) AS business_date,
        COALESCE(p.purchase_number,sp.reference,l.reference_id) AS display_reference,
        SUM(l.debit_paisa-l.credit_paisa) OVER (PARTITION BY l.supplier_id ORDER BY l.occurred_at,l.rowid ROWS UNBOUNDED PRECEDING) AS balance
        FROM supplier_ledger l JOIN suppliers s ON s.id=l.supplier_id LEFT JOIN purchases p ON p.id=l.reference_id LEFT JOIN supplier_payments sp ON sp.id=l.reference_id
        WHERE l.branch_id=? AND s.business_id=? ORDER BY l.occurred_at DESC,l.rowid DESC`).all(branchId, this.businessId).map(row => ({ id: String(row.id), supplierId: String(row.supplier_id), businessDate: String(row.business_date), type: String(row.entry_type), reference: String(row.display_reference), debitPaisa: Number(row.debit_paisa), creditPaisa: Number(row.credit_paisa), balanceAfterPaisa: Number(row.balance), occurredAt: String(row.occurred_at) }));
            const result = { branchId, businessDate: retailBusinessDate(this.now()), products, movements, purchases, suppliers, payments, supplierLedger };
            this.db.exec('COMMIT');
            return result;
        }
        catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }
}
//# sourceMappingURL=retail.mjs.map