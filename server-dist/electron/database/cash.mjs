import { randomUUID } from 'node:crypto';
import { postOperation, requireSafeInteger, requireText } from './posting.mjs';
import { retailBusinessDate } from './retail.mjs';
export class CashRepository {
    db;
    businessId;
    actor;
    now;
    constructor(db, businessId, actor, now) {
        this.db = db;
        this.businessId = businessId;
        this.actor = actor;
        this.now = now;
    }
    branch(id) {
        if (!this.db.prepare('SELECT 1 FROM branches WHERE id=? AND business_id=? AND is_active=1').get(id, this.businessId))
            throw new Error('Branch is unavailable.');
    }
    active(branchId, shiftId) {
        this.branch(branchId);
        if (!this.db.prepare("SELECT 1 FROM cash_shifts WHERE id=? AND branch_id=? AND status='open'").get(shiftId, branchId))
            throw new Error('This shift is already closed or is not the current branch shift. Refresh before continuing.');
    }
    expected(shiftId) {
        const result = Number(this.db.prepare("SELECT COALESCE(SUM(CASE direction WHEN 'in' THEN amount_paisa ELSE -amount_paisa END),0) AS n FROM cash_transactions WHERE shift_id=?").get(shiftId).n);
        if (!Number.isSafeInteger(result))
            throw new Error('Cash balance is outside the supported range.');
        return result;
    }
    record(row) {
        return {
            id: String(row.id),
            branchId: String(row.branch_id),
            cashierId: String(row.cashier_id),
            cashierName: String(row.cashier_name),
            counterId: row.counter_id ? String(row.counter_id) : 'Counter 1',
            openingCashPaisa: Number(row.opening_cash_paisa),
            status: row.status,
            openedAt: String(row.opened_at),
            closedAt: row.closed_at === null ? null : String(row.closed_at),
            expectedCashPaisa: row.expected_cash_paisa === null ? this.expected(String(row.id)) : Number(row.expected_cash_paisa),
            countedCashPaisa: row.counted_cash_paisa === null ? null : Number(row.counted_cash_paisa),
            variancePaisa: row.variance_paisa === null ? null : Number(row.variance_paisa),
            closingNote: String(row.note ?? ''),
            closedByName: row.closed_by_name === null ? null : String(row.closed_by_name),
            note: String(row.shift_note ?? row.note ?? ''),
            approvedBy: row.approved_by ? String(row.approved_by) : null,
            closeReason: row.close_reason ? String(row.close_reason) : null,
        };
    }
    snapshot(branchId, userId) {
        this.branch(branchId);
        // Cashiers see their own shifts; owner/manager views include the whole branch.
        const actorId = this.actor();
        const user = this.db.prepare("SELECT role FROM users WHERE id=?").get(actorId);
        const isManagerOrOwner = user?.role === 'Owner' || user?.role === 'Manager';
        const targetUserId = isManagerOrOwner ? userId : (userId ?? actorId);
        const rows = this.db.prepare(`SELECT s.*,s.note AS shift_note,u.name AS cashier_name,c.counted_cash_paisa,c.expected_cash_paisa,c.variance_paisa,c.note,cu.name AS closed_by_name FROM cash_shifts s JOIN users u ON u.id=s.cashier_id LEFT JOIN cash_shift_closings c ON c.shift_id=s.id LEFT JOIN users cu ON cu.id=c.closed_by WHERE s.branch_id=? ${targetUserId ? 'AND s.cashier_id=?' : ''} ORDER BY s.opened_at DESC,s.rowid DESC LIMIT 100`).all(...(targetUserId ? [branchId, targetUserId] : [branchId]));
        const shifts = rows.map(row => this.record(row));
        const activeShift = shifts.find(shift => shift.status === 'open') ?? null;
        const selected = activeShift ?? shifts[0];
        const movements = selected ? this.db.prepare(`
      SELECT
        t.*,
        n.reason,
        COALESCE(un.name, us.name, ur.name, um.name, uc.name, ue.name, uer.name, uap.name, ush.name) AS actor_name,
        s.invoice_number AS sale_invoice,
        cs.name AS sale_customer,
        sr.return_number AS bill_return_number,
        sr.reason AS bill_return_reason,
        mr.return_number AS manual_return_number,
        mr.reason AS manual_return_reason,
        sup.name AS supplier_name,
        sp.reference AS supplier_payment_ref,
        cr.receipt_number AS customer_receipt_number,
        cr.customer_name_snapshot AS receipt_customer_name,
        ex.description AS expense_description,
        ex.category AS expense_category,
        ep.expense_number AS expense_number,
        er.reversal_number AS expense_reversal_number,
        er.reason AS expense_reversal_reason,
        sh.counter_id AS shift_counter_id
      FROM cash_transactions t
      LEFT JOIN cash_movement_notes n ON n.transaction_id = t.id
      LEFT JOIN users un ON un.id = n.created_by
      LEFT JOIN cash_shifts sh ON sh.id = t.shift_id
      LEFT JOIN users ush ON ush.id = sh.cashier_id
      LEFT JOIN sales s ON s.id = t.reference_id
      LEFT JOIN users us ON us.id = s.cashier_id
      LEFT JOIN customers cs ON cs.id = s.customer_id
      LEFT JOIN sale_returns sr ON sr.id = t.reference_id
      LEFT JOIN users ur ON ur.id = sr.created_by
      LEFT JOIN manual_returns mr ON mr.id = t.reference_id
      LEFT JOIN users um ON um.id = mr.created_by
      LEFT JOIN supplier_payments sp ON sp.id = t.reference_id
      LEFT JOIN suppliers sup ON sup.id = sp.supplier_id
      LEFT JOIN (
        SELECT entity_id, user_id FROM audit_events WHERE entity_type = 'payment'
      ) ap ON ap.entity_id = sp.id
      LEFT JOIN users uap ON uap.id = ap.user_id
      LEFT JOIN customer_receipts cr ON cr.id = t.reference_id
      LEFT JOIN users uc ON uc.id = cr.created_by
      LEFT JOIN expenses ex ON ex.id = t.reference_id
      LEFT JOIN expense_postings ep ON ep.expense_id = ex.id
      LEFT JOIN users ue ON ue.id = ep.created_by
      LEFT JOIN expense_reversals er ON er.id = t.reference_id
      LEFT JOIN users uer ON uer.id = er.created_by
      WHERE t.shift_id = ?
      ORDER BY t.occurred_at DESC, t.rowid DESC
      LIMIT 300
    `).all(selected.id).map(row => {
            const type = String(row.transaction_type);
            const ref = String(row.reference_id ?? '');
            const reason = String(row.reason ?? '').trim();
            let description = reason;
            if (!description) {
                if (type === 'opening_cash' || ref.startsWith('shift-')) {
                    description = row.shift_counter_id ? `Opening Float (${String(row.shift_counter_id)})` : 'Opening Float';
                }
                else if (type === 'cash_sale' && row.sale_invoice) {
                    const cust = row.sale_customer ? ` · ${String(row.sale_customer)}` : '';
                    description = `Bill ${String(row.sale_invoice)}${cust}`;
                }
                else if (type === 'sale_refund') {
                    const retNum = row.bill_return_number || row.manual_return_number;
                    const retReason = row.bill_return_reason || row.manual_return_reason;
                    if (retNum) {
                        description = `Return ${String(retNum)}${retReason ? ` · ${String(retReason)}` : ''}`;
                    }
                    else {
                        description = 'Cash Sale Refund';
                    }
                }
                else if (type === 'supplier_payment') {
                    const supName = row.supplier_name ? String(row.supplier_name) : '';
                    const spRef = row.supplier_payment_ref ? String(row.supplier_payment_ref).trim() : '';
                    const showSpRef = spRef && !spRef.startsWith('supplier-payment-') && spRef.toLowerCase() !== 'cash';
                    description = supName
                        ? `Supplier: ${supName}${showSpRef ? ` (${spRef})` : ''}`
                        : (showSpRef ? `Supplier Payment (${spRef})` : 'Supplier Payment');
                }
                else if (type === 'customer_payment') {
                    if (row.customer_receipt_number || row.receipt_customer_name) {
                        const parts = [row.customer_receipt_number ? `Receipt ${String(row.customer_receipt_number)}` : '', row.receipt_customer_name ? String(row.receipt_customer_name) : ''].filter(Boolean);
                        description = parts.join(' · ');
                    }
                    else {
                        description = 'Customer Udhaar Payment';
                    }
                }
                else if (type === 'expense') {
                    const expNum = row.expense_number ? `${String(row.expense_number)} · ` : '';
                    const expCat = row.expense_category ? `${String(row.expense_category)}: ` : '';
                    const expDesc = row.expense_description ? String(row.expense_description) : 'Shop Expense';
                    description = `${expNum}${expCat}${expDesc}`;
                }
                else if (type === 'expense_reversal') {
                    const revNum = row.expense_reversal_number ? `${String(row.expense_reversal_number)} · ` : 'Expense Reversal · ';
                    description = `${revNum}${String(row.expense_reversal_reason ?? 'Reversed')}`;
                }
                else if (ref && !/^(cash-|sale-|supplier-payment-|sale-return-|expense-|receipt-|shift-)/.test(ref)) {
                    description = ref;
                }
                else {
                    description = type.replaceAll('_', ' ');
                }
            }
            return {
                id: String(row.id),
                shiftId: String(row.shift_id),
                type,
                direction: row.direction,
                amountPaisa: Number(row.amount_paisa),
                reference: ref,
                note: reason,
                description,
                actorName: row.actor_name ? String(row.actor_name) : '',
                paymentMethod: row.payment_method ? String(row.payment_method) : 'Cash',
                occurredAt: String(row.occurred_at),
            };
        }) : [];
        const movementCount = selected ? Number(this.db.prepare('SELECT COUNT(*) AS n FROM cash_transactions WHERE shift_id=?').get(selected.id).n) : 0;
        return { activeShift, shifts, movements, movementCount };
    }
    close(request) {
        if (!request || typeof request !== 'object')
            throw new Error('Invalid shift closing.');
        const counted = requireSafeInteger(request.countedCashPaisa, 'Counted cash');
        const note = requireText(request.note, 'Closing note', 500, true);
        requireText(request.operationId, 'Operation identifier', 100);
        return postOperation(this.db, request.branchId, request.operationId, 'shift.close', request, this.now().toISOString(), () => {
            this.active(request.branchId, request.shiftId);
            const actorId = this.actor();
            const shift = this.db.prepare('SELECT cashier_id FROM cash_shifts WHERE id=? AND branch_id=?').get(request.shiftId, request.branchId);
            if (!shift)
                throw new Error('Invalid cash shift.');
            if (shift.cashier_id !== actorId) {
                const user = this.db.prepare('SELECT role FROM users WHERE id=?').get(actorId);
                if (user?.role !== 'Owner' && user?.role !== 'Manager') {
                    throw new Error('You can only close your own cash shift.');
                }
            }
            const expected = this.expected(request.shiftId), variance = counted - expected;
            if (!Number.isSafeInteger(variance))
                throw new Error('Cash variance is outside the supported range.');
            if (variance !== 0 && note.length < 3)
                throw new Error('Explain the cash shortage or excess before closing.');
            const time = this.now().toISOString();
            this.db.prepare('INSERT INTO cash_shift_closings VALUES (?,?,?,?,?,?,?)').run(request.shiftId, counted, expected, variance, note, actorId, time);
            this.db.prepare("UPDATE cash_shifts SET status='closed',closed_at=? WHERE id=?").run(time, request.shiftId);
            this.db.prepare('INSERT INTO audit_events VALUES (?,?,?,?,?,?,?,?,?)').run(`audit-${randomUUID()}`, request.branchId, actorId, 'Shift', 'cash_shift', request.shiftId, 'Cash shift closed and reconciled', `Variance paisa: ${variance}`, time);
            return this.snapshot(request.branchId).shifts.find(shift => shift.id === request.shiftId);
        });
    }
    move(request) {
        if (!request || typeof request !== 'object' || !['in', 'out'].includes(request.direction))
            throw new Error('Invalid cash movement.');
        const amount = requireSafeInteger(request.amountPaisa, 'Cash amount', 1);
        const reason = requireText(request.reason, 'Cash movement reason', 250);
        if (reason.length < 3)
            throw new Error('Provide a reason of at least three characters.');
        requireText(request.operationId, 'Operation identifier', 100);
        return postOperation(this.db, request.branchId, request.operationId, 'cash.move', request, this.now().toISOString(), () => {
            this.active(request.branchId, request.shiftId);
            const actorId = this.actor();
            const shift = this.db.prepare('SELECT cashier_id FROM cash_shifts WHERE id=? AND branch_id=?').get(request.shiftId, request.branchId);
            if (!shift)
                throw new Error('Invalid cash shift.');
            if (shift.cashier_id !== actorId) {
                const user = this.db.prepare('SELECT role FROM users WHERE id=?').get(actorId);
                if (user?.role !== 'Owner' && user?.role !== 'Manager') {
                    throw new Error('You can only move cash in your own shift.');
                }
            }
            const next = this.expected(request.shiftId) + (request.direction === 'in' ? amount : -amount);
            requireSafeInteger(next, 'Resulting drawer cash');
            const id = `cash-${randomUUID()}`, time = this.now().toISOString();
            this.db.prepare('INSERT INTO cash_transactions VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, request.shiftId, request.branchId, retailBusinessDate(this.now()), request.direction === 'in' ? 'cash_in' : 'withdrawal', request.direction, amount, 'Cash', id, time);
            this.db.prepare('INSERT INTO cash_movement_notes VALUES (?,?,?)').run(id, reason, actorId);
            this.db.prepare('INSERT INTO audit_events VALUES (?,?,?,?,?,?,?,?,?)').run(`audit-${randomUUID()}`, request.branchId, actorId, 'Cash', 'cash_transaction', id, reason, `${request.direction} ${amount} paisa`, time);
            return { transactionId: id, expectedCashPaisa: next };
        });
    }
    forceClose(request) {
        if (!request || typeof request !== 'object')
            throw new Error('Invalid force close request.');
        const reason = requireText(request.reason, 'Force close reason', 500);
        if (reason.length < 3)
            throw new Error('Provide a reason of at least three characters.');
        const operationId = request.operationId || `force-close-${request.shiftId}`;
        return postOperation(this.db, request.branchId, operationId, 'shift.force_close', request, this.now().toISOString(), () => {
            this.branch(request.branchId);
            const actorId = this.actor();
            const user = this.db.prepare('SELECT role FROM users WHERE id=?').get(actorId);
            if (user?.role !== 'Owner' && user?.role !== 'Manager') {
                throw new Error('Only a manager or owner can force-close an unclosed shift.');
            }
            const shift = this.db.prepare("SELECT * FROM cash_shifts WHERE id=? AND branch_id=? AND status='open'").get(request.shiftId, request.branchId);
            if (!shift)
                throw new Error('Shift is not found or already closed.');
            const expected = this.expected(request.shiftId);
            const time = this.now().toISOString();
            const closeNote = `Force closed by ${user.role}: ${reason}`;
            this.db.prepare('INSERT INTO cash_shift_closings VALUES (?,?,?,?,?,?,?)').run(request.shiftId, expected, expected, 0, closeNote, actorId, time);
            this.db.prepare("UPDATE cash_shifts SET status='closed', closed_at=?, close_reason=? WHERE id=?").run(time, reason, request.shiftId);
            this.db.prepare('INSERT INTO audit_events VALUES (?,?,?,?,?,?,?,?,?)').run(`audit-${randomUUID()}`, request.branchId, actorId, 'Shift', 'cash_shift', request.shiftId, 'Shift force-closed by manager', `Reason: ${reason}`, time);
            return this.snapshot(request.branchId).shifts.find(s => s.id === request.shiftId);
        });
    }
}
//# sourceMappingURL=cash.mjs.map