import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { Pool, PoolClient } from 'pg'
import type { CloudEnvConfig } from '../config/env.mjs'
import type { TenantDatabaseManager } from '../db/tenant-manager.mjs'
import { sha256Hex, verifyNodeHmac } from './auth.mjs'
import type { CloudRealtimeBroker } from '../realtime.mjs'

export interface SyncPushEvent {
  seq: number
  eventId: string
  entityType: string
  entityId: string
  operation: string
  counterId: string
  syncEpoch: number
  payload: Record<string, unknown>
  payloadHash: string
  createdAt: string
}

async function applyStockMovementDelta(
  client: PoolClient,
  params: {
    movementId: string
    branchId: string
    productId: string
    movementType: string
    quantityDeltaMilli: number
    referenceType: string
    referenceId: string
    originSource: string
    counterId: string
    note: string
    occurredAt: string
    localEventId?: string
  },
): Promise<{ conflictLogged: boolean }> {
  const inserted = await client.query(
    `INSERT INTO stock_movements (
      id, branch_id, product_id, movement_type, quantity_delta_milli,
      reference_type, reference_id, origin_source, counter_id, note, occurred_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    ON CONFLICT (id) DO NOTHING RETURNING id`,
    [
      params.movementId,
      params.branchId,
      params.productId,
      params.movementType,
      params.quantityDeltaMilli,
      params.referenceType,
      params.referenceId,
      params.originSource,
      params.counterId || 'counter-1',
      params.note || '',
      params.occurredAt,
    ],
  )
  if (inserted.rowCount === 0) {
    return { conflictLogged: false }
  }

  await client.query(
    `INSERT INTO stock_levels (branch_id, product_id, quantity_milli, sync_version, updated_at)
     VALUES ($1, $2, 0, 1, $3)
     ON CONFLICT (branch_id, product_id) DO NOTHING`,
    [params.branchId, params.productId, params.occurredAt],
  )

  const currentRes = await client.query<{ quantity_milli: string }>(
    'SELECT quantity_milli FROM stock_levels WHERE branch_id = $1 AND product_id = $2 FOR UPDATE',
    [params.branchId, params.productId],
  )
  const currentQty = Number(currentRes.rows[0]?.quantity_milli ?? 0)
  const rawNext = currentQty + Number(params.quantityDeltaMilli)
  let conflictLogged = false
  let clampedNext = rawNext

  if (rawNext < 0) {
    clampedNext = 0
    conflictLogged = true
    const offsetDelta = Math.abs(rawNext)
    await client.query(
      `INSERT INTO stock_movements (
        id, branch_id, product_id, movement_type, quantity_delta_milli,
        reference_type, reference_id, origin_source, counter_id, note, occurred_at
      ) VALUES ($1,$2,$3,'reconciliation',$4,'conflict_clamp',$5,'cloud_reconcile',$6,$7,$8)`,
      [
        `reconcile-${randomUUID()}`,
        params.branchId,
        params.productId,
        offsetDelta,
        params.referenceId,
        params.counterId || 'counter-1',
        `Clamped negative net stock (${rawNext} -> 0) after ${params.originSource} movement`,
        params.occurredAt,
      ],
    )
    await client.query(
      `INSERT INTO sync_conflicts (
        id, entity_type, entity_id, local_event_id, conflict_type,
        local_summary, cloud_summary, resolution
      ) VALUES ($1,'stock_level',$2,$3,'negative_stock_clamp',$4,$5,'clamped_to_zero_with_reconciliation_movement')`,
      [
        `conf-${randomUUID()}`,
        params.productId,
        params.localEventId || null,
        `delta=${params.quantityDeltaMilli} (${params.movementType})`,
        `prior_qty=${currentQty}; clamped_balance=0`,
      ],
    )
  }

  await client.query(
    `UPDATE stock_levels
     SET quantity_milli = $1, sync_version = sync_version + 1, updated_at = $2
     WHERE branch_id = $3 AND product_id = $4`,
    [clampedNext, params.occurredAt, params.branchId, params.productId],
  )

  return { conflictLogged }
}

