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
        const movements = selected ? this.db.prepare('SELECT t.*,n.reason FROM cash_transactions t LEFT JOIN cash_movement_notes n ON n.transaction_id=t.id WHERE t.shift_id=? ORDER BY t.occurred_at DESC,t.rowid DESC LIMIT 300').all(selected.id).map(row => ({ id: String(row.id), shiftId: String(row.shift_id), type: String(row.transaction_type), direction: row.direction, amountPaisa: Number(row.amount_paisa), reference: String(row.reference_id), note: String(row.reason ?? ''), occurredAt: String(row.occurred_at) })) : [];
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