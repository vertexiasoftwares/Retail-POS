import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { CLOUD_COLLECTIONS, type MongoCloudStore } from '../db/mongo-store.mjs'
import type { CloudRealtimeBroker } from '../realtime.mjs'
import { enforceCloudOwner } from './auth.mjs'

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function registerRemoteOwnerRoutes(
  app: FastifyInstance,
  store: MongoCloudStore,
  realtime?: CloudRealtimeBroker,
): void {
  // GET /api/cloud/owner/dashboard — Works completely offline from Main PC
  app.get('/api/cloud/owner/dashboard', async (request, reply) => {
    const q = request.query as { shopUuid?: string }
    const session = await enforceCloudOwner(request, reply, store, 'dashboard.read', q.shopUuid)
    if (!session) return

    const todayBusinessDate = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10)
    const shopUuid = session.shopUuid

    const [
      shopDoc,
      activeInstallations,
      salesDocs,
      saleReturnsDocs,
      manualReturnsDocs,
      productDocs,
      stockDocs,
      counterDocs,
      customerDocs,
      expenseDocs,
      openShiftsCount,
      remoteOwnerEventsCount,
    ] = await Promise.all([
      store.col(CLOUD_COLLECTIONS.shops).findOne({ shopUuid }),
      store.col(CLOUD_COLLECTIONS.installations).find({ shopUuid, status: 'active' }).toArray(),
      store.col(CLOUD_COLLECTIONS.sales).find({ shopUuid }).toArray(),
      store.col(CLOUD_COLLECTIONS.saleReturns).find({ shopUuid }).toArray(),
      store.col(CLOUD_COLLECTIONS.manualReturns).find({ shopUuid }).toArray(),
      store.col(CLOUD_COLLECTIONS.products).find({ shopUuid, isDeleted: { $ne: true } }).toArray(),
      store.col(CLOUD_COLLECTIONS.stockLevels).find({ shopUuid, branchId: session.branchId }).toArray(),
      store.col(CLOUD_COLLECTIONS.counters).find({ shopUuid }).sort({ counterNumber: 1 }).toArray(),
      store.col(CLOUD_COLLECTIONS.customers).find({ shopUuid }).toArray(),
      store.col(CLOUD_COLLECTIONS.expenses).find({ shopUuid }).toArray(),
      store.col(CLOUD_COLLECTIONS.cashShifts).countDocuments({ shopUuid, status: 'open' }),
      store.col(CLOUD_COLLECTIONS.cloudSyncEvents).countDocuments({ shopUuid, originSource: 'cloud_owner' }),
    ])

    let lastSyncMs = 0
    for (const inst of activeInstallations) {
      if (inst.lastSyncAt) {
        const ms = new Date(inst.lastSyncAt as Date | string).getTime()
        if (ms > lastSyncMs) lastSyncMs = ms
      }
    }

    const nonVoidedSales = salesDocs.filter(s => s.status !== 'voided')
    const grossSales = nonVoidedSales.reduce((sum, s) => sum + Number(s.totalPaisa ?? 0), 0)
    const grossProfit = nonVoidedSales.reduce((sum, s) => sum + (Number(s.totalPaisa ?? 0) - Number(s.costPaisa ?? 0)), 0)
    const todaySales = nonVoidedSales.filter(s => s.businessDate === todayBusinessDate)
    const todaySalesPaisa = todaySales.reduce((sum, s) => sum + Number(s.totalPaisa ?? 0), 0)
    const todayProfitPaisa = todaySales.reduce((sum, s) => sum + (Number(s.totalPaisa ?? 0) - Number(s.costPaisa ?? 0)), 0)

    const returnsPaisa =
      saleReturnsDocs.reduce((sum, r) => sum + Number(r.totalPaisa ?? 0), 0) +
      manualReturnsDocs.reduce((sum, r) => sum + Number(r.totalPaisa ?? 0), 0)

    const stockByProd = new Map(stockDocs.map(sl => [String(sl.productId), Number(sl.quantityMilli ?? 0)]))
    const lowStockProducts = productDocs
      .filter(p => p.isActive !== false && (stockByProd.get(String(p.id)) ?? 0) <= Number(p.lowStockMilli ?? 0))
      .map(p => ({
        id: String(p.id),
        sku: String(p.sku),
        name: String(p.name),
        unit: String(p.unit || 'Piece'),
        quantityMilli: stockByProd.get(String(p.id)) ?? 0,
        minimumStockMilli: Number(p.lowStockMilli ?? 0),
      }))
      .sort((a, b) => a.quantityMilli - b.quantityMilli)

    const customerNames = new Map(customerDocs.map(c => [String(c.id), String(c.name)]))
    const recentSales = [...salesDocs]
      .sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)))
      .slice(0, 10)
      .map(s => ({
        id: String(s.id),
        invoiceNumber: String(s.invoiceNumber),
        counterId: String(s.counterId),
        customerName: (s.customerId ? customerNames.get(String(s.customerId)) : undefined) || 'Walk-in Customer',
        totalPaisa: Number(s.totalPaisa ?? 0),
        status: String(s.status),
        completedAt: String(s.completedAt),
      }))

    const totalExpensesPaisa = expenseDocs.reduce((sum, e) => sum + Number(e.amountPaisa ?? 0), 0)
    const todayExpensesPaisa = expenseDocs
      .filter(e => e.businessDate === todayBusinessDate)
      .reduce((sum, e) => sum + Number(e.amountPaisa ?? 0), 0)
    const recentExpenses = [...expenseDocs]
      .sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)))
      .slice(0, 5)
      .map(e => ({
        id: String(e.id),
        expenseNumber: String(e.expenseNumber),
        businessDate: String(e.businessDate),
        category: String(e.category),
        description: String(e.description || ''),
        method: String(e.method),
        amountPaisa: Number(e.amountPaisa ?? 0),
        occurredAt: String(e.occurredAt),
      }))

    const countersSummary = counterDocs.map(c => {
      const cSales = nonVoidedSales.filter(s => s.counterId === c.id)
      return {
        counterId: String(c.id),
        counterNumber: Number(c.counterNumber),
        name: String(c.name),
        status: String(c.status),
        lastSeenAt: c.lastSeenAt ? String(c.lastSeenAt) : null,
        invoiceCount: cSales.length,
        salesPaisa: cSales.reduce((sum, s) => sum + Number(s.totalPaisa ?? 0), 0),
      }
    })

    return {
      shopUuid,
      businessName: shopDoc ? String(shopDoc.name) : 'Vertexia Shop',
      branchName: shopDoc ? String(shopDoc.branchName) : 'Main Shop',
      city: shopDoc ? String(shopDoc.city || '') : '',
      mainPcLastSyncAt: lastSyncMs > 0 ? new Date(lastSyncMs).toISOString() : null,
      todayBusinessDate,
      summary: {
        grossSalesPaisa: grossSales,
        returnsPaisa,
        netSalesPaisa: grossSales - returnsPaisa,
        grossProfitPaisa: grossProfit - returnsPaisa,
        invoiceCount: nonVoidedSales.length,
        lowStockCount: lowStockProducts.length,
        todaySalesPaisa,
        todaySalesCount: todaySales.length,
        todayProfitPaisa,
        totalExpensesPaisa,
        todayExpensesPaisa,
        openShiftsCount,
        remoteOwnerEventsCount,
      },
      counters: countersSummary,
      recentSales,
      recentExpenses,
      lowStockProducts: lowStockProducts.slice(0, 8),
    }
  })

  // GET /api/cloud/owner/sales
  app.get('/api/cloud/owner/sales', async (request, reply) => {
    const q = request.query as {
      shopUuid?: string
      page?: string
      pageSize?: string
      counterId?: string
      dateFrom?: string
      dateTo?: string
      search?: string
    }
    const session = await enforceCloudOwner(request, reply, store, 'sales.read', q.shopUuid)
    if (!session) return

    const page = Math.max(1, Number(q.page ?? 1) || 1)
    const pageSize = Math.min(100, Math.max(5, Number(q.pageSize ?? 25) || 25))
    const offset = (page - 1) * pageSize

    const filter: Record<string, unknown> = { shopUuid: session.shopUuid }
    if (q.counterId) filter.counterId = q.counterId
    if (q.dateFrom && /^\d{4}-\d{2}-\d{2}$/.test(q.dateFrom)) {
      filter.businessDate = { ...(filter.businessDate as object), $gte: q.dateFrom }
    }
    if (q.dateTo && /^\d{4}-\d{2}-\d{2}$/.test(q.dateTo)) {
      filter.businessDate = { ...(filter.businessDate as object), $lte: q.dateTo }
    }

    const [customers, users, counters] = await Promise.all([
      store.col(CLOUD_COLLECTIONS.customers).find({ shopUuid: session.shopUuid }).toArray(),
      store.col(CLOUD_COLLECTIONS.cloudUsers).find({ shopUuid: session.shopUuid }).toArray(),
      store.col(CLOUD_COLLECTIONS.counters).find({ shopUuid: session.shopUuid }).toArray(),
    ])
    const customerMap = new Map(customers.map(c => [String(c.id), c]))
    const userMap = new Map(users.map(u => [String(u.userId), String(u.name)]))
    const counterMap = new Map(counters.map(c => [String(c.id), String(c.name)]))

    if (q.search?.trim()) {
      const needle = q.search.trim().toLowerCase()
      const matchingCustomerIds = customers
        .filter(c => String(c.name || '').toLowerCase().includes(needle) || String(c.phone || '').toLowerCase().includes(needle))
        .map(c => String(c.id))
      const re = new RegExp(escapeRegex(q.search.trim()), 'i')
      filter.$or = [
        { invoiceNumber: re },
        ...(matchingCustomerIds.length ? [{ customerId: { $in: matchingCustomerIds } }] : []),
      ]
    }

    const total = await store.col(CLOUD_COLLECTIONS.sales).countDocuments(filter)
    const docs = await store
      .col(CLOUD_COLLECTIONS.sales)
      .find(filter)
      .sort({ completedAt: -1 })
      .skip(offset)
      .limit(pageSize)
      .toArray()

    return {
      total,
      page,
      pageSize,
      sales: docs.map(s => ({
        id: String(s.id),
        invoice_number: String(s.invoiceNumber),
        business_date: String(s.businessDate),
        counter_id: String(s.counterId),
        counter_name: counterMap.get(String(s.counterId)) || String(s.counterId),
        cashier_id: String(s.cashierId),
        cashier_name: userMap.get(String(s.cashierId)) || null,
        customer_id: s.customerId ? String(s.customerId) : null,
        customer_name: (s.customerId ? customerMap.get(String(s.customerId))?.name : null) || null,
        status: String(s.status),
        payment_method: String(s.paymentMethod),
        subtotal_paisa: Number(s.subtotalPaisa ?? 0),
        discount_paisa: Number(s.discountPaisa ?? 0),
        tax_paisa: Number(s.taxPaisa ?? 0),
        total_paisa: Number(s.totalPaisa ?? 0),
        cost_paisa: Number(s.costPaisa ?? 0),
        paid_paisa: Number(s.paidPaisa ?? 0),
        completed_at: String(s.completedAt),
        note: s.note ? String(s.note) : null,
      })),
    }
  })

  // GET /api/cloud/owner/sales/:id
  app.get('/api/cloud/owner/sales/:id', async (request, reply) => {
    const params = request.params as { id: string }
    const q = request.query as { shopUuid?: string }
    const session = await enforceCloudOwner(request, reply, store, 'sales.read', q.shopUuid)
    if (!session) return

    const s = await store.col(CLOUD_COLLECTIONS.sales).findOne({ shopUuid: session.shopUuid, id: params.id })
    if (!s) {
      return reply.status(404).send({ error: 'NotFound', message: 'Sale invoice not found.', statusCode: 404 })
    }

    const [customer, cashier, counter, returnsDocs] = await Promise.all([
      s.customerId ? store.col(CLOUD_COLLECTIONS.customers).findOne({ shopUuid: session.shopUuid, id: String(s.customerId) }) : null,
      store.col(CLOUD_COLLECTIONS.cloudUsers).findOne({ shopUuid: session.shopUuid, userId: String(s.cashierId) }),
      store.col(CLOUD_COLLECTIONS.counters).findOne({ shopUuid: session.shopUuid, id: String(s.counterId) }),
      store.col(CLOUD_COLLECTIONS.saleReturns).find({ shopUuid: session.shopUuid, saleId: params.id }).sort({ occurredAt: -1 }).toArray(),
    ])

    const items = Array.isArray(s.items) ? (s.items as Array<Record<string, unknown>>) : []
    const payments = Array.isArray(s.payments) ? (s.payments as Array<Record<string, unknown>>) : []

    return {
      sale: {
        id: String(s.id),
        invoice_number: String(s.invoiceNumber),
        business_date: String(s.businessDate),
        counter_id: String(s.counterId),
        counter_name: counter ? String(counter.name) : String(s.counterId),
        cashier_id: String(s.cashierId),
        cashier_name: cashier ? String(cashier.name) : null,
        customer_id: s.customerId ? String(s.customerId) : null,
        customer_name: customer ? String(customer.name) : null,
        customer_phone: customer?.phone ? String(customer.phone) : null,
        status: String(s.status),
        payment_method: String(s.paymentMethod),
        subtotal_paisa: Number(s.subtotalPaisa ?? 0),
        discount_paisa: Number(s.discountPaisa ?? 0),
        tax_paisa: Number(s.taxPaisa ?? 0),
        total_paisa: Number(s.totalPaisa ?? 0),
        cost_paisa: Number(s.costPaisa ?? 0),
        paid_paisa: Number(s.paidPaisa ?? 0),
        completed_at: String(s.completedAt),
        note: s.note ? String(s.note) : null,
      },
      items: items.map(i => ({
        id: String(i.id),
        product_id: String(i.productId),
        product_name_snapshot: String(i.productNameSnapshot || ''),
        sku_snapshot: String(i.skuSnapshot || ''),
        unit_snapshot: String(i.unitSnapshot || 'Piece'),
        quantity_milli: Number(i.quantityMilli ?? 0),
        unit_price_paisa: Number(i.unitPricePaisa ?? 0),
        cost_price_paisa: Number(i.costPricePaisa ?? 0),
        tax_rate_bps: Number(i.taxRateBps ?? 0),
        line_total_paisa: Number(i.lineTotalPaisa ?? 0),
      })),
      payments: payments.map(p => ({
        id: String(p.id),
        method: String(p.method),
        amount_paisa: Number(p.amountPaisa ?? 0),
        reference: String(p.reference || ''),
        occurred_at: String(p.occurredAt || s.completedAt),
      })),
      returns: returnsDocs.map(r => ({
        id: String(r.id),
        return_number: String(r.returnNumber),
        refund_method: String(r.refundMethod),
        subtotal_paisa: Number(r.subtotalPaisa ?? 0),
        tax_paisa: Number(r.taxPaisa ?? 0),
        total_paisa: Number(r.totalPaisa ?? 0),
        cost_paisa: Number(r.costPaisa ?? 0),
        note: String(r.note || ''),
        occurred_at: String(r.occurredAt),
      })),
    }
  })

  // GET /api/cloud/owner/purchases
  app.get('/api/cloud/owner/purchases', async (request, reply) => {
    const q = request.query as {
      shopUuid?: string
      page?: string
      pageSize?: string
      dateFrom?: string
      dateTo?: string
      search?: string
    }
    const session = await enforceCloudOwner(request, reply, store, 'retail.read', q.shopUuid)
    if (!session) return

    const page = Math.max(1, Number(q.page ?? 1) || 1)
    const pageSize = Math.min(100, Math.max(5, Number(q.pageSize ?? 50) || 50))
    const offset = (page - 1) * pageSize

    const filter: Record<string, unknown> = { shopUuid: session.shopUuid }
    if (q.dateFrom && /^\d{4}-\d{2}-\d{2}$/.test(q.dateFrom)) {
      filter.businessDate = { ...(filter.businessDate as object), $gte: q.dateFrom }
    }
    if (q.dateTo && /^\d{4}-\d{2}-\d{2}$/.test(q.dateTo)) {
      filter.businessDate = { ...(filter.businessDate as object), $lte: q.dateTo }
    }
    if (q.search?.trim()) {
      const re = new RegExp(escapeRegex(q.search.trim()), 'i')
      filter.$or = [{ purchaseNumber: re }, { supplierNameSnapshot: re }]
    }

    const [total, docs, users] = await Promise.all([
      store.col(CLOUD_COLLECTIONS.purchases).countDocuments(filter),
      store.col(CLOUD_COLLECTIONS.purchases).find(filter).sort({ occurredAt: -1 }).skip(offset).limit(pageSize).toArray(),
      store.col(CLOUD_COLLECTIONS.cloudUsers).find({ shopUuid: session.shopUuid }).toArray(),
    ])
    const userMap = new Map(users.map(u => [String(u.userId), String(u.name)]))

    return {
      total,
      page,
      pageSize,
      purchases: docs.map(r => ({
        id: String(r.id),
        supplier_id: String(r.supplierId),
        supplier_name_snapshot: String(r.supplierNameSnapshot || ''),
        purchase_number: String(r.purchaseNumber),
        business_date: String(r.businessDate),
        total_paisa: Number(r.totalPaisa ?? 0),
        paid_paisa: Number(r.paidPaisa ?? 0),
        note: String(r.note || ''),
        created_by_name: userMap.get(String(r.createdBy)) || null,
        occurred_at: String(r.occurredAt),
      })),
    }
  })

  // GET /api/cloud/owner/cash-shifts
  app.get('/api/cloud/owner/cash-shifts', async (request, reply) => {
    const q = request.query as { shopUuid?: string }
    const session = await enforceCloudOwner(request, reply, store, 'shifts.read', q.shopUuid)
    if (!session) return

    const [shiftsDocs, movesDocs, users, counters] = await Promise.all([
      store.col(CLOUD_COLLECTIONS.cashShifts).find({ shopUuid: session.shopUuid }).sort({ openedAt: -1 }).limit(100).toArray(),
      store.col(CLOUD_COLLECTIONS.cashMovements).find({ shopUuid: session.shopUuid }).sort({ occurredAt: -1 }).limit(250).toArray(),
      store.col(CLOUD_COLLECTIONS.cloudUsers).find({ shopUuid: session.shopUuid }).toArray(),
      store.col(CLOUD_COLLECTIONS.counters).find({ shopUuid: session.shopUuid }).toArray(),
    ])
    const userMap = new Map(users.map(u => [String(u.userId), String(u.name)]))
    const counterMap = new Map(counters.map(c => [String(c.id), String(c.name)]))

    const movementsByShift = new Map<string, Array<Record<string, unknown>>>()
    const recentMovements = movesDocs.map(m => {
      const item = {
        id: String(m.id),
        shift_id: String(m.shiftId),
        movement_type: String(m.movementType),
        amount_paisa: Number(m.amountPaisa ?? 0),
        reason: String(m.reason || ''),
        created_by_name: userMap.get(String(m.createdBy)) || null,
        occurred_at: String(m.occurredAt),
      }
      const list = movementsByShift.get(item.shift_id)
      if (list) list.push(item)
      else movementsByShift.set(item.shift_id, [item])
      return item
    })

    return {
      shifts: shiftsDocs.map(r => ({
        id: String(r.id),
        counter_id: String(r.counterId),
        counter_name: counterMap.get(String(r.counterId)) || String(r.counterId),
        cashier_id: String(r.cashierId),
        cashier_name: userMap.get(String(r.cashierId)) || null,
        status: String(r.status),
        opening_cash_paisa: Number(r.openingCashPaisa ?? 0),
        expected_cash_paisa: r.expectedCashPaisa !== null && r.expectedCashPaisa !== undefined ? Number(r.expectedCashPaisa) : null,
        counted_cash_paisa: r.countedCashPaisa !== null && r.countedCashPaisa !== undefined ? Number(r.countedCashPaisa) : null,
        variance_paisa: r.variancePaisa !== null && r.variancePaisa !== undefined ? Number(r.variancePaisa) : null,
        note: r.note ? String(r.note) : null,
        opened_at: String(r.openedAt),
        closed_at: r.closedAt ? String(r.closedAt) : null,
        movements: movementsByShift.get(String(r.id)) ?? [],
      })),
      recentMovements,
    }
  })

  // GET /api/cloud/owner/staff (non-sensitive fields only, never password hashes)
  app.get('/api/cloud/owner/staff', async (request, reply) => {
    const q = request.query as { shopUuid?: string }
    const session = await enforceCloudOwner(request, reply, store, 'users.manage', q.shopUuid)
    if (!session) return

    const docs = await store
      .col(CLOUD_COLLECTIONS.cloudUsers)
      .find({ shopUuid: session.shopUuid }, { projection: { passwordHash: 0 } })
      .toArray()
    docs.sort((a, b) => {
      if (a.role === 'Owner' && b.role !== 'Owner') return -1
      if (b.role === 'Owner' && a.role !== 'Owner') return 1
      return String(a.name).localeCompare(String(b.name))
    })

    return {
      staff: docs.map(u => ({
        id: String(u.userId),
        name: String(u.name),
        username: u.username ? String(u.username) : null,
        role: String(u.role),
        isActive: Boolean(u.isActive),
        allowedTabs: u.allowedTabs ?? null,
        syncVersion: Number(u.syncVersion ?? 1),
        branchId: u.branchId ? String(u.branchId) : null,
        credentialVersion: Number(u.credentialVersion ?? 1),
        mustChangePassword: Boolean(u.mustChangePassword),
        createdAt: u.createdAt instanceof Date ? u.createdAt.toISOString() : String(u.createdAt),
        updatedAt: u.updatedAt instanceof Date ? u.updatedAt.toISOString() : String(u.updatedAt),
      })),
    }
  })

  // GET /api/cloud/owner/sync-status
  app.get('/api/cloud/owner/sync-status', async (request, reply) => {
    const q = request.query as { shopUuid?: string }
    const session = await enforceCloudOwner(request, reply, store, 'reports.read', q.shopUuid)
    if (!session) return

    const shopUuid = session.shopUuid
    const [installations, processedEventsCount, latestProcessed, cloudOwnerEventsCount, latestCloudEvt, conflictsCount] =
      await Promise.all([
        store.col(CLOUD_COLLECTIONS.installations).find({ shopUuid }).sort({ createdAt: 1 }).toArray(),
        store.col(CLOUD_COLLECTIONS.processedSyncEvents).countDocuments({ shopUuid }),
        store.col(CLOUD_COLLECTIONS.processedSyncEvents).find({ shopUuid }).sort({ processedAt: -1 }).limit(1).toArray(),
        store.col(CLOUD_COLLECTIONS.cloudSyncEvents).countDocuments({ shopUuid, originSource: 'cloud_owner' }),
        store.col(CLOUD_COLLECTIONS.cloudSyncEvents).find({ shopUuid, originSource: 'cloud_owner' }).sort({ cloudSeq: -1 }).limit(1).toArray(),
        store.col(CLOUD_COLLECTIONS.syncConflicts).countDocuments({ shopUuid }),
      ])

    return {
      shopUuid,
      installations: installations.map(i => ({
        nodeId: String(i.nodeId),
        nodeType: 'main_pc',
        deviceName: 'Shop Main PC',
        syncEpoch: Number(i.syncEpoch ?? 1),
        appVersion: String(i.appVersion || '1.0.0'),
        lastIp: i.lastIp ? String(i.lastIp) : null,
        status: String(i.status),
        lastSyncAt: i.lastSyncAt ? new Date(i.lastSyncAt as Date | string).toISOString() : null,
        registeredAt: i.createdAt ? new Date(i.createdAt as Date | string).toISOString() : new Date().toISOString(),
      })),
      processedEventsCount,
      lastProcessedAt: latestProcessed[0]?.processedAt ? String(latestProcessed[0].processedAt) : null,
      cloudOwnerEventsCount,
      latestCloudSeq: Number(latestCloudEvt[0]?.cloudSeq ?? 0),
      conflictsCount,
    }
  })

  // GET /api/cloud/owner/reports
  app.get('/api/cloud/owner/reports', async (request, reply) => {
    const q = request.query as { shopUuid?: string; dateFrom?: string; dateTo?: string }
    const session = await enforceCloudOwner(request, reply, store, 'reports.read', q.shopUuid)
    if (!session) return

    const dateFrom = q.dateFrom || '1970-01-01'
    const dateTo = q.dateTo || '2999-12-31'
    const shopUuid = session.shopUuid

    const [salesDocs, counters, expenses] = await Promise.all([
      store
        .col(CLOUD_COLLECTIONS.sales)
        .find({ shopUuid, status: { $ne: 'voided' }, businessDate: { $gte: dateFrom, $lte: dateTo } })
        .toArray(),
      store.col(CLOUD_COLLECTIONS.counters).find({ shopUuid }).toArray(),
      store
        .col(CLOUD_COLLECTIONS.expenses)
        .find({ shopUuid, businessDate: { $gte: dateFrom, $lte: dateTo } })
        .toArray(),
    ])

    const trendMap = new Map<string, { date: string; invoices: number; salesPaisa: number; grossProfitPaisa: number }>()
    const counterAgg = new Map<string, { counterId: string; invoiceCount: number; salesPaisa: number }>()
    for (const s of salesDocs) {
      const date = String(s.businessDate)
      const total = Number(s.totalPaisa ?? 0)
      const profit = total - Number(s.costPaisa ?? 0)
      const t = trendMap.get(date) || { date, invoices: 0, salesPaisa: 0, grossProfitPaisa: 0 }
      t.invoices += 1
      t.salesPaisa += total
      t.grossProfitPaisa += profit
      trendMap.set(date, t)

      const cid = String(s.counterId)
      const c = counterAgg.get(cid) || { counterId: cid, invoiceCount: 0, salesPaisa: 0 }
      c.invoiceCount += 1
      c.salesPaisa += total
      counterAgg.set(cid, c)
    }

    const counterInfo = new Map(counters.map(c => [String(c.id), c]))
    const byCounter = [...counterAgg.values()]
      .map(c => {
        const info = counterInfo.get(c.counterId)
        return {
          counterId: c.counterId,
          counterNumber: Number(info?.counterNumber ?? 1),
          name: String(info?.name || c.counterId),
          invoiceCount: c.invoiceCount,
          salesPaisa: c.salesPaisa,
        }
      })
      .sort((a, b) => a.counterNumber - b.counterNumber)

    const expByCat = new Map<string, number>()
    for (const e of expenses) {
      const cat = String(e.category || 'General')
      expByCat.set(cat, (expByCat.get(cat) ?? 0) + Number(e.amountPaisa ?? 0))
    }

    return {
      dateFrom,
      dateTo,
      salesTrend: [...trendMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
      byCounter,
      expensesByCategory: [...expByCat.entries()]
        .map(([category, netPaisa]) => ({ category, netPaisa }))
        .sort((a, b) => b.netPaisa - a.netPaisa),
    }
  })

  // GET /api/cloud/owner/products
  app.get('/api/cloud/owner/products', async (request, reply) => {
    const q = request.query as { shopUuid?: string; search?: string }
    const session = await enforceCloudOwner(request, reply, store, 'products.read', q.shopUuid)
    if (!session) return

    const filter: Record<string, unknown> = { shopUuid: session.shopUuid, isDeleted: { $ne: true } }
    if (q.search?.trim()) {
      const re = new RegExp(escapeRegex(q.search.trim()), 'i')
      filter.$or = [{ name: re }, { sku: re }, { barcode: re }]
    }

    const [docs, stockDocs] = await Promise.all([
      store.col(CLOUD_COLLECTIONS.products).find(filter).sort({ name: 1 }).limit(500).toArray(),
      store.col(CLOUD_COLLECTIONS.stockLevels).find({ shopUuid: session.shopUuid, branchId: session.branchId }).toArray(),
    ])
    const stockMap = new Map(stockDocs.map(s => [String(s.productId), Number(s.quantityMilli ?? 0)]))

    return {
      products: docs.map(p => ({
        id: String(p.id),
        sku: String(p.sku),
        barcode: p.barcode ? String(p.barcode) : null,
        name: String(p.name),
        category: String(p.category || 'General'),
        unit: String(p.unit || 'Piece'),
        cost_price_paisa: Number(p.costPricePaisa ?? 0),
        sale_price_paisa: Number(p.salePricePaisa ?? 0),
        low_stock_milli: Number(p.lowStockMilli ?? 0),
        quantity_milli: stockMap.get(String(p.id)) ?? 0,
        is_active: p.isActive !== false,
        sync_version: Number(p.syncVersion ?? 1),
        updated_at: String(p.updatedAt || p.createdAt || ''),
      })),
    }
  })

  // POST /api/cloud/owner/products
  app.post('/api/cloud/owner/products', async (request, reply) => {
    const body = (request.body as {
      shopUuid?: string
      id?: string
      sku?: string
      barcode?: string | null
      name?: string
      category?: string
      unit?: string
      costPricePaisa?: number
      salePricePaisa?: number
      minimumStockMilli?: number
      openingStockMilli?: number
    }) || {}
    const session = await enforceCloudOwner(request, reply, store, 'products.manage', body.shopUuid)
    if (!session) return

    if (!body.name?.trim() || !Number.isSafeInteger(body.salePricePaisa) || (body.salePricePaisa ?? 0) <= 0) {
      return reply.status(400).send({ error: 'BadRequest', message: 'Valid product name and salePricePaisa > 0 required.', statusCode: 400 })
    }

    const shopUuid = session.shopUuid
    const id = body.id?.trim() || `product-${randomUUID()}`
    const sku = body.sku?.trim().toUpperCase() || `PRD-${randomUUID().slice(0, 8).toUpperCase()}`
    const nowIso = new Date().toISOString()
    const openingQty = Number(body.openingStockMilli ?? 0)
    const costPrice = Number(body.costPricePaisa ?? 0)
    const branch = await store.col(CLOUD_COLLECTIONS.branches).findOne({ shopUuid, id: session.branchId })
    const businessId = branch ? String(branch.businessId) : 'business-noor-mart'

    await store.col(CLOUD_COLLECTIONS.products).insertOne({
      _id: `${shopUuid}:${id}` as any,
      id,
      shopUuid,
      businessId,
      sku,
      barcode: body.barcode || null,
      name: body.name.trim(),
      category: body.category?.trim() || 'General',
      unit: body.unit?.trim() || 'Piece',
      costPricePaisa: costPrice,
      salePricePaisa: body.salePricePaisa,
      lowStockMilli: Number(body.minimumStockMilli ?? 0),
      isActive: true,
      isDeleted: false,
      syncVersion: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    await store.col(CLOUD_COLLECTIONS.stockLevels).insertOne({
      _id: `${shopUuid}:${session.branchId}:${id}` as any,
      shopUuid,
      branchId: session.branchId,
      productId: id,
      quantityMilli: openingQty,
      syncVersion: 1,
      updatedAt: nowIso,
    })

    if (openingQty > 0) {
      const mvId = `stock-${randomUUID()}`
      await store.col(CLOUD_COLLECTIONS.stockMovements).insertOne({
        _id: `${shopUuid}:${mvId}` as any,
        id: mvId,
        shopUuid,
        branchId: session.branchId,
        productId: id,
        movementType: 'opening_stock',
        quantityDeltaMilli: openingQty,
        referenceType: 'cloud_product',
        referenceId: id,
        originSource: 'cloud_owner',
        counterId: 'cloud',
        note: 'Remote opening stock',
        occurredAt: nowIso,
      })
    }

    const evt = await store.appendCloudOwnerEvent({
      shopUuid,
      eventId: `cevt-${randomUUID()}`,
      entityType: 'product',
      entityId: id,
      operation: 'upsert',
      payload: {
        id,
        businessId,
        branchId: session.branchId,
        sku,
        barcode: body.barcode || null,
        name: body.name.trim(),
        category: body.category?.trim() || 'General',
        unit: body.unit?.trim() || 'Piece',
        costPricePaisa: costPrice,
        salePricePaisa: body.salePricePaisa,
        minimumStockMilli: Number(body.minimumStockMilli ?? 0),
        openingStockMilli: openingQty,
        isActive: true,
        syncVersion: 1,
      },
    })

    realtime?.broadcastToShop(shopUuid, {
      type: 'product:updated',
      shopUuid,
      payload: { productId: id, cloudSeq: evt.cloudSeq },
    })
    return { ok: true, id, sku, cloudSeq: evt.cloudSeq }
  })

  // PUT /api/cloud/owner/products/:id
  app.put('/api/cloud/owner/products/:id', async (request, reply) => {
    const params = request.params as { id: string }
    const body = (request.body as {
      shopUuid?: string
      name?: string
      salePricePaisa?: number
      costPricePaisa?: number
      minimumStockMilli?: number
      isActive?: boolean
    }) || {}
    const session = await enforceCloudOwner(request, reply, store, 'products.manage', body.shopUuid)
    if (!session) return

    const shopUuid = session.shopUuid
    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() }
    if (body.name !== undefined) updates.name = body.name
    if (body.salePricePaisa !== undefined) updates.salePricePaisa = body.salePricePaisa
    if (body.costPricePaisa !== undefined) updates.costPricePaisa = body.costPricePaisa
    if (body.minimumStockMilli !== undefined) updates.lowStockMilli = body.minimumStockMilli
    if (body.isActive !== undefined) updates.isActive = body.isActive

    const updated = await store.col(CLOUD_COLLECTIONS.products).findOneAndUpdate(
      { shopUuid, id: params.id, isDeleted: { $ne: true } },
      { $set: updates, $inc: { syncVersion: 1 } },
      { returnDocument: 'after' },
    )
    if (!updated) {
      return reply.status(404).send({ error: 'NotFound', message: 'Product not found.', statusCode: 404 })
    }

    const evt = await store.appendCloudOwnerEvent({
      shopUuid,
      eventId: `cevt-${randomUUID()}`,
      entityType: 'product',
      entityId: params.id,
      operation: 'upsert',
      payload: {
        id: String(updated.id),
        businessId: String(updated.businessId),
        branchId: session.branchId,
        sku: String(updated.sku),
        barcode: updated.barcode ? String(updated.barcode) : null,
        name: String(updated.name),
        category: String(updated.category),
        unit: String(updated.unit),
        costPricePaisa: Number(updated.costPricePaisa),
        salePricePaisa: Number(updated.salePricePaisa),
        minimumStockMilli: Number(updated.lowStockMilli),
        isActive: Boolean(updated.isActive),
        syncVersion: Number(updated.syncVersion),
      },
    })

    realtime?.broadcastToShop(shopUuid, {
      type: 'product:updated',
      shopUuid,
      payload: { productId: params.id, cloudSeq: evt.cloudSeq },
    })
    return { ok: true, product: updated, cloudSeq: evt.cloudSeq }
  })

  // POST /api/cloud/owner/inventory/adjust
  app.post('/api/cloud/owner/inventory/adjust', async (request, reply) => {
    const body = (request.body as {
      shopUuid?: string
      productId?: string
      quantityDeltaMilli?: number
      reason?: string
    }) || {}
    const session = await enforceCloudOwner(request, reply, store, 'stock.adjust', body.shopUuid)
    if (!session) return

    if (!body.productId || !Number.isSafeInteger(body.quantityDeltaMilli) || body.quantityDeltaMilli === 0) {
      return reply.status(400).send({ error: 'BadRequest', message: 'productId and non-zero quantityDeltaMilli required.', statusCode: 400 })
    }
    const deltaMilli = Number(body.quantityDeltaMilli)

    const shopUuid = session.shopUuid
    const movementId = `stock-${randomUUID()}`
    const nowIso = new Date().toISOString()

    const existing = await store.col(CLOUD_COLLECTIONS.stockLevels).findOne({
      shopUuid,
      branchId: session.branchId,
      productId: body.productId,
    })
    const currentQty = Number(existing?.quantityMilli ?? 0)
    const computedNext = Math.max(0, currentQty + deltaMilli)
    const mvType = deltaMilli > 0 ? 'adjustment_increase' : 'adjustment_decrease'

    await store.col(CLOUD_COLLECTIONS.stockMovements).insertOne({
      _id: `${shopUuid}:${movementId}` as any,
      id: movementId,
      shopUuid,
      branchId: session.branchId,
      productId: body.productId,
      movementType: mvType,
      quantityDeltaMilli: body.quantityDeltaMilli,
      referenceType: 'cloud_adjustment',
      referenceId: movementId,
      originSource: 'cloud_owner',
      counterId: 'cloud',
      note: body.reason || 'Remote owner stock adjustment',
      occurredAt: nowIso,
    })

    await store.col(CLOUD_COLLECTIONS.stockLevels).updateOne(
      { shopUuid, branchId: session.branchId, productId: body.productId },
      {
        $set: { quantityMilli: computedNext, updatedAt: nowIso },
        $inc: { syncVersion: 1 },
        $setOnInsert: {
          _id: `${shopUuid}:${session.branchId}:${body.productId}` as any,
          shopUuid,
          branchId: session.branchId,
          productId: body.productId,
        },
      },
      { upsert: true },
    )

    const evt = await store.appendCloudOwnerEvent({
      shopUuid,
      eventId: `cevt-${randomUUID()}`,
      entityType: 'stock_movement',
      entityId: movementId,
      operation: 'adjust',
      payload: {
        id: movementId,
        branchId: session.branchId,
        productId: body.productId,
        movementType: mvType,
        quantityDeltaMilli: body.quantityDeltaMilli,
        note: body.reason || 'Remote owner stock adjustment',
      },
    })

    realtime?.broadcastToShop(shopUuid, {
      type: 'inventory:changed',
      shopUuid,
      payload: { productId: body.productId, quantityMilli: computedNext, cloudSeq: evt.cloudSeq },
    })
    return { ok: true, movementId, balanceAfterMilli: computedNext, cloudSeq: evt.cloudSeq }
  })

  // GET /api/cloud/owner/customers
  app.get('/api/cloud/owner/customers', async (request, reply) => {
    const q = request.query as { shopUuid?: string }
    const session = await enforceCloudOwner(request, reply, store, 'customers.read', q.shopUuid)
    if (!session) return

    const [customers, ledger] = await Promise.all([
      store.col(CLOUD_COLLECTIONS.customers).find({ shopUuid: session.shopUuid, isWalkIn: { $ne: true }, isDeleted: { $ne: true } }).sort({ name: 1 }).toArray(),
      store.col(CLOUD_COLLECTIONS.customerLedger).find({ shopUuid: session.shopUuid }).toArray(),
    ])
    const balances = new Map<string, number>()
    for (const row of ledger) {
      const cid = String(row.customerId)
      balances.set(cid, (balances.get(cid) ?? 0) + Number(row.debitPaisa ?? 0) - Number(row.creditPaisa ?? 0))
    }

    return {
      customers: customers.map(c => ({
        id: String(c.id),
        name: String(c.name),
        phone: String(c.phone || ''),
        is_active: c.isActive !== false,
        balance_paisa: balances.get(String(c.id)) ?? 0,
        updated_at: String(c.updatedAt || c.createdAt || ''),
      })),
    }
  })

  // GET /api/cloud/owner/suppliers
  app.get('/api/cloud/owner/suppliers', async (request, reply) => {
    const q = request.query as { shopUuid?: string }
    const session = await enforceCloudOwner(request, reply, store, 'retail.read', q.shopUuid)
    if (!session) return

    const [suppliers, ledger] = await Promise.all([
      store.col(CLOUD_COLLECTIONS.suppliers).find({ shopUuid: session.shopUuid, isDeleted: { $ne: true } }).sort({ name: 1 }).toArray(),
      store.col(CLOUD_COLLECTIONS.supplierLedger).find({ shopUuid: session.shopUuid }).toArray(),
    ])
    const balances = new Map<string, number>()
    for (const row of ledger) {
      const sid = String(row.supplierId)
      balances.set(sid, (balances.get(sid) ?? 0) + Number(row.debitPaisa ?? 0) - Number(row.creditPaisa ?? 0))
    }

    return {
      suppliers: suppliers.map(s => ({
        id: String(s.id),
        name: String(s.name),
        phone: String(s.phone || ''),
        is_active: s.isActive !== false,
        balance_paisa: balances.get(String(s.id)) ?? 0,
        updated_at: String(s.updatedAt || s.createdAt || ''),
      })),
    }
  })

  // GET /api/cloud/owner/expenses
  app.get('/api/cloud/owner/expenses', async (request, reply) => {
    const q = request.query as { shopUuid?: string }
    const session = await enforceCloudOwner(request, reply, store, 'expenses.read', q.shopUuid)
    if (!session) return

    const docs = await store.col(CLOUD_COLLECTIONS.expenses).find({ shopUuid: session.shopUuid }).sort({ occurredAt: -1 }).limit(200).toArray()
    return {
      expenses: docs.map(e => ({
        id: String(e.id),
        expense_number: String(e.expenseNumber),
        business_date: String(e.businessDate),
        category: String(e.category),
        description: String(e.description || ''),
        method: String(e.method),
        amount_paisa: Number(e.amountPaisa ?? 0),
        note: String(e.note || ''),
        occurred_at: String(e.occurredAt),
      })),
    }
  })

  // GET /api/cloud/owner/counters
  app.get('/api/cloud/owner/counters', async (request, reply) => {
    const q = request.query as { shopUuid?: string }
    const session = await enforceCloudOwner(request, reply, store, 'users.manage', q.shopUuid)
    if (!session) return

    const docs = await store.col(CLOUD_COLLECTIONS.counters).find({ shopUuid: session.shopUuid }).sort({ counterNumber: 1 }).toArray()
    return {
      counters: docs.map(c => ({
        id: String(c.id),
        counter_number: Number(c.counterNumber),
        name: String(c.name),
        status: String(c.status),
        is_primary: Boolean(c.isPrimary),
        app_version: c.appVersion ? String(c.appVersion) : null,
        last_ip: c.lastIp ? String(c.lastIp) : null,
        last_seen_at: c.lastSeenAt ? String(c.lastSeenAt) : null,
        revoked_at: c.revokedAt ? String(c.revokedAt) : null,
      })),
    }
  })

  // POST /api/cloud/owner/counters/:id/revoke
  app.post('/api/cloud/owner/counters/:id/revoke', async (request, reply) => {
    const params = request.params as { id: string }
    const body = (request.body as { shopUuid?: string }) || {}
    const session = await enforceCloudOwner(request, reply, store, 'users.manage', body.shopUuid)
    if (!session) return

    const nowIso = new Date().toISOString()
    const counter = await store.col(CLOUD_COLLECTIONS.counters).findOneAndUpdate(
      { shopUuid: session.shopUuid, id: params.id, isPrimary: false },
      { $set: { status: 'revoked', revokedAt: nowIso } },
      { returnDocument: 'after' },
    )
    if (!counter) {
      return reply.status(400).send({ error: 'CannotRevoke', message: 'Counter not found or is primary Counter 1.', statusCode: 400 })
    }

    const evt = await store.appendCloudOwnerEvent({
      shopUuid: session.shopUuid,
      eventId: `cevt-${randomUUID()}`,
      entityType: 'counter',
      entityId: params.id,
      operation: 'revoke',
      payload: { id: params.id, status: 'revoked' },
    })
    return { ok: true, counter, cloudSeq: evt.cloudSeq }
  })

  // GET /api/cloud/owner/conflicts
  app.get('/api/cloud/owner/conflicts', async (request, reply) => {
    const q = request.query as { shopUuid?: string }
    const session = await enforceCloudOwner(request, reply, store, 'settings.manage', q.shopUuid)
    if (!session) return

    const docs = await store.col(CLOUD_COLLECTIONS.syncConflicts).find({ shopUuid: session.shopUuid }).sort({ resolvedAt: -1 }).limit(100).toArray()
    return {
      conflicts: docs.map(c => ({
        id: String(c.id),
        entity_type: String(c.entityType),
        entity_id: String(c.entityId),
        counter_id: String(c.counterId || 'counter-1'),
        cloud_seq: c.cloudSeq !== null && c.cloudSeq !== undefined ? Number(c.cloudSeq) : null,
        conflict_type: String(c.conflictType),
        local_summary: String(c.localSummary || ''),
        cloud_summary: String(c.cloudSummary || ''),
        resolution: String(c.resolution || ''),
        resolved_at: String(c.resolvedAt || ''),
      })),
    }
  })

  // Main PC physical hardware actions unavailable remotely
  const hardwareRequired = async (request: any, reply: any) => {
    const body = (request.body as { shopUuid?: string }) || {}
    const session = await enforceCloudOwner(request, reply, store, 'pos.sell', body.shopUuid)
    if (!session) return
    return reply.status(409).send({
      error: 'MAIN_PC_HARDWARE_REQUIRED',
      message: 'Local receipt printing and cash drawer hardware require the shop Main PC.',
      statusCode: 409,
    })
  }
  app.post('/api/cloud/owner/print-receipt', hardwareRequired)
  app.post('/api/cloud/owner/open-cash-drawer', hardwareRequired)
}