export function registerCloudSyncRoutes(
  app: FastifyInstance,
  config: CloudEnvConfig,
  centralPool: Pool,
  tenantManager: TenantDatabaseManager,
  realtime?: CloudRealtimeBroker,
): void {
  // POST /api/cloud/sync/register-node
  app.post('/api/cloud/sync/register-node', async (request, reply) => {
    const verified = await verifyNodeHmac(request, reply, config, centralPool, true)
    if (!verified) return

    const body = (request.body as {
      businessId?: string
      businessName?: string
      branchId?: string
      branchName?: string
      city?: string
      appVersion?: string
      syncEpoch?: number
    }) || {}

    const businessName = (body.businessName || 'Vertexia Shop').trim().slice(0, 120)
    const branchId = (body.branchId || 'branch-main').trim().slice(0, 100)
    const branchName = (body.branchName || businessName).trim().slice(0, 120)
    const city = (body.city || 'Main City').trim().slice(0, 80)
    const localBusinessId = (body.businessId || 'business-noor-mart').trim().slice(0, 100)

    await centralPool.query(
      `INSERT INTO vtx_central.businesses (shop_uuid, local_business_id, name, branch_name, city, status)
       VALUES ($1, $2, $3, $4, $5, 'active')
       ON CONFLICT (shop_uuid) DO UPDATE SET
         name = EXCLUDED.name,
         branch_name = EXCLUDED.branch_name,
         city = EXCLUDED.city,
         updated_at = NOW()`,
      [verified.shopUuid, localBusinessId, businessName, branchName, city],
    )

    await centralPool.query(
      `INSERT INTO vtx_central.installations (node_id, shop_uuid, hmac_secret_hash, sync_epoch, app_version, last_ip, last_sync_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), 'active')
       ON CONFLICT (node_id) DO UPDATE SET
         sync_epoch = GREATEST(vtx_central.installations.sync_epoch, EXCLUDED.sync_epoch),
         app_version = COALESCE(EXCLUDED.app_version, vtx_central.installations.app_version),
         last_ip = EXCLUDED.last_ip,
         last_sync_at = NOW(),
         status = 'active'`,
      [
        verified.nodeId,
        verified.shopUuid,
        sha256Hex(config.nodeHmacSecret),
        Number(body.syncEpoch ?? 1),
        body.appVersion?.slice(0, 32) || null,
        request.ip?.slice(0, 64) || null,
      ],
    )

    const schemaName = await tenantManager.ensureTenantSchema(verified.shopUuid)

    await tenantManager.withTenantTransaction(verified.shopUuid, async client => {
      await client.query(
        `INSERT INTO branches (id, business_id, name, code, city, is_active, created_at)
         VALUES ($1, $2, $3, 'MAIN', $4, TRUE, NOW())
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, city = EXCLUDED.city, is_active = TRUE`,
        [branchId, localBusinessId, branchName, city],
      )
      await client.query(
        `INSERT INTO counters (id, business_id, branch_id, counter_number, name, status, is_primary, created_at)
         VALUES ('counter-1', $1, $2, 1, 'Counter 1 (Main PC)', 'active', TRUE, NOW())
         ON CONFLICT (id) DO NOTHING`,
        [localBusinessId, branchId],
      )
      await client.query(
        `INSERT INTO shop_meta (key, value) VALUES ('shop_uuid', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [verified.shopUuid],
      )
    })

    return { ok: true, shopUuid: verified.shopUuid, tenantDbName: schemaName, tenantSchema: schemaName }
  })

  // POST /api/cloud/sync/credentials — Sync central auth credential hashes safely (never in tenant event log)
  app.post('/api/cloud/sync/credentials', async (request, reply) => {
    const verified = await verifyNodeHmac(request, reply, config, centralPool, false)
    if (!verified) return
    const body = request.body as {
      users?: Array<{
        userId: string
        branchId: string
        username: string
        name: string
        role: string
        passwordHash: string
        credentialVersion: number
        isActive: boolean
        mustChangePassword?: boolean
      }>
    } | undefined

    if (!Array.isArray(body?.users)) {
      return reply.status(400).send({ error: 'BadRequest', message: 'users array required.', statusCode: 400 })
    }

    for (const u of body.users) {
      if (!u.userId || !u.username || !u.passwordHash) continue
      await centralPool.query(
        `INSERT INTO vtx_central.central_users (
          id, shop_uuid, branch_id, username, name, role, password_hash,
          credential_version, is_active, must_change_password, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
        ON CONFLICT (shop_uuid, id) DO UPDATE SET
          branch_id = EXCLUDED.branch_id,
          username = EXCLUDED.username,
          name = EXCLUDED.name,
          role = EXCLUDED.role,
          password_hash = CASE
            WHEN EXCLUDED.credential_version >= vtx_central.central_users.credential_version
            THEN EXCLUDED.password_hash
            ELSE vtx_central.central_users.password_hash
          END,
          credential_version = GREATEST(vtx_central.central_users.credential_version, EXCLUDED.credential_version),
          is_active = EXCLUDED.is_active,
          must_change_password = CASE
            WHEN EXCLUDED.credential_version >= vtx_central.central_users.credential_version
            THEN EXCLUDED.must_change_password
            ELSE vtx_central.central_users.must_change_password
          END,
          updated_at = NOW()`,
        [
          u.userId,
          verified.shopUuid,
          u.branchId,
          u.username.toLowerCase(),
          u.name,
          u.role,
          u.passwordHash,
          Number(u.credentialVersion || 1),
          Boolean(u.isActive),
          Boolean(u.mustChangePassword),
        ],
      )
    }

    return { ok: true, syncedCount: body.users.length }
  })

  // POST /api/cloud/sync/push — Transactional, idempotent batch push from Main PC outbox
  app.post('/api/cloud/sync/push', async (request, reply) => {
    const verified = await verifyNodeHmac(request, reply, config, centralPool, false)
    if (!verified) return

    const body = (request.body as { events?: SyncPushEvent[] }) || {}
    if (!Array.isArray(body.events)) {
      return reply.status(400).send({ error: 'BadRequest', message: 'events array is required.', statusCode: 400 })
    }

    const ackedEventIds: string[] = []
    let conflictsCount = 0

    await tenantManager.withTenantTransaction(verified.shopUuid, async client => {
      for (const evt of body.events!) {
        if (!evt?.eventId || !evt?.entityType || !evt?.entityId) continue

        const ins = await client.query(
          `INSERT INTO processed_sync_events (event_id, counter_id, entity_type, entity_id, sync_epoch, payload_hash)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
          [evt.eventId, evt.counterId || 'counter-1', evt.entityType, evt.entityId, Number(evt.syncEpoch || 1), evt.payloadHash || ''],
        )
        if (ins.rowCount === 0) {
          // Already committed earlier -> safely ACK without re-applying!
          ackedEventIds.push(evt.eventId)
          continue
        }

        const p = evt.payload || {}
        const occurredAt = String(p.occurredAt || p.completedAt || p.updatedAt || p.createdAt || evt.createdAt || new Date().toISOString())

        if (evt.entityType === 'product') {
          if (evt.operation === 'delete') {
            await client.query('UPDATE products SET is_active = FALSE, updated_at = $2 WHERE id = $1', [evt.entityId, occurredAt])
          } else {
            await client.query(
              `INSERT INTO products (
                id, business_id, sku, barcode, name, category, unit,
                cost_price_paisa, sale_price_paisa, low_stock_milli, is_active, sync_version, created_at, updated_at
              ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
              ON CONFLICT (id) DO UPDATE SET
                sku = EXCLUDED.sku,
                barcode = EXCLUDED.barcode,
                name = EXCLUDED.name,
                category = EXCLUDED.category,
                unit = EXCLUDED.unit,
                cost_price_paisa = EXCLUDED.cost_price_paisa,
                sale_price_paisa = EXCLUDED.sale_price_paisa,
                low_stock_milli = EXCLUDED.low_stock_milli,
                is_active = EXCLUDED.is_active,
                sync_version = GREATEST(products.sync_version, EXCLUDED.sync_version),
                updated_at = EXCLUDED.updated_at`,
              [
                evt.entityId,
                String(p.businessId || 'business-noor-mart'),
                String(p.sku || evt.entityId),
                p.barcode ? String(p.barcode) : null,
                String(p.name || 'Product'),
                String(p.category || 'General'),
                String(p.unit || 'Piece'),
                Number(p.costPricePaisa ?? 0),
                Number(p.salePricePaisa ?? 0),
                Number(p.minimumStockMilli ?? 0),
                p.isActive !== false,
                Number(p.syncVersion ?? 1),
                String(p.createdAt || occurredAt),
                occurredAt,
              ],
            )
            if (Number(p.openingStockMilli ?? 0) > 0 && p.openingMovementId) {
              const mv = await applyStockMovementDelta(client, {
                movementId: String(p.openingMovementId),
                branchId: String(p.branchId || 'branch-main'),
                productId: evt.entityId,
                movementType: 'opening_stock',
                quantityDeltaMilli: Number(p.openingStockMilli),
                referenceType: 'product',
                referenceId: evt.entityId,
                originSource: 'local',
                counterId: evt.counterId || 'counter-1',
                note: 'Opening stock',
                occurredAt,
                localEventId: evt.eventId,
              })
              if (mv.conflictLogged) conflictsCount += 1
            } else if (p.branchId) {
              await client.query(
                `INSERT INTO stock_levels (branch_id, product_id, quantity_milli, sync_version, updated_at)
                 VALUES ($1, $2, 0, 1, $3) ON CONFLICT DO NOTHING`,
                [String(p.branchId), evt.entityId, occurredAt],
              )
            }
          }
        } else if (evt.entityType === 'stock_movement') {
          const mv = await applyStockMovementDelta(client, {
            movementId: String(p.id || evt.entityId),
            branchId: String(p.branchId || 'branch-main'),
            productId: String(p.productId),
            movementType: String(p.movementType || 'adjustment'),
            quantityDeltaMilli: Number(p.quantityDeltaMilli ?? 0),
            referenceType: String(p.referenceType || 'stock_adjustment'),
            referenceId: String(p.referenceId || evt.entityId),
            originSource: String(p.originSource || 'local'),
            counterId: evt.counterId || 'counter-1',
            note: String(p.note || ''),
            occurredAt,
            localEventId: evt.eventId,
          })
          if (mv.conflictLogged) conflictsCount += 1
        } else if (evt.entityType === 'sale') {
          await client.query(
            `INSERT INTO sales (
              id, branch_id, counter_id, invoice_number, customer_id, cashier_id, business_date,
              subtotal_paisa, discount_paisa, tax_paisa, total_paisa, cost_paisa, paid_paisa, change_paisa, due_paisa, status, completed_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'completed',$16)
            ON CONFLICT (id) DO NOTHING`,
            [
              evt.entityId,
              String(p.branchId || 'branch-main'),
              String(p.counterId || evt.counterId || 'counter-1'),
              String(p.invoiceNumber),
              String(p.customerId || 'customer-walk-in'),
              String(p.cashierId || 'user-riyaz'),
              String(p.businessDate || occurredAt.slice(0, 10)),
              Number(p.subtotalPaisa ?? 0),
              Number(p.discountPaisa ?? 0),
              Number(p.taxPaisa ?? 0),
              Number(p.totalPaisa ?? 0),
              Number(p.costPaisa ?? 0),
              Number(p.paidPaisa ?? 0),
              Number(p.changePaisa ?? 0),
              Number(p.duePaisa ?? 0),
              occurredAt,
            ],
          )
          const items = Array.isArray(p.items) ? (p.items as Array<Record<string, unknown>>) : []
          for (const item of items) {
            await client.query(
              `INSERT INTO sale_items (
                id, sale_id, product_id, product_name_snapshot, sku_snapshot, unit_snapshot,
                quantity_milli, unit_price_paisa, cost_price_paisa, tax_rate_bps, line_total_paisa
              ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$10) ON CONFLICT (id) DO NOTHING`,
              [
                String(item.id),
                evt.entityId,
                String(item.productId),
                String(item.productName || ''),
                String(item.sku || ''),
                String(item.unit || 'Piece'),
                Number(item.quantityMilli ?? 0),
                Number(item.unitPricePaisa ?? 0),
                Number(item.unitCostPaisa ?? 0),
                Number(item.lineTotalPaisa ?? 0),
              ],
            )
            if (item.movementId) {
              const mv = await applyStockMovementDelta(client, {
                movementId: String(item.movementId),
                branchId: String(p.branchId || 'branch-main'),
                productId: String(item.productId),
                movementType: 'sale',
                quantityDeltaMilli: -Number(item.quantityMilli ?? 0),
                referenceType: 'sale',
                referenceId: evt.entityId,
                originSource: 'local',
                counterId: String(p.counterId || evt.counterId || 'counter-1'),
                note: String(p.invoiceNumber || ''),
                occurredAt,
                localEventId: evt.eventId,
              })
              if (mv.conflictLogged) conflictsCount += 1
            }
          }
          if (p.paymentId) {
            await client.query(
              `INSERT INTO sale_payments (id, sale_id, method, amount_paisa, reference, occurred_at)
               VALUES ($1,$2,$3,$4,'',$5) ON CONFLICT (id) DO NOTHING`,
              [String(p.paymentId), evt.entityId, String(p.paymentMethod || 'Cash'), Number(p.paidPaisa ?? 0), occurredAt],
            )
          }
          if (Number(p.duePaisa ?? 0) > 0) {
            await client.query(
              `INSERT INTO customer_ledger (id, branch_id, customer_id, entry_type, debit_paisa, credit_paisa, reference_id, occurred_at)
               VALUES ($1,$2,$3,'sale',$4,0,$5,$6) ON CONFLICT (id) DO NOTHING`,
              [`cl-${evt.entityId}`, String(p.branchId || 'branch-main'), String(p.customerId), Number(p.duePaisa), evt.entityId, occurredAt],
            )
          }
        } else if (evt.entityType === 'sale_return') {
          await client.query(
            `INSERT INTO sale_returns (
              id, branch_id, counter_id, sale_id, return_number, refund_method,
              subtotal_paisa, tax_paisa, total_paisa, cost_paisa, note, created_by, occurred_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (id) DO NOTHING`,
            [
              evt.entityId,
              String(p.branchId || 'branch-main'),
              String(p.counterId || evt.counterId || 'counter-1'),
              String(p.saleId),
              String(p.returnNumber),
              String(p.refundMethod || 'Cash'),
              Number(p.subtotalPaisa ?? 0),
              Number(p.taxPaisa ?? 0),
              Number(p.totalPaisa ?? 0),
              Number(p.costPaisa ?? 0),
              String(p.note || ''),
              String(p.createdBy || 'user-riyaz'),
              occurredAt,
            ],
          )
          if (p.saleFullyReturned) {
            await client.query("UPDATE sales SET status = 'returned' WHERE id = $1", [String(p.saleId)])
          }
          if (String(p.refundMethod) === 'Udhaar' && p.customerId) {
            await client.query(
              `INSERT INTO customer_ledger (id, branch_id, customer_id, entry_type, debit_paisa, credit_paisa, reference_id, occurred_at)
               VALUES ($1,$2,$3,'sale_return',0,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
              [`cl-${evt.entityId}`, String(p.branchId || 'branch-main'), String(p.customerId), Number(p.totalPaisa ?? 0), evt.entityId, occurredAt],
            )
          }
          const mvs = Array.isArray(p.stockMovements) ? (p.stockMovements as Array<Record<string, unknown>>) : []
          for (const m of mvs) {
            const mv = await applyStockMovementDelta(client, {
              movementId: String(m.movementId),
              branchId: String(p.branchId || 'branch-main'),
              productId: String(m.productId),
              movementType: 'sale_return',
              quantityDeltaMilli: Number(m.quantityDeltaMilli ?? 0),
              referenceType: 'sale_return',
              referenceId: evt.entityId,
              originSource: 'local',
              counterId: String(p.counterId || evt.counterId || 'counter-1'),
              note: String(p.returnNumber || ''),
              occurredAt,
              localEventId: evt.eventId,
            })
            if (mv.conflictLogged) conflictsCount += 1
          }
        } else if (evt.entityType === 'manual_return') {
          await client.query(
            `INSERT INTO manual_returns (
              id, branch_id, counter_id, customer_id, business_date, return_number,
              refund_method, total_paisa, cost_paisa, note, created_by, occurred_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING`,
            [
              evt.entityId,
              String(p.branchId || 'branch-main'),
              String(p.counterId || evt.counterId || 'counter-1'),
              String(p.customerId),
              String(p.businessDate || occurredAt.slice(0, 10)),
              String(p.returnNumber),
              String(p.refundMethod || 'Cash'),
              Number(p.totalPaisa ?? 0),
              Number(p.costPaisa ?? 0),
              String(p.note || ''),
              String(p.createdBy || 'user-riyaz'),
              occurredAt,
            ],
          )
          if (String(p.refundMethod) === 'Udhaar' && p.customerId) {
            await client.query(
              `INSERT INTO customer_ledger (id, branch_id, customer_id, entry_type, debit_paisa, credit_paisa, reference_id, occurred_at)
               VALUES ($1,$2,$3,'sale_return',0,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
              [`cl-${evt.entityId}`, String(p.branchId || 'branch-main'), String(p.customerId), Number(p.totalPaisa ?? 0), evt.entityId, occurredAt],
            )
          }
          const mvs = Array.isArray(p.stockMovements) ? (p.stockMovements as Array<Record<string, unknown>>) : []
          for (const m of mvs) {
            const mv = await applyStockMovementDelta(client, {
              movementId: String(m.movementId),
              branchId: String(p.branchId || 'branch-main'),
              productId: String(m.productId),
              movementType: 'sale_return',
              quantityDeltaMilli: Number(m.quantityDeltaMilli ?? 0),
              referenceType: 'manual_return',
              referenceId: evt.entityId,
              originSource: 'local',
              counterId: String(p.counterId || evt.counterId || 'counter-1'),
              note: String(p.returnNumber || ''),
              occurredAt,
              localEventId: evt.eventId,
            })
            if (mv.conflictLogged) conflictsCount += 1
          }
        } else if (evt.entityType === 'customer') {
          await client.query(
            `INSERT INTO customers (id, business_id, name, phone, is_walk_in, is_active, sync_version, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT (id) DO UPDATE SET
               name = EXCLUDED.name,
               phone = EXCLUDED.phone,
               is_active = EXCLUDED.is_active,
               sync_version = GREATEST(customers.sync_version, EXCLUDED.sync_version),
               updated_at = EXCLUDED.updated_at`,
            [
              evt.entityId,
              String(p.businessId || 'business-noor-mart'),
              String(p.name || 'Customer'),
              String(p.phone || ''),
              Boolean(p.isWalkIn),
              p.isActive !== false,
              Number(p.syncVersion ?? 1),
              String(p.createdAt || occurredAt),
              occurredAt,
            ],
          )
          if (Number(p.openingBalancePaisa ?? 0) > 0 && p.branchId) {
            await client.query(
              `INSERT INTO customer_ledger (id, branch_id, customer_id, entry_type, debit_paisa, credit_paisa, reference_id, occurred_at)
               VALUES ($1,$2,$3,'opening_balance',$4,0,$5,$6) ON CONFLICT (id) DO NOTHING`,
              [`cl-ob-${evt.entityId}`, String(p.branchId), evt.entityId, Number(p.openingBalancePaisa), evt.entityId, occurredAt],
            )
          }
        } else if (evt.entityType === 'customer_receipt') {
          await client.query(
            `INSERT INTO customer_receipts (id, branch_id, customer_id, receipt_number, business_date, method, amount_paisa, note, created_by, occurred_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`,
            [
              evt.entityId,
              String(p.branchId || 'branch-main'),
              String(p.customerId),
              String(p.receiptNumber),
              String(p.businessDate || occurredAt.slice(0, 10)),
              String(p.method || 'Cash'),
              Number(p.amountPaisa ?? 0),
              String(p.note || ''),
              String(p.createdBy || 'user-riyaz'),
              occurredAt,
            ],
          )
          await client.query(
            `INSERT INTO customer_ledger (id, branch_id, customer_id, entry_type, debit_paisa, credit_paisa, reference_id, occurred_at)
             VALUES ($1,$2,$3,'payment',0,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
            [`cl-rec-${evt.entityId}`, String(p.branchId || 'branch-main'), String(p.customerId), Number(p.amountPaisa ?? 0), evt.entityId, occurredAt],
          )
        } else if (evt.entityType === 'supplier') {
          if (evt.operation === 'delete' || evt.operation === 'deactivate') {
            await client.query('UPDATE suppliers SET is_active = FALSE, updated_at = $2 WHERE id = $1', [evt.entityId, occurredAt])
          } else {
            await client.query(
              `INSERT INTO suppliers (id, business_id, name, phone, is_active, sync_version, created_at, updated_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
               ON CONFLICT (id) DO UPDATE SET
                 name = EXCLUDED.name,
                 phone = EXCLUDED.phone,
                 is_active = EXCLUDED.is_active,
                 updated_at = EXCLUDED.updated_at`,
              [
                evt.entityId,
                String(p.businessId || 'business-noor-mart'),
                String(p.name || 'Supplier'),
                String(p.phone || ''),
                p.isActive !== false,
                Number(p.syncVersion ?? 1),
                String(p.createdAt || occurredAt),
                occurredAt,
              ],
            )
            if (Number(p.openingBalancePaisa ?? 0) > 0 && p.branchId) {
              await client.query(
                `INSERT INTO supplier_ledger (id, branch_id, supplier_id, entry_type, debit_paisa, credit_paisa, reference_id, occurred_at)
                 VALUES ($1,$2,$3,'opening_balance',$4,0,$5,$6) ON CONFLICT (id) DO NOTHING`,
                [`sl-ob-${evt.entityId}`, String(p.branchId), evt.entityId, Number(p.openingBalancePaisa), evt.entityId, occurredAt],
              )
            }
          }
        } else if (evt.entityType === 'purchase') {
          await client.query(
            `INSERT INTO purchases (id, branch_id, supplier_id, supplier_name_snapshot, purchase_number, business_date, total_paisa, paid_paisa, note, created_by, occurred_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO NOTHING`,
            [
              evt.entityId,
              String(p.branchId || 'branch-main'),
              String(p.supplierId),
              String(p.supplierName || ''),
              String(p.purchaseNumber),
              String(p.businessDate || occurredAt.slice(0, 10)),
              Number(p.totalPaisa ?? 0),
              Number(p.paidPaisa ?? 0),
              String(p.note || ''),
              String(p.createdBy || 'user-riyaz'),
              occurredAt,
            ],
          )
          await client.query(
            `INSERT INTO supplier_ledger (id, branch_id, supplier_id, entry_type, debit_paisa, credit_paisa, reference_id, occurred_at)
             VALUES ($1,$2,$3,'purchase',$4,0,$5,$6) ON CONFLICT (id) DO NOTHING`,
            [`sl-pur-${evt.entityId}`, String(p.branchId || 'branch-main'), String(p.supplierId), Number(p.totalPaisa ?? 0), evt.entityId, occurredAt],
          )
          const mvs = Array.isArray(p.stockMovements) ? (p.stockMovements as Array<Record<string, unknown>>) : []
          for (const m of mvs) {
            const mv = await applyStockMovementDelta(client, {
              movementId: String(m.id),
              branchId: String(p.branchId || 'branch-main'),
              productId: String(m.productId),
              movementType: 'purchase',
              quantityDeltaMilli: Number(m.quantityDeltaMilli ?? 0),
              referenceType: 'purchase',
              referenceId: evt.entityId,
              originSource: 'local',
              counterId: evt.counterId || 'counter-1',
              note: String(m.note || p.purchaseNumber || ''),
              occurredAt,
              localEventId: evt.eventId,
            })
            if (mv.conflictLogged) conflictsCount += 1
            if (m.unitCostPaisa !== undefined) {
              await client.query('UPDATE products SET cost_price_paisa = $1, updated_at = $2 WHERE id = $3', [
                Number(m.unitCostPaisa),
                occurredAt,
                String(m.productId),
              ])
            }
          }
          if (Number(p.paidPaisa ?? 0) > 0 && p.paymentId) {
            await client.query(
              `INSERT INTO supplier_payments (id, branch_id, supplier_id, payment_number, business_date, method, amount_paisa, note, created_by, occurred_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`,
              [
                String(p.paymentId),
                String(p.branchId || 'branch-main'),
                String(p.supplierId),
                String(p.purchaseNumber),
                String(p.businessDate || occurredAt.slice(0, 10)),
                String(p.paymentMethod || 'Cash'),
                Number(p.paidPaisa),
                String(p.note || ''),
                String(p.createdBy || 'user-riyaz'),
                occurredAt,
              ],
            )
            await client.query(
              `INSERT INTO supplier_ledger (id, branch_id, supplier_id, entry_type, debit_paisa, credit_paisa, reference_id, occurred_at)
               VALUES ($1,$2,$3,'payment',0,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
              [`sl-pay-${String(p.paymentId)}`, String(p.branchId || 'branch-main'), String(p.supplierId), Number(p.paidPaisa), String(p.paymentId), occurredAt],
            )
          }
        } else if (evt.entityType === 'supplier_payment') {
          await client.query(
            `INSERT INTO supplier_payments (id, branch_id, supplier_id, payment_number, business_date, method, amount_paisa, note, created_by, occurred_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`,
            [
              evt.entityId,
              String(p.branchId || 'branch-main'),
              String(p.supplierId),
              String(p.paymentNumber || evt.entityId),
              String(p.businessDate || occurredAt.slice(0, 10)),
              String(p.method || 'Cash'),
              Number(p.amountPaisa ?? 0),
              String(p.note || ''),
              String(p.createdBy || 'user-riyaz'),
              occurredAt,
            ],
          )
          await client.query(
            `INSERT INTO supplier_ledger (id, branch_id, supplier_id, entry_type, debit_paisa, credit_paisa, reference_id, occurred_at)
             VALUES ($1,$2,$3,'payment',0,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
            [`sl-sp-${evt.entityId}`, String(p.branchId || 'branch-main'), String(p.supplierId), Number(p.amountPaisa ?? 0), evt.entityId, occurredAt],
          )
        } else if (evt.entityType === 'expense') {
          await client.query(
            `INSERT INTO expenses (id, branch_id, expense_number, business_date, category, description, method, amount_paisa, note, created_by, occurred_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO NOTHING`,
            [
              evt.entityId,
              String(p.branchId || 'branch-main'),
              String(p.expenseNumber || evt.entityId),
              String(p.businessDate || occurredAt.slice(0, 10)),
              String(p.category || 'General'),
              String(p.description || ''),
              String(p.method || 'Cash'),
              Number(p.amountPaisa ?? 0),
              String(p.note || ''),
              String(p.createdBy || 'user-riyaz'),
              occurredAt,
            ],
          )
        } else if (evt.entityType === 'cash_shift') {
          await client.query(
            `INSERT INTO cash_shifts (id, branch_id, counter_id, cashier_id, status, opening_cash_paisa, expected_cash_paisa, counted_cash_paisa, variance_paisa, note, opened_at, closed_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
             ON CONFLICT (id) DO UPDATE SET
               status = EXCLUDED.status,
               expected_cash_paisa = COALESCE(EXCLUDED.expected_cash_paisa, cash_shifts.expected_cash_paisa),
               counted_cash_paisa = COALESCE(EXCLUDED.counted_cash_paisa, cash_shifts.counted_cash_paisa),
               variance_paisa = COALESCE(EXCLUDED.variance_paisa, cash_shifts.variance_paisa),
               note = COALESCE(EXCLUDED.note, cash_shifts.note),
               closed_at = COALESCE(EXCLUDED.closed_at, cash_shifts.closed_at)`,
            [
              evt.entityId,
              String(p.branchId || 'branch-main'),
              String(p.counterId || evt.counterId || 'counter-1'),
              String(p.cashierId || 'user-riyaz'),
              String(p.status || 'open'),
              Number(p.openingCashPaisa ?? 0),
              p.expectedCashPaisa !== undefined ? Number(p.expectedCashPaisa) : null,
              p.countedCashPaisa !== undefined && p.countedCashPaisa !== null ? Number(p.countedCashPaisa) : null,
              p.variancePaisa !== undefined && p.variancePaisa !== null ? Number(p.variancePaisa) : null,
              p.closingNote ? String(p.closingNote) : p.note ? String(p.note) : null,
              String(p.openedAt || occurredAt),
              p.closedAt ? String(p.closedAt) : null,
            ],
          )
        } else if (evt.entityType === 'cash_movement') {
          await client.query(
            `INSERT INTO cash_movements (id, shift_id, branch_id, movement_type, amount_paisa, reason, created_by, occurred_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
            [
              evt.entityId,
              String(p.shiftId),
              String(p.branchId || 'branch-main'),
              String(p.movementType || 'cash_in'),
              Number(p.amountPaisa ?? 0),
              String(p.reason || ''),
              String(p.createdBy || 'user-riyaz'),
              occurredAt,
            ],
          )
        } else if (evt.entityType === 'counter') {
          await client.query(
            `INSERT INTO counters (id, business_id, branch_id, counter_number, name, status, is_primary, app_version, last_ip, last_seen_at, created_at, revoked_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
             ON CONFLICT (id) DO UPDATE SET
               name = EXCLUDED.name,
               status = EXCLUDED.status,
               app_version = COALESCE(EXCLUDED.app_version, counters.app_version),
               last_ip = COALESCE(EXCLUDED.last_ip, counters.last_ip),
               last_seen_at = COALESCE(EXCLUDED.last_seen_at, counters.last_seen_at),
               revoked_at = EXCLUDED.revoked_at`,
            [
              evt.entityId,
              String(p.businessId || 'business-noor-mart'),
              String(p.branchId || 'branch-main'),
              Number(p.counterNumber ?? 1),
              String(p.name || 'Counter'),
              String(p.status || 'active'),
              Boolean(p.isPrimary),
              p.appVersion ? String(p.appVersion) : null,
              p.lastIp ? String(p.lastIp) : null,
              p.lastSeenAt ? String(p.lastSeenAt) : null,
              String(p.createdAt || occurredAt),
              p.revokedAt ? String(p.revokedAt) : null,
            ],
          )
          await centralPool.query(
            `INSERT INTO vtx_central.counter_devices (id, shop_uuid, counter_number, name, status, is_primary, last_ip, last_seen_at, revoked_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT (shop_uuid, id) DO UPDATE SET
               name = EXCLUDED.name,
               status = EXCLUDED.status,
               last_ip = EXCLUDED.last_ip,
               last_seen_at = EXCLUDED.last_seen_at,
               revoked_at = EXCLUDED.revoked_at`,
            [
              evt.entityId,
              verified.shopUuid,
              Number(p.counterNumber ?? 1),
              String(p.name || 'Counter'),
              String(p.status || 'active'),
              Boolean(p.isPrimary),
              p.lastIp ? String(p.lastIp) : null,
              p.lastSeenAt ? String(p.lastSeenAt) : null,
              p.revokedAt ? String(p.revokedAt) : null,
            ],
          )
        } else if (evt.entityType === 'user') {
          await client.query(
            `INSERT INTO users (id, business_id, name, username, role, is_active, allowed_tabs, sync_version, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             ON CONFLICT (id) DO UPDATE SET
               name = EXCLUDED.name,
               role = EXCLUDED.role,
               is_active = EXCLUDED.is_active,
               allowed_tabs = EXCLUDED.allowed_tabs,
               sync_version = GREATEST(users.sync_version, EXCLUDED.sync_version),
               updated_at = EXCLUDED.updated_at`,
            [
              evt.entityId,
              String(p.businessId || 'business-noor-mart'),
              String(p.name || 'Staff'),
              p.username ? String(p.username) : null,
              String(p.role || 'Cashier'),
              p.isActive !== false,
              p.allowedTabs ? JSON.stringify(p.allowedTabs) : null,
              Number(p.syncVersion ?? 1),
              String(p.createdAt || occurredAt),
              occurredAt,
            ],
          )
        } else if (evt.entityType === 'business_profile') {
          await centralPool.query(
            `UPDATE vtx_central.businesses SET name = COALESCE($1, name), branch_name = COALESCE($2, branch_name), city = COALESCE($3, city), updated_at = NOW() WHERE shop_uuid = $4`,
            [p.businessName ? String(p.businessName) : null, p.branchName ? String(p.branchName) : null, p.city ? String(p.city) : null, verified.shopUuid],
          )
        }

        ackedEventIds.push(evt.eventId)
      }
    })

    await centralPool.query('UPDATE vtx_central.installations SET last_sync_at = NOW() WHERE node_id = $1', [verified.nodeId])

    if (ackedEventIds.length > 0 && realtime) {
      realtime.broadcastToShop(verified.shopUuid, {
        type: 'cloud:sync_updated',
        shopUuid: verified.shopUuid,
        payload: { appliedCount: ackedEventIds.length, conflictsCount },
      })
    }

    return { ok: true, ackedEventIds, conflictsCount }
  })

  // GET /api/cloud/sync/pull — Cursor-based remote owner events awaiting Main PC reconciliation
  app.get('/api/cloud/sync/pull', async (request, reply) => {
    const verified = await verifyNodeHmac(request, reply, config, centralPool, false)
    if (!verified) return

    const q = request.query as { sinceCloudSeq?: string; limit?: string }
    const sinceSeq = Math.max(0, Number(q.sinceCloudSeq ?? 0) || 0)
    const limit = Math.max(1, Math.min(200, Number(q.limit ?? 100) || 100))

    const { rows } = await tenantManager.queryTenant<{
      cloud_seq: string
      event_id: string
      origin_source: string
      counter_id: string | null
      entity_type: string
      entity_id: string
      operation: string
      payload_json: Record<string, unknown>
      created_at: Date
    }>(
      verified.shopUuid,
      `SELECT cloud_seq, event_id, origin_source, counter_id, entity_type, entity_id, operation, payload_json, created_at
       FROM cloud_sync_events
       WHERE origin_source = 'cloud_owner' AND cloud_seq > $1
       ORDER BY cloud_seq ASC
       LIMIT $2`,
      [sinceSeq, limit],
    )

    return {
      events: rows.map(r => ({
        cloudSeq: Number(r.cloud_seq),
        eventId: r.event_id,
        originSource: r.origin_source,
        counterId: r.counter_id,
        entityType: r.entity_type,
        entityId: r.entity_id,
        operation: r.operation,
        payload: r.payload_json,
        createdAt: r.created_at.toISOString(),
      })),
    }
  })
}
