import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { CustomerCollectRequest, CustomerCreateRequest, CustomerDetail, CustomerQuery, CustomerReceipt, CustomerRecord, CustomerSnapshot, CustomerUpdateRequest, ExpensePostRequest, ExpenseQuery, ExpenseRecord, ExpenseReverseRequest, ExpenseSnapshot } from '../../src/types/accounts.js'
import { getActiveCounterId } from './context.mjs'
import { postOperation, requireBusinessDate, requireSafeInteger, requireText } from './posting.mjs'
import { retailBusinessDate } from './retail.mjs'
import { enqueueOutboxEvent } from '../sync/outbox.mjs'

type Row = Record<string, string | number | null>
const methods = new Set(['Cash', 'Bank Transfer', 'JazzCash', 'Easypaisa', 'Card'])
const id = (prefix: string) => prefix + '-' + randomUUID()
const safe = (value: unknown) => {
  const result = Number(value)
  if (!Number.isSafeInteger(result)) throw new Error('Account balance is outside the supported range.')
  return result
}
const customerFacts = `SELECT c.*,COALESCE(SUM(l.debit_paisa-l.credit_paisa),0) AS balance,
  COALESCE(SUM(CASE WHEN l.entry_type='sale' THEN l.debit_paisa ELSE 0 END),0) AS credit_sales,
  COALESCE(SUM(CASE WHEN l.entry_type='payment' THEN l.credit_paisa ELSE 0 END),0) AS collected,
  COALESCE(SUM(CASE WHEN l.entry_type='sale_return' THEN l.credit_paisa ELSE 0 END),0) AS returns
  FROM customers c LEFT JOIN customer_ledger l ON l.customer_id=c.id AND l.branch_id=? WHERE c.business_id=? AND c.is_walk_in=0 GROUP BY c.id`
export const expenseFacts = `(SELECT e.id,e.id AS expense_id,COALESCE(p.expense_number,e.id) AS number,e.branch_id,e.business_date,e.description,e.category,e.amount_paisa,e.payment_method AS method,COALESCE(p.reference,'') AS reference,COALESCE(u.name,'Legacy record') AS created_by,e.occurred_at,0 AS is_reversal,CASE WHEN r.id IS NULL THEN 0 ELSE 1 END AS is_reversed,COALESCE(r.reason,'') AS reversal_reason
  FROM expenses e LEFT JOIN expense_postings p ON p.expense_id=e.id LEFT JOIN users u ON u.id=p.created_by LEFT JOIN expense_reversals r ON r.expense_id=e.id
  UNION ALL SELECT r.id,e.id,r.reversal_number,r.branch_id,r.business_date,e.description,e.category,-e.amount_paisa,e.payment_method,'Reversal of '||COALESCE(p.expense_number,e.id),u.name,r.occurred_at,1,1,r.reason
  FROM expense_reversals r JOIN expenses e ON e.id=r.expense_id LEFT JOIN expense_postings p ON p.expense_id=e.id JOIN users u ON u.id=r.created_by)`

export class AccountsRepository {
  constructor(private readonly db: DatabaseSync, private readonly businessId: string, private readonly actor: () => string, private readonly now: () => Date) {}
  private branch(branchId: string) {
    requireText(branchId, 'Branch', 100)
    if (!this.db.prepare('SELECT 1 FROM branches WHERE id=? AND business_id=? AND is_active=1').get(branchId, this.businessId)) throw new Error('Branch is unavailable.')
  }
  private customer(customerId: string): Row {
    requireText(customerId, 'Customer', 100)
    const row = this.db.prepare('SELECT * FROM customers WHERE id=? AND business_id=? AND is_walk_in=0').get(customerId, this.businessId) as Row | undefined
    if (!row) throw new Error('Select a registered customer from this business.')
    return row
  }
  private balance(branchId: string, customerId: string) {
    return safe(this.db.prepare('SELECT COALESCE(SUM(debit_paisa-credit_paisa),0) AS n FROM customer_ledger WHERE branch_id=? AND customer_id=?').get(branchId, customerId)!.n)
  }
  private record(row: Row, stats?: { totalPurchasesPaisa: number; totalPaidSalesPaisa: number; lastPurchaseAt: string | null }): CustomerRecord {
    const creditSalesPaisa = safe(row.credit_sales)
    const collectedPaisa = safe(row.collected)
    const returnsPaisa = safe(row.returns)
    const totalPurchasesPaisa = stats ? stats.totalPurchasesPaisa : creditSalesPaisa
    const totalPaidPaisa = stats ? stats.totalPaidSalesPaisa + collectedPaisa : collectedPaisa
    return {
      id: String(row.id),
      name: String(row.name),
      phone: String(row.phone ?? ''),
      isActive: Boolean(row.is_active),
      balancePaisa: safe(row.balance),
      creditSalesPaisa,
      collectedPaisa,
      returnsPaisa,
      totalPurchasesPaisa,
      totalPaidPaisa,
      lastPurchaseAt: stats?.lastPurchaseAt ?? null,
      createdAt: row.created_at ? String(row.created_at) : undefined,
    }
  }

