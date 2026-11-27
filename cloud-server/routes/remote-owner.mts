import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { Pool, PoolClient } from 'pg'
import type { TenantDatabaseManager } from '../db/tenant-manager.mjs'
import type { CloudRealtimeBroker } from '../realtime.mjs'
import { enforceCloudOwner } from './auth.mjs'

async function appendCloudOwnerEvent(
  client: PoolClient,
  params: {
    entityType: string
    entityId: string
    operation: string
    payload: Record<string, unknown>
  },
): Promise<{ eventId: string; cloudSeq: number }> {
  const eventId = `cevt-${randomUUID()}`
  const { rows } = await client.query<{ cloud_seq: string }>(
    `INSERT INTO cloud_sync_events (event_id, origin_source, counter_id, entity_type, entity_id, operation, payload_json)
     VALUES ($1, 'cloud_owner', 'cloud', $2, $3, $4, $5)
     RETURNING cloud_seq`,
    [eventId, params.entityType, params.entityId, params.operation, JSON.stringify(params.payload)],
  )
  return { eventId, cloudSeq: Number(rows[0].cloud_seq) }
}

export function registerRemoteOwnerRoutes(
  app: FastifyInstance,
  centralPool: Pool,
  tenantManager: TenantDatabaseManager,
  realtime?: CloudRealtimeBroker,
): void {
  // GET /api/cloud/owner/dashboard — Works completely offline from Main PC
  app.get('/api/cloud/owner/dashboard', async (request, reply) => {
    const q = request.query as { shopUuid?: string }
    const session = await enforceCloudOwner(request, reply, centralPool, 'dashboard.read', q.shopUuid)
    if (!session) return

    const bizRes = await centralPool.query<{ name: string; branch_name: string; city: string }>(
      'SELECT name, branch_name, city FROM vtx_central.businesses WHERE shop_uuid = $1',
      [session.shopUuid],
    )
    const nodeRes = await centralPool.query<{ last_sync_at: Date | null }>(
      'SELECT MAX(last_sync_at) AS last_sync_at FROM vtx_central.installations WHERE shop_uuid = $1 AND status = $2',
      [session.shopUuid, 'active'],
    )
    const { summaryRes, returnsRes, lowStockRes, byCounterRes, recentSalesRes } =
      await tenantManager.withTenantTransaction(session.shopUuid, async client => {
        const sRes = await client.query<{
          sales_paisa: string
          profit_paisa: string
          tx_count: string
        }>(
          `SELECT COALESCE(SUM(total_paisa), 0) AS sales_paisa,
                  COALESCE(SUM(total_paisa - cost_paisa), 0) AS profit_paisa,
                  COUNT(*) AS tx_count
           FROM sales WHERE status <> 'voided'`,
        )
        const rRes = await client.query<{ total_returns_paisa: string }>(
          `SELECT COALESCE((SELECT SUM(total_paisa) FROM sale_returns), 0) + COALESCE((SELECT SUM(total_paisa) FROM manual_returns), 0) AS total_returns_paisa`,
        )
        const lRes = await client.query<{ cnt: string }>(
          `SELECT COUNT(*) AS cnt FROM products p JOIN stock_levels sl ON sl.product_id = p.id WHERE p.is_active = TRUE AND sl.quantity_milli <= p.low_stock_milli`,
        )
        const bcRes = await client.query(
          `SELECT c.id AS counter_id, c.counter_number, c.name, c.status, c.last_seen_at,
                  COUNT(s.id)::INTEGER AS invoice_count,
                  COALESCE(SUM(CASE WHEN s.status <> 'voided' THEN s.total_paisa ELSE 0 END), 0) AS sales_paisa
           FROM counters c
           LEFT JOIN sales s ON s.counter_id = c.id
           GROUP BY c.id, c.counter_number, c.name, c.status, c.last_seen_at
           ORDER BY c.counter_number ASC`,
        )
        const rsRes = await client.query(
          `SELECT s.id, s.invoice_number, s.counter_id, s.total_paisa, s.status, s.completed_at, c.name AS customer_name
           FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
           ORDER BY s.completed_at DESC LIMIT 10`,
        )
        return { summaryRes: sRes, returnsRes: rRes, lowStockRes: lRes, byCounterRes: bcRes, recentSalesRes: rsRes }
      })

    const grossSales = Number(summaryRes.rows[0]?.sales_paisa ?? 0)
    const returnsPaisa = Number(returnsRes.rows[0]?.total_returns_paisa ?? 0)

    return {
      shopUuid: session.shopUuid,
      businessName: bizRes.rows[0]?.name || 'Vertexia Shop',
      branchName: bizRes.rows[0]?.branch_name || 'Main Shop',
      city: bizRes.rows[0]?.city || '',
      mainPcLastSyncAt: nodeRes.rows[0]?.last_sync_at ? nodeRes.rows[0].last_sync_at.toISOString() : null,
      summary: {
        grossSalesPaisa: grossSales,
        returnsPaisa,
        netSalesPaisa: grossSales - returnsPaisa,
        grossProfitPaisa: Number(summaryRes.rows[0]?.profit_paisa ?? 0) - returnsPaisa,
        invoiceCount: Number(summaryRes.rows[0]?.tx_count ?? 0),
        lowStockCount: Number(lowStockRes.rows[0]?.cnt ?? 0),
      },
      counters: byCounterRes.rows.map(r => ({
        counterId: r.counter_id,
        counterNumber: Number(r.counter_number),
        name: r.name,
        status: r.status,
        lastSeenAt: r.last_seen_at,
        invoiceCount: Number(r.invoice_count),
        salesPaisa: Number(r.sales_paisa),
      })),
      recentSales: recentSalesRes.rows.map(r => ({
        id: r.id,
        invoiceNumber: r.invoice_number,
        counterId: r.counter_id,
        customerName: r.customer_name || 'Walk-in Customer',
        totalPaisa: Number(r.total_paisa),
        status: r.status,
        completedAt: r.completed_at,
      })),
    }
  })

  // GET /api/cloud/owner/sales
  app.get('/api/cloud/owner/sales', async (request, reply) => {
    const q = request.query as { shopUuid?: string; page?: string; pageSize?: string; counterId?: string }
    const session = await enforceCloudOwner(request, reply, centralPool, 'sales.read', q.shopUuid)
    if (!session) return

    const page = Math.max(1, Number(q.page ?? 1) || 1)
    const pageSize = Math.min(100, Math.max(5, Number(q.pageSize ?? 25) || 25))
    const offset = (page - 1) * pageSize
    const params: unknown[] = []
    let where = 'WHERE 1=1'
    if (q.counterId) {
      params.push(q.counterId)
      where += ` AND s.counter_id = $${params.length}`
    }

    const { totalRes, rowsRes } = await tenantManager.withTenantTransaction(session.shopUuid, async client => {
      const tRes = await client.query<{ cnt: string }>(`SELECT COUNT(*) AS cnt FROM sales s ${where}`, params)
      const rRes = await client.query(
        `SELECT s.*, c.name AS customer_name, u.name AS cashier_name
         FROM sales s
         LEFT JOIN customers c ON c.id = s.customer_id
         LEFT JOIN users u ON u.id = s.cashier_id
         ${where}
         ORDER BY s.completed_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, pageSize, offset],
      )
      return { totalRes: tRes, rowsRes: rRes }
    })

    return {
      total: Number(totalRes.rows[0].cnt),
      page,
      pageSize,
      sales: rowsRes.rows.map(r => ({
        ...r,
        subtotal_paisa: Number(r.subtotal_paisa),
        discount_paisa: Number(r.discount_paisa),
        total_paisa: Number(r.total_paisa),
        cost_paisa: Number(r.cost_paisa),
        paid_paisa: Number(r.paid_paisa),
      })),
    }
  })

  // GET /api/cloud/owner/reports
  app.get('/api/cloud/owner/reports', async (request, reply) => {
    const q = request.query as { shopUuid?: string; dateFrom?: string; dateTo?: string }
    const session = await enforceCloudOwner(request, reply, centralPool, 'reports.read', q.shopUuid)
    if (!session) return

    const dateFrom = q.dateFrom || '1970-01-01'
    const dateTo = q.dateTo || '2999-12-31'

    const { trendRes, counterRes, expenseRes } = await tenantManager.withTenantTransaction(session.shopUuid, async client => {
      const tRes = await client.query(
        `SELECT business_date, COUNT(*)::INTEGER AS invoices, COALESCE(SUM(total_paisa), 0) AS sales_paisa,
                COALESCE(SUM(total_paisa - cost_paisa), 0) AS gross_profit_paisa
         FROM sales
         WHERE status <> 'voided' AND business_date BETWEEN $1 AND $2
         GROUP BY business_date ORDER BY business_date ASC`,
        [dateFrom, dateTo],
      )
      const cRes = await client.query(
        `SELECT COALESCE(c.id, s.counter_id) AS counter_id, COALESCE(c.counter_number, 1) AS counter_number,
                COALESCE(c.name, s.counter_id) AS name, COUNT(*)::INTEGER AS invoice_count,
                COALESCE(SUM(s.total_paisa), 0) AS sales_paisa
         FROM sales s
         LEFT JOIN counters c ON c.id = s.counter_id
         WHERE s.status <> 'voided' AND s.business_date BETWEEN $1 AND $2
         GROUP BY COALESCE(c.id, s.counter_id), COALESCE(c.counter_number, 1), COALESCE(c.name, s.counter_id)
         ORDER BY counter_number ASC`,
        [dateFrom, dateTo],
      )
      const eRes = await client.query(
        `SELECT category, COALESCE(SUM(amount_paisa), 0) AS net_paisa
         FROM expenses WHERE business_date BETWEEN $1 AND $2
         GROUP BY category ORDER BY net_paisa DESC`,
        [dateFrom, dateTo],
      )
      return { trendRes: tRes, counterRes: cRes, expenseRes: eRes }
    })

    return {
      dateFrom,
      dateTo,
      salesTrend: trendRes.rows.map(r => ({
        date: r.business_date,
        invoices: Number(r.invoices),
        salesPaisa: Number(r.sales_paisa),
        grossProfitPaisa: Number(r.gross_profit_paisa),
      })),
      byCounter: counterRes.rows.map(r => ({
        counterId: r.counter_id,
        counterNumber: Number(r.counter_number),
        name: r.name,
        invoiceCount: Number(r.invoice_count),
        salesPaisa: Number(r.sales_paisa),
      })),
      expensesByCategory: expenseRes.rows.map(r => ({
        category: r.category,
        netPaisa: Number(r.net_paisa),
      })),
    }
  })

  // GET /api/cloud/owner/products
  app.get('/api/cloud/owner/products', async (request, reply) => {
    const q = request.query as { shopUuid?: string; search?: string }
    const session = await enforceCloudOwner(request, reply, centralPool, 'products.read', q.shopUuid)
    if (!session) return

    const search = q.search?.trim()
    const params: unknown[] = []
    let sql = `SELECT p.*, COALESCE(sl.quantity_milli, 0) AS quantity_milli
               FROM products p LEFT JOIN stock_levels sl ON sl.product_id = p.id AND sl.branch_id = $1`
    params.push(session.branchId)
    if (search) {
      params.push(`%${search}%`)
      sql += ` WHERE (p.name ILIKE $2 OR p.sku ILIKE $2 OR COALESCE(p.barcode, '') ILIKE $2)`
    }
    sql += ' ORDER BY p.name ASC LIMIT 500'
    const { rows } = await tenantManager.queryTenant(session.shopUuid, sql, params)
    return {
      products: rows.map(r => ({
        ...r,
        cost_price_paisa: Number(r.cost_price_paisa),
        sale_price_paisa: Number(r.sale_price_paisa),
        low_stock_milli: Number(r.low_stock_milli),
        quantity_milli: Number(r.quantity_milli),
      })),
    }
  })

  // POST /api/cloud/owner/products — Create product remotely (even if Main PC is OFF)
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
    const session = await enforceCloudOwner(request, reply, centralPool, 'products.manage', body.shopUuid)
    if (!session) return

    if (!body.name?.trim() || !Number.isSafeInteger(body.salePricePaisa) || (body.salePricePaisa ?? 0) <= 0) {
      return reply.status(400).send({ error: 'BadRequest', message: 'Valid product name and salePricePaisa > 0 required.', statusCode: 400 })
    }

    const id = body.id?.trim() || `product-${randomUUID()}`
    const sku = body.sku?.trim().toUpperCase() || `PRD-${randomUUID().slice(0, 8).toUpperCase()}`
    const nowIso = new Date().toISOString()
    const openingQty = Number(body.openingStockMilli ?? 0)
    const costPrice = Number(body.costPricePaisa ?? 0)

    const evt = await tenantManager.withTenantTransaction(session.shopUuid, async client => {
      const branchRes = await client.query<{ business_id: string }>('SELECT business_id FROM branches WHERE id = $1 LIMIT 1', [session.branchId])
      const businessId = branchRes.rows[0]?.business_id || 'business-noor-mart'

      await client.query(
        `INSERT INTO products (id, business_id, sku, barcode, name, category, unit, cost_price_paisa, sale_price_paisa, low_stock_milli, is_active, sync_version, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE,1,$11,$11)`,
        [
          id,
          businessId,
          sku,
          body.barcode || null,
          body.name!.trim(),
          body.category?.trim() || 'General',
          body.unit?.trim() || 'Piece',
          costPrice,
          body.salePricePaisa,
          Number(body.minimumStockMilli ?? 0),
          nowIso,
        ],
      )
      await client.query(
        `INSERT INTO stock_levels (branch_id, product_id, quantity_milli, sync_version, updated_at) VALUES ($1,$2,$3,1,$4)`,
        [session.branchId, id, openingQty, nowIso],
      )
      if (openingQty > 0) {
        await client.query(
          `INSERT INTO stock_movements (id, branch_id, product_id, movement_type, quantity_delta_milli, reference_type, reference_id, origin_source, counter_id, note, occurred_at)
           VALUES ($1,$2,$3,'opening_stock',$4,'cloud_product',$5,'cloud_owner','cloud','Remote opening stock',$6)`,
          [`stock-${randomUUID()}`, session.branchId, id, openingQty, id, nowIso],
        )
      }

      return appendCloudOwnerEvent(client, {
        entityType: 'product',
        entityId: id,
        operation: 'upsert',
        payload: {
          id,
          businessId,
          branchId: session.branchId,
          sku,
          barcode: body.barcode || null,
          name: body.name!.trim(),
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
    })

    realtime?.broadcastToShop(session.shopUuid, {
      type: 'product:updated',
      shopUuid: session.shopUuid,
      payload: { productId: id, cloudSeq: evt.cloudSeq },
    })
    return { ok: true, id, sku, cloudSeq: evt.cloudSeq }
  })

  // PUT /api/cloud/owner/products/:id — Update product prices / catalog remotely
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
    const session = await enforceCloudOwner(request, reply, centralPool, 'products.manage', body.shopUuid)
    if (!session) return

    const outcome = await tenantManager.withTenantTransaction(session.shopUuid, async client => {
      const { rows } = await client.query(
        `UPDATE products SET
          name = COALESCE($1, name),
          sale_price_paisa = COALESCE($2, sale_price_paisa),
          cost_price_paisa = COALESCE($3, cost_price_paisa),
          low_stock_milli = COALESCE($4, low_stock_milli),
          is_active = COALESCE($5, is_active),
          sync_version = sync_version + 1,
          updated_at = NOW()
         WHERE id = $6
         RETURNING *`,
        [
          body.name ?? null,
          body.salePricePaisa ?? null,
          body.costPricePaisa ?? null,
          body.minimumStockMilli ?? null,
          body.isActive ?? null,
          params.id,
        ],
      )
      if (!rows.length) {
        return null
      }
      const updated = rows[0]
      const evt = await appendCloudOwnerEvent(client, {
        entityType: 'product',
        entityId: params.id,
        operation: 'upsert',
        payload: {
          id: updated.id,
          businessId: updated.business_id,
          branchId: session.branchId,
          sku: updated.sku,
          barcode: updated.barcode,
          name: updated.name,
          category: updated.category,
          unit: updated.unit,
          costPricePaisa: Number(updated.cost_price_paisa),
          salePricePaisa: Number(updated.sale_price_paisa),
          minimumStockMilli: Number(updated.low_stock_milli),
          isActive: Boolean(updated.is_active),
          syncVersion: Number(updated.sync_version),
        },
      })
      return { updated, evt }
    })

    if (!outcome) {
      return reply.status(404).send({ error: 'NotFound', message: 'Product not found.', statusCode: 404 })
    }
    realtime?.broadcastToShop(session.shopUuid, {
      type: 'product:updated',
      shopUuid: session.shopUuid,
      payload: { productId: params.id, cloudSeq: outcome.evt.cloudSeq },
    })
    return { ok: true, product: outcome.updated, cloudSeq: outcome.evt.cloudSeq }
  })

  // POST /api/cloud/owner/inventory/adjust — Remote movement-ledger adjustment (delta-only!)
  app.post('/api/cloud/owner/inventory/adjust', async (request, reply) => {
    const body = (request.body as {
      shopUuid?: string
      productId?: string
      quantityDeltaMilli?: number
      reason?: string
    }) || {}
    const session = await enforceCloudOwner(request, reply, centralPool, 'stock.adjust', body.shopUuid)
    if (!session) return

    if (!body.productId || !Number.isSafeInteger(body.quantityDeltaMilli) || body.quantityDeltaMilli === 0) {
      return reply.status(400).send({ error: 'BadRequest', message: 'productId and non-zero quantityDeltaMilli required.', statusCode: 400 })
    }

    const movementId = `stock-${randomUUID()}`
    const nowIso = new Date().toISOString()

    const { nextQty, evt } = await tenantManager.withTenantTransaction(session.shopUuid, async client => {
      const slRes = await client.query<{ quantity_milli: string }>(
        'SELECT quantity_milli FROM stock_levels WHERE branch_id = $1 AND product_id = $2 FOR UPDATE',
        [session.branchId, body.productId],
      )
      const currentQty = Number(slRes.rows[0]?.quantity_milli ?? 0)
      const computedNext = Math.max(0, currentQty + body.quantityDeltaMilli!)
      const mvType = body.quantityDeltaMilli! > 0 ? 'adjustment_increase' : 'adjustment_decrease'

      await client.query(
        `INSERT INTO stock_movements (id, branch_id, product_id, movement_type, quantity_delta_milli, reference_type, reference_id, origin_source, counter_id, note, occurred_at)
         VALUES ($1,$2,$3,$4,$5,'cloud_adjustment',$6,'cloud_owner','cloud',$7,$8)`,
        [movementId, session.branchId, body.productId, mvType, body.quantityDeltaMilli, movementId, body.reason || 'Remote owner stock adjustment', nowIso],
      )
      await client.query(
        `INSERT INTO stock_levels (branch_id, product_id, quantity_milli, sync_version, updated_at)
         VALUES ($1,$2,$3,1,$4)
         ON CONFLICT (branch_id, product_id) DO UPDATE SET
           quantity_milli = $3, sync_version = stock_levels.sync_version + 1, updated_at = $4`,
        [session.branchId, body.productId, computedNext, nowIso],
      )

      const appended = await appendCloudOwnerEvent(client, {
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
      return { nextQty: computedNext, evt: appended }
    })

    realtime?.broadcastToShop(session.shopUuid, {
      type: 'inventory:changed',
      shopUuid: session.shopUuid,
      payload: { productId: body.productId, quantityMilli: nextQty, cloudSeq: evt.cloudSeq },
    })
    return { ok: true, movementId, balanceAfterMilli: nextQty, cloudSeq: evt.cloudSeq }
  })

  // GET /api/cloud/owner/customers & /suppliers & /expenses & /staff & /counters & /conflicts
  app.get('/api/cloud/owner/customers', async (request, reply) => {
    const q = request.query as { shopUuid?: string }
    const session = await enforceCloudOwner(request, reply, centralPool, 'customers.read', q.shopUuid)
    if (!session) return
    const { rows } = await tenantManager.queryTenant(
      session.shopUuid,
      `SELECT c.*, COALESCE((SELECT SUM(debit_paisa - credit_paisa) FROM customer_ledger cl WHERE cl.customer_id = c.id), 0) AS balance_paisa
       FROM customers c WHERE c.is_walk_in = FALSE ORDER BY c.name ASC`,
    )
    return { customers: rows.map(r => ({ ...r, balance_paisa: Number(r.balance_paisa) })) }
  })

  app.get('/api/cloud/owner/suppliers', async (request, reply) => {
    const q = request.query as { shopUuid?: string }
    const session = await enforceCloudOwner(request, reply, centralPool, 'retail.read', q.shopUuid)
    if (!session) return
    const { rows } = await tenantManager.queryTenant(
      session.shopUuid,
      `SELECT s.*, COALESCE((SELECT SUM(debit_paisa - credit_paisa) FROM supplier_ledger sl WHERE sl.supplier_id = s.id), 0) AS balance_paisa
       FROM suppliers s ORDER BY s.name ASC`,
    )
    return { suppliers: rows.map(r => ({ ...r, balance_paisa: Number(r.balance_paisa) })) }
  })

  app.get('/api/cloud/owner/expenses', async (request, reply) => {
    const q = request.query as { shopUuid?: string }
    const session = await enforceCloudOwner(request, reply, centralPool, 'expenses.read', q.shopUuid)
    if (!session) return
    const { rows } = await tenantManager.queryTenant(session.shopUuid, 'SELECT * FROM expenses ORDER BY occurred_at DESC LIMIT 200')
    return { expenses: rows.map(r => ({ ...r, amount_paisa: Number(r.amount_paisa) })) }
  })

  app.get('/api/cloud/owner/counters', async (request, reply) => {
    const q = request.query as { shopUuid?: string }
    const session = await enforceCloudOwner(request, reply, centralPool, 'users.manage', q.shopUuid)
    if (!session) return
    const { rows } = await tenantManager.queryTenant(session.shopUuid, 'SELECT * FROM counters ORDER BY counter_number ASC')
    return { counters: rows }
  })

  app.post('/api/cloud/owner/counters/:id/revoke', async (request, reply) => {
    const params = request.params as { id: string }
    const body = (request.body as { shopUuid?: string }) || {}
    const session = await enforceCloudOwner(request, reply, centralPool, 'users.manage', body.shopUuid)
    if (!session) return

    const outcome = await tenantManager.withTenantTransaction(session.shopUuid, async client => {
      const res = await client.query(
        `UPDATE counters SET status = 'revoked', revoked_at = NOW() WHERE id = $1 AND is_primary = FALSE RETURNING *`,
        [params.id],
      )
      if (!res.rowCount) {
        return null
      }
      await centralPool.query(
        `UPDATE vtx_central.counter_devices SET status = 'revoked', revoked_at = NOW() WHERE shop_uuid = $1 AND id = $2`,
        [session.shopUuid, params.id],
      )
      const evt = await appendCloudOwnerEvent(client, {
        entityType: 'counter',
        entityId: params.id,
        operation: 'revoke',
        payload: { id: params.id, status: 'revoked' },
      })
      return { counter: res.rows[0], cloudSeq: evt.cloudSeq }
    })

    if (!outcome) {
      return reply.status(400).send({ error: 'CannotRevoke', message: 'Counter not found or is primary Counter 1.', statusCode: 400 })
    }
    return { ok: true, counter: outcome.counter, cloudSeq: outcome.cloudSeq }
  })

  app.get('/api/cloud/owner/conflicts', async (request, reply) => {
    const q = request.query as { shopUuid?: string }
    const session = await enforceCloudOwner(request, reply, centralPool, 'settings.manage', q.shopUuid)
    if (!session) return
    const { rows } = await tenantManager.queryTenant(session.shopUuid, 'SELECT * FROM sync_conflicts ORDER BY resolved_at DESC LIMIT 100')
    return { conflicts: rows }
  })

  // Main PC physical hardware actions unavailable remotely
  const hardwareRequired = async (request: any, reply: any) => {
    const body = (request.body as { shopUuid?: string }) || {}
    const session = await enforceCloudOwner(request, reply, centralPool, 'pos.sell', body.shopUuid)
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