  private branchSalesStats(branchId: string) {
    const rows = this.db.prepare(`
      SELECT
        s.customer_id,
        COALESCE(SUM(CASE WHEN s.status!='voided' THEN s.total_paisa ELSE 0 END),0) AS total_purchases,
        COALESCE(SUM(COALESCE(sp.paid_paisa,0)),0) AS paid_sales,
        MAX(s.completed_at) AS last_purchase_at
      FROM sales s
      LEFT JOIN (
        SELECT sale_id, SUM(CASE WHEN method!='Udhaar' THEN amount_paisa ELSE 0 END) AS paid_paisa
        FROM sale_payments GROUP BY sale_id
      ) sp ON sp.sale_id=s.id
      WHERE s.branch_id=?
      GROUP BY s.customer_id
    `).all(branchId) as Row[]
    return new Map(rows.map(r => [String(r.customer_id), {
      totalPurchasesPaisa: safe(r.total_purchases),
      totalPaidSalesPaisa: safe(r.paid_sales),
      lastPurchaseAt: r.last_purchase_at ? String(r.last_purchase_at) : null,
    }]))
  }
  private numbered(branchId: string, kind: 'receipt' | 'expense' | 'reversal', date: string) {
    const prefix = { receipt: 'REC', expense: 'EXP', reversal: 'REV' }[kind], start = `${prefix}-${date.replaceAll('-', '')}-`
    const table = { receipt: 'customer_receipts', expense: 'expense_postings p JOIN expenses e ON e.id=p.expense_id', reversal: 'expense_reversals' }[kind]
    const column = { receipt: 'receipt_number', expense: 'expense_number', reversal: 'reversal_number' }[kind]
    const maximum = safe(this.db.prepare(`SELECT COALESCE(MAX(CAST(substr(${column},14) AS INTEGER)),0) AS n FROM ${table} WHERE ${kind === 'expense' ? 'e.' : ''}branch_id=? AND ${column} LIKE ?`).get(branchId, start + '%')!.n)
    this.db.prepare('INSERT OR IGNORE INTO account_document_sequences VALUES (?,?,?,?)').run(branchId, kind, date, maximum)
    const number = safe(this.db.prepare('UPDATE account_document_sequences SET last_value=MAX(last_value,?)+1 WHERE branch_id=? AND kind=? AND business_date=? RETURNING last_value').get(maximum, branchId, kind, date)!.last_value)
    return start + String(number).padStart(4, '0')
  }
  private audit(branchId: string, type: string, entityId: string, description: string, reference: string, time: string) {
    this.db.prepare('INSERT INTO audit_events VALUES (?,?,?,?,?,?,?,?,?)').run(id('audit'), branchId, this.actor(), type, type === 'Customer' ? 'customer' : type === 'Customer Payment' ? 'customer_receipt' : 'expense', entityId, description, reference, time)
  }
  private cash(branchId: string, type: string, direction: 'in' | 'out', amount: number, reference: string, time: string) {
    const actorId = this.actor()
    const shift = this.db.prepare("SELECT id FROM cash_shifts WHERE branch_id=? AND cashier_id=? AND status='open'").get(branchId, actorId)
      ?? this.db.prepare("SELECT id FROM cash_shifts WHERE branch_id=? AND status='open' ORDER BY opened_at DESC LIMIT 1").get(branchId)
    if (!shift) throw new Error('Open a cash shift before recording a cash payment or expense.')
    const balance = safe(this.db.prepare("SELECT COALESCE(SUM(CASE direction WHEN 'in' THEN amount_paisa ELSE -amount_paisa END),0) AS n FROM cash_transactions WHERE shift_id=?").get(String(shift.id))!.n)
    const next = safe(balance + (direction === 'in' ? amount : -amount))
    if (direction === 'out' && next < 0) throw new Error('Expense exceeds the available drawer cash.')
    this.db.prepare('INSERT INTO cash_transactions VALUES (?,?,?,?,?,?,?,?,?,?)').run(id('cash'), String(shift.id), branchId, retailBusinessDate(this.now()), type, direction, amount, 'Cash', reference, time)
  }
  private payment(method: string, reference: string) {
    if (!methods.has(method)) throw new Error('Select a valid payment method.')
    if (method !== 'Cash' && !reference) throw new Error('Enter the bank, card or wallet transaction reference.')
  }
  createCustomer(request: CustomerCreateRequest): { customerId: string } {
    if (!request || typeof request !== 'object') throw new Error('Invalid customer request.')
    const name = requireText(request.name, 'Customer name', 120), phone = requireText(request.phone, 'Phone', 40, true)
    const opening = requireSafeInteger(request.openingBalancePaisa, 'Opening debt')
    requireText(request.operationId, 'Operation identifier', 100)
    return postOperation(this.db, request.branchId, request.operationId, 'customer.create', request, this.now().toISOString(), () => {
      this.branch(request.branchId)
      const customerId = id('customer'), time = this.now().toISOString()
      this.db.prepare('INSERT INTO customers(id,business_id,name,phone,is_walk_in,is_active,created_at) VALUES (?,?,?,?,?,?,?)').run(customerId, this.businessId, name, phone || null, 0, 1, time)
      if (opening) this.db.prepare('INSERT INTO customer_ledger VALUES (?,?,?,?,?,?,?,?)').run(id('customer-ledger'), request.branchId, customerId, 'opening_balance', opening, 0, customerId, time)
      this.audit(request.branchId, 'Customer', customerId, 'Customer created', `Opening debt paisa: ${opening}`, time)
      enqueueOutboxEvent(this.db, {
        entityType: 'customer',
        entityId: customerId,
        operation: 'upsert',
        counterId: getActiveCounterId(),
        occurredAt: time,
        payload: {
          id: customerId,
          businessId: this.businessId,
          branchId: request.branchId,
          name,
          phone: phone || '',
          isWalkIn: false,
          isActive: true,
          openingBalancePaisa: opening,
          syncVersion: 1,
          createdAt: time,
        },
      })
      return { customerId }
    })
  }
  updateCustomer(request: CustomerUpdateRequest): { customerId: string } {
    if (!request || typeof request !== 'object' || typeof request.isActive !== 'boolean') throw new Error('Invalid customer update.')
    const name = requireText(request.name, 'Customer name', 120), phone = requireText(request.phone, 'Phone', 40, true)
    requireText(request.operationId, 'Operation identifier', 100)
    return postOperation(this.db, request.branchId, request.operationId, 'customer.update', request, this.now().toISOString(), () => {
      this.branch(request.branchId); this.customer(request.customerId)
      const time = this.now().toISOString()
      this.db.prepare('UPDATE customers SET name=?,phone=?,is_active=? WHERE id=?').run(name, phone || null, request.isActive ? 1 : 0, request.customerId)
      this.db.prepare("INSERT INTO entity_sync_state(entity_type,entity_id,sync_version) VALUES ('customer',?,2) ON CONFLICT(entity_type,entity_id) DO UPDATE SET sync_version=sync_version+1").run(request.customerId)
      const ver = Number((this.db.prepare("SELECT sync_version FROM entity_sync_state WHERE entity_type='customer' AND entity_id=?").get(request.customerId) as Row | undefined)?.sync_version ?? 1)
      this.audit(request.branchId, 'Customer', request.customerId, 'Customer details updated', request.isActive ? 'Active' : 'Inactive', time)
      enqueueOutboxEvent(this.db, {
        entityType: 'customer',
        entityId: request.customerId,
        operation: 'upsert',
        counterId: getActiveCounterId(),
        occurredAt: time,
        payload: {
          id: request.customerId,
          businessId: this.businessId,
          branchId: request.branchId,
          name,
          phone: phone || '',
          isWalkIn: false,
          isActive: request.isActive,
          syncVersion: ver,
        },
      })
      return { customerId: request.customerId }
    })
  }
  collect(request: CustomerCollectRequest): CustomerReceipt {
    if (!request || typeof request !== 'object') throw new Error('Invalid customer payment.')
    const amount = requireSafeInteger(request.amountPaisa, 'Payment amount', 1), reference = requireText(request.reference, 'Payment reference', 100, true)
    this.payment(request.method, reference)
    requireText(request.operationId, 'Operation identifier', 100)
    return postOperation(this.db, request.branchId, request.operationId, 'customer.collect', request, this.now().toISOString(), () => {
      this.branch(request.branchId)
      const customer = this.customer(request.customerId), balance = this.balance(request.branchId, request.customerId)
      if (amount > balance) throw new Error('Payment cannot exceed this customer\'s outstanding debt in the selected branch.')
      const receiptId = id('receipt'), time = this.now().toISOString(), date = retailBusinessDate(this.now()), number = this.numbered(request.branchId, 'receipt', date)
      this.db.prepare('INSERT INTO customer_receipts VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(receiptId, request.branchId, request.customerId, number, date, String(customer.name), String(customer.phone ?? ''), amount, balance - amount, request.method, reference, this.actor(), time)
      this.db.prepare('INSERT INTO customer_ledger VALUES (?,?,?,?,?,?,?,?)').run(id('customer-ledger'), request.branchId, request.customerId, 'payment', 0, amount, receiptId, time)
      if (request.method === 'Cash') this.cash(request.branchId, 'customer_payment', 'in', amount, receiptId, time)
      this.audit(request.branchId, 'Customer Payment', receiptId, 'Customer debt payment received', number, time)
      enqueueOutboxEvent(this.db, {
        entityType: 'customer_receipt',
        entityId: receiptId,
        operation: 'create',
        counterId: getActiveCounterId(),
        occurredAt: time,
        payload: {
          id: receiptId,
          branchId: request.branchId,
          customerId: request.customerId,
          receiptNumber: number,
          businessDate: date,
          method: request.method,
          amountPaisa: amount,
          note: reference,
          createdBy: this.actor(),
          occurredAt: time,
        },
      })
      return this.receipt(request.branchId, receiptId)
    })
  }
  receipt(branchId: string, receiptId: string): CustomerReceipt {
    this.branch(branchId)
    const row = this.db.prepare(`SELECT r.*,u.name AS received_by,b.name AS branch_name,bu.name AS business_name FROM customer_receipts r JOIN users u ON u.id=r.created_by JOIN branches b ON b.id=r.branch_id JOIN businesses bu ON bu.id=b.business_id WHERE r.id=? AND r.branch_id=? AND b.business_id=?`).get(receiptId, branchId, this.businessId) as Row | undefined
    if (!row) throw new Error('Receipt is unavailable in this branch.')
    return { id: String(row.id), number: String(row.receipt_number), businessName: String(row.business_name), branchName: String(row.branch_name), customerId: String(row.customer_id), customerName: String(row.customer_name_snapshot), customerPhone: String(row.customer_phone_snapshot), amountPaisa: safe(row.amount_paisa), balanceAfterPaisa: safe(row.balance_after_paisa), method: String(row.method) as CustomerReceipt['method'], reference: String(row.reference), receivedBy: String(row.received_by), occurredAt: String(row.created_at) }
  }
  customers(query: CustomerQuery): CustomerSnapshot {
    this.branch(query.branchId)
    const search = requireText(query.search, 'Search', 120, true), page = requireSafeInteger(query.page, 'Page', 1), pageSize = requireSafeInteger(query.pageSize, 'Page size', 1)
    if (pageSize > 100 || !['all', 'due', 'credit', 'inactive'].includes(query.filter)) throw new Error('Invalid customer filters.')
    const condition = `WHERE (instr(lower(name),lower(?))>0 OR instr(phone,?)>0) ${query.filter === 'due' ? 'AND balance>0' : query.filter === 'credit' ? 'AND balance<0' : query.filter === 'inactive' ? 'AND is_active=0' : ''}`
    const params = [query.branchId, this.businessId, search, search]
    const total = safe(this.db.prepare(`SELECT COUNT(*) AS n FROM (${customerFacts}) ${condition}`).get(...params)!.n)
    const rows = this.db.prepare(`SELECT * FROM (${customerFacts}) ${condition} ORDER BY name,id LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize) as Row[]
    const summary = this.db.prepare(`SELECT COUNT(*) AS n,COALESCE(SUM(MAX(balance,0)),0) AS due,COALESCE(SUM(MAX(-balance,0)),0) AS credit FROM (${customerFacts})`).get(query.branchId, this.businessId)!
    const statsMap = this.branchSalesStats(query.branchId)
    return { customers: rows.map(row => this.record(row, statsMap.get(String(row.id)))), total, page, pageCount: Math.max(1, Math.ceil(total / pageSize)), customerCount: safe(summary.n), duePaisa: safe(summary.due), creditPaisa: safe(summary.credit), businessDate: retailBusinessDate(this.now()) }
  }
  customerDetail(branchId: string, customerId: string, page = 1): CustomerDetail {
    this.branch(branchId); this.customer(customerId); requireSafeInteger(page, 'Page', 1)
    const row = this.db.prepare(`SELECT * FROM (${customerFacts}) WHERE id=?`).get(branchId, this.businessId, customerId) as Row
    const stats = this.branchSalesStats(branchId).get(customerId)
    const total = safe(this.db.prepare('SELECT COUNT(*) AS n FROM customer_ledger WHERE branch_id=? AND customer_id=?').get(branchId, customerId)!.n)
    const ledger = (this.db.prepare(`SELECT l.*,COALESCE(s.invoice_number,r.receipt_number,sr.return_number,l.reference_id) AS display_reference,SUM(l.debit_paisa-l.credit_paisa) OVER (ORDER BY l.occurred_at,l.rowid ROWS UNBOUNDED PRECEDING) AS balance
      FROM customer_ledger l LEFT JOIN sales s ON s.id=l.reference_id LEFT JOIN customer_receipts r ON r.id=l.reference_id LEFT JOIN sale_returns sr ON sr.id=l.reference_id WHERE l.branch_id=? AND l.customer_id=? ORDER BY l.occurred_at DESC,l.rowid DESC LIMIT 50 OFFSET ?`).all(branchId, customerId, (page - 1) * 50) as Row[]).map(entry => ({ id: String(entry.id), type: String(entry.entry_type), reference: String(entry.display_reference), debitPaisa: safe(entry.debit_paisa), creditPaisa: safe(entry.credit_paisa), balanceAfterPaisa: safe(entry.balance), occurredAt: String(entry.occurred_at) }))
    const receipts = this.db.prepare('SELECT id FROM customer_receipts WHERE branch_id=? AND customer_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100').all(branchId, customerId).map(row => this.receipt(branchId, String(row.id)))
    const sales = (this.db.prepare(`SELECT s.*,COALESCE((SELECT GROUP_CONCAT(method,', ') FROM sale_payments WHERE sale_id=s.id),'Unpaid') AS method FROM sales s WHERE branch_id=? AND customer_id=? ORDER BY completed_at DESC,rowid DESC LIMIT 100`).all(branchId, customerId) as Row[]).map(sRow => {
      const saleId = String(sRow.id)
      const items = (this.db.prepare('SELECT product_name_snapshot, quantity_milli, unit_price_paisa, discount_paisa, line_total_paisa FROM sale_items WHERE sale_id=? ORDER BY rowid').all(saleId) as Row[]).map(item => ({
        productName: String(item.product_name_snapshot),
        quantityMilli: safe(item.quantity_milli),
        unitPricePaisa: safe(item.unit_price_paisa),
        discountPaisa: safe(item.discount_paisa),
        lineTotalPaisa: safe(item.line_total_paisa),
      }))
      return { id: saleId, number: String(sRow.invoice_number), totalPaisa: safe(sRow.total_paisa), paymentMethod: String(sRow.method), status: String(sRow.status), occurredAt: String(sRow.completed_at), items }
    })
    return { customer: this.record(row, stats), ledger, ledgerTotal: total, page, pageCount: Math.max(1, Math.ceil(total / 50)), receipts, sales }
  }
  postExpense(request: ExpensePostRequest): { expenseId: string; number: string } {
    if (!request || typeof request !== 'object') throw new Error('Invalid expense request.')
    const amount = requireSafeInteger(request.amountPaisa, 'Expense amount', 1), description = requireText(request.description, 'Description', 250), category = requireText(request.category, 'Category', 60), date = requireBusinessDate(request.businessDate), reference = requireText(request.reference, 'Reference', 100, true)
    if (date > retailBusinessDate(this.now())) throw new Error('Paid expenses cannot be dated in the future.')
    this.payment(request.method, reference)
    requireText(request.operationId, 'Operation identifier', 100)
    return postOperation(this.db, request.branchId, request.operationId, 'expense.post', request, this.now().toISOString(), () => {
      this.branch(request.branchId)
      const expenseId = id('expense'), time = this.now().toISOString(), number = this.numbered(request.branchId, 'expense', date)
      this.db.prepare('INSERT INTO expenses VALUES (?,?,?,?,?,?,?,?)').run(expenseId, request.branchId, date, description, category, amount, request.method, time)
      this.db.prepare('INSERT INTO expense_postings VALUES (?,?,?,?)').run(expenseId, number, reference, this.actor())
      if (request.method === 'Cash') this.cash(request.branchId, 'expense', 'out', amount, expenseId, time)
      this.audit(request.branchId, 'Expense', expenseId, 'Paid expense posted', number, time)
      enqueueOutboxEvent(this.db, {
        entityType: 'expense',
        entityId: expenseId,
        operation: 'create',
        counterId: getActiveCounterId(),
        occurredAt: time,
        payload: {
          id: expenseId,
          branchId: request.branchId,
          expenseNumber: number,
          businessDate: date,
          category,
          description,
          method: request.method,
          amountPaisa: amount,
          note: reference,
          createdBy: this.actor(),
          occurredAt: time,
        },
      })
      return { expenseId, number }
    })
  }
  reverseExpense(request: ExpenseReverseRequest): { reversalId: string; number: string } {
    if (!request || typeof request !== 'object') throw new Error('Invalid expense reversal.')
    const reason = requireText(request.reason, 'Reversal reason', 250)
    if (reason.length < 3) throw new Error('Explain the expense reversal with at least three characters.')
    requireText(request.operationId, 'Operation identifier', 100)
    return postOperation(this.db, request.branchId, request.operationId, 'expense.reverse', request, this.now().toISOString(), () => {
      this.branch(request.branchId)
      const expense = this.db.prepare('SELECT * FROM expenses WHERE id=? AND branch_id=?').get(request.expenseId, request.branchId) as Row | undefined
      if (!expense) throw new Error('Expense is unavailable in this branch.')
      if (!this.db.prepare('SELECT 1 FROM expense_postings WHERE expense_id=?').get(request.expenseId)) throw new Error('Legacy expenses require manual reconciliation before reversal.')
      if (this.db.prepare('SELECT 1 FROM expense_reversals WHERE expense_id=?').get(request.expenseId)) throw new Error('This expense has already been reversed.')
      const reversalId = id('expense-reversal'), date = retailBusinessDate(this.now()), time = this.now().toISOString(), number = this.numbered(request.branchId, 'reversal', date)
      this.db.prepare('INSERT INTO expense_reversals VALUES (?,?,?,?,?,?,?,?)').run(reversalId, request.expenseId, request.branchId, number, date, reason, this.actor(), time)
      if (expense.payment_method === 'Cash') this.cash(request.branchId, 'expense_reversal', 'in', safe(expense.amount_paisa), reversalId, time)
      this.audit(request.branchId, 'Expense Reversal', reversalId, reason, number, time)
      enqueueOutboxEvent(this.db, {
        entityType: 'expense',
        entityId: reversalId,
        operation: 'reverse',
        counterId: getActiveCounterId(),
        occurredAt: time,
        payload: {
          id: reversalId,
          originalExpenseId: request.expenseId,
          branchId: request.branchId,
          expenseNumber: number,
          businessDate: date,
          category: String(expense.category),
          description: String(expense.description),
          method: String(expense.payment_method),
          amountPaisa: -safe(expense.amount_paisa),
          note: reason,
          createdBy: this.actor(),
          occurredAt: time,
        },
      })
      return { reversalId, number }
    })
  }
  expenses(query: ExpenseQuery): ExpenseSnapshot {
    this.branch(query.branchId)
    const from = requireBusinessDate(query.dateFrom), to = requireBusinessDate(query.dateTo), search = requireText(query.search, 'Search', 120, true), category = requireText(query.category, 'Category filter', 60, true), method = requireText(query.method, 'Payment filter', 30, true)
    const page = requireSafeInteger(query.page, 'Page', 1), size = requireSafeInteger(query.pageSize, 'Page size', 1)
    if (from > to || size > 100 || method && !methods.has(method)) throw new Error('Invalid expense filters.')
    const where = "WHERE branch_id=? AND business_date BETWEEN ? AND ? AND (instr(lower(description),lower(?))>0 OR instr(lower(number),lower(?))>0) AND (?='' OR category=?) AND (?='' OR method=?)"
    const params = [query.branchId, from, to, search, search, category, category, method, method]
    const summary = this.db.prepare(`SELECT COUNT(*) AS n,COALESCE(SUM(amount_paisa),0) AS net,COALESCE(SUM(MAX(amount_paisa,0)),0) AS posted,COALESCE(SUM(MAX(-amount_paisa,0)),0) AS reversed FROM ${expenseFacts} ${where}`).get(...params)!
    const todayDate = retailBusinessDate(this.now())
    const yearStart = todayDate.slice(0, 4) + '-01-01'
    const todayPaisa = safe(this.db.prepare(`SELECT COALESCE(SUM(amount_paisa),0) AS n FROM ${expenseFacts} WHERE branch_id=? AND business_date=?`).get(query.branchId, todayDate)!.n)
    const yearPaisa = safe(this.db.prepare(`SELECT COALESCE(SUM(amount_paisa),0) AS n FROM ${expenseFacts} WHERE branch_id=? AND business_date BETWEEN ? AND ?`).get(query.branchId, yearStart, todayDate)!.n)
    const records = (this.db.prepare(`SELECT * FROM ${expenseFacts} ${where} ORDER BY occurred_at DESC,id DESC LIMIT ? OFFSET ?`).all(...params, size, (page - 1) * size) as Row[]).map((row): ExpenseRecord => ({ id: String(row.id), expenseId: String(row.expense_id), number: String(row.number), businessDate: String(row.business_date), description: String(row.description), category: String(row.category), amountPaisa: safe(row.amount_paisa), method: String(row.method), reference: String(row.reference), createdBy: String(row.created_by), occurredAt: String(row.occurred_at), isReversal: Boolean(row.is_reversal), isReversed: Boolean(row.is_reversed), reversalReason: String(row.reversal_reason) }))
    const categories = this.db.prepare('SELECT DISTINCT category FROM expenses WHERE branch_id=? ORDER BY category').all(query.branchId).map(row => String(row.category))
    const byCategory = this.db.prepare(`SELECT category,SUM(amount_paisa) AS net FROM ${expenseFacts} ${where} GROUP BY category ORDER BY net DESC,category`).all(...params).map(row => ({ category: String(row.category), netPaisa: safe(row.net) }))
    const total = safe(summary.n)
    return { records, total, page, pageCount: Math.max(1, Math.ceil(total / size)), netPaisa: safe(summary.net), postedPaisa: safe(summary.posted), reversedPaisa: safe(summary.reversed), todayPaisa, yearPaisa, categories, byCategory, businessDate: todayDate }
  }
}
