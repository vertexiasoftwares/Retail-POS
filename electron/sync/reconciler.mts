import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { appendSyncLog, getShopUuid, setSyncStateValue } from './outbox.mjs'
import { changeStockValue, openingStockValue, proportionalCost } from '../database/valuation.mjs'

export interface CloudPullEvent {
  cloudSeq: number
  eventId: string
  originSource: string
  counterId?: string | null
  entityType: string
  entityId: string
  operation: string
  payload: Record<string, unknown>
  createdAt: string
}

export interface ReconcileResult {
  appliedCount: number
  skippedCount: number
  conflictsCount: number
  lastPulledSeq: number
  updatedProductIds: string[]
  updatedUserIds: string[]
}

type SqlRow = Record<string, string | number | null>

function recordConflict(
  db: DatabaseSync,
  params: {
    entityType: string
    entityId: string
    cloudSeq: number
    conflictType: string
    localSummary: string
    cloudSummary: string
    resolution: string
    nowIso: string
  },
): void {
  db.prepare(
    `INSERT INTO sync_conflicts (
      id, entity_type, entity_id, cloud_seq, conflict_type,
      local_summary, cloud_summary, resolution, resolved_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    `conf-${randomUUID()}`,
    params.entityType,
    params.entityId,
    params.cloudSeq,
    params.conflictType,
    params.localSummary,
    params.cloudSummary,
    params.resolution,
    params.nowIso,
  )
}

export function reconcileCloudEvents(
  db: DatabaseSync,
  events: CloudPullEvent[],
  nowIso: string,
): ReconcileResult {
  if (!events.length) {
    return { appliedCount: 0, skippedCount: 0, conflictsCount: 0, lastPulledSeq: 0, updatedProductIds: [], updatedUserIds: [] }
  }

  let appliedCount = 0
  let skippedCount = 0
  let conflictsCount = 0
  let maxSeq = 0
  const updatedProductIds = new Set<string>()
  const updatedUserIds = new Set<string>()
  const localShopUuid = getShopUuid(db).toLowerCase()

  db.exec('BEGIN IMMEDIATE')
  try {
    for (const evt of events) {
      if (evt.cloudSeq > maxSeq) maxSeq = evt.cloudSeq

      const already = db
        .prepare('SELECT 1 FROM processed_cloud_events WHERE event_id = ?')
        .get(evt.eventId)
      if (already) {
        skippedCount += 1
        continue
      }

      const p = evt.payload || {}
      const branchId = String(p.branchId || 'branch-main')
      const businessId = String(p.businessId || (db.prepare('SELECT id FROM businesses LIMIT 1').get() as SqlRow).id)

      if (evt.entityType === 'product') {
        const pendingLocal = db
          .prepare("SELECT event_id FROM sync_outbox WHERE entity_type='product' AND entity_id=? AND status IN ('pending','in_flight') LIMIT 1")
          .get(evt.entityId) as SqlRow | undefined

        if (evt.operation === 'delete' || p.isActive === false) {
          db.prepare('UPDATE products SET is_active=?, updated_at=? WHERE id=? AND business_id=?').run(
            evt.operation === 'delete' ? 0 : p.isActive === false ? 0 : 1,
            nowIso,
            evt.entityId,
            businessId,
          )
          db.prepare("INSERT INTO entity_sync_state(entity_type,entity_id,sync_version,cloud_updated_at) VALUES ('product',?,?,?) ON CONFLICT(entity_type,entity_id) DO UPDATE SET cloud_updated_at=excluded.cloud_updated_at").run(evt.entityId, Number(p.syncVersion ?? 1), evt.createdAt)
        } else {
          const existing = db
            .prepare('SELECT id, selling_price_paisa, name FROM products WHERE id=? AND business_id=?')
            .get(evt.entityId, businessId) as SqlRow | undefined

          if (existing && pendingLocal) {
            conflictsCount += 1
            recordConflict(db, {
              entityType: 'product',
              entityId: evt.entityId,
              cloudSeq: evt.cloudSeq,
              conflictType: 'catalog_concurrent_edit',
              localSummary: `local pending edit on ${String(existing.name)} (price=${Number(existing.selling_price_paisa)})`,
              cloudSummary: `cloud edit (price=${Number(p.salePricePaisa ?? existing.selling_price_paisa)})`,
              resolution: 'applied_cloud_remote_owner_update',
              nowIso,
            })
          }

          if (existing) {
            db.prepare(
              `UPDATE products SET
                sku = COALESCE(?, sku),
                barcode = ?,
                name = COALESCE(?, name),
                category = COALESCE(?, category),
                unit = COALESCE(?, unit),
                purchase_price_paisa = COALESCE(?, purchase_price_paisa),
                selling_price_paisa = COALESCE(?, selling_price_paisa),
                minimum_stock_milli = COALESCE(?, minimum_stock_milli),
                is_active = COALESCE(?, is_active),
                updated_at = ?
               WHERE id = ? AND business_id = ?`,
            ).run(
              p.sku ? String(p.sku) : null,
              p.barcode !== undefined ? (p.barcode ? String(p.barcode) : null) : null,
              p.name ? String(p.name) : null,
              p.category ? String(p.category) : null,
              p.unit ? String(p.unit) : null,
              p.costPricePaisa !== undefined ? Number(p.costPricePaisa) : null,
              p.salePricePaisa !== undefined ? Number(p.salePricePaisa) : null,
              p.minimumStockMilli !== undefined ? Number(p.minimumStockMilli) : null,
              p.isActive !== undefined ? (p.isActive ? 1 : 0) : null,
              nowIso,
              evt.entityId,
              businessId,
            )
            db.prepare(
              `INSERT INTO entity_sync_state(entity_type,entity_id,sync_version,cloud_updated_at) VALUES ('product',?,?,?)
               ON CONFLICT(entity_type,entity_id) DO UPDATE SET sync_version=MAX(sync_version,excluded.sync_version), cloud_updated_at=excluded.cloud_updated_at`,
            ).run(evt.entityId, Number(p.syncVersion ?? 1), evt.createdAt)
          } else {
            const openingQty = Number(p.openingStockMilli ?? 0)
            const costPrice = Number(p.costPricePaisa ?? 0)
            db.prepare(
              `INSERT INTO products (
                id, business_id, sku, barcode, name, category, brand, unit, visual_kind,
                purchase_price_paisa, selling_price_paisa, minimum_stock_milli, is_active,
                created_at, updated_at
              ) VALUES (?,?,?,?,?,?,'Cloud',?,'box',?,?,?,?,?,?)`,
            ).run(
              evt.entityId,
              businessId,
              String(p.sku || `CLD-${evt.entityId.slice(0, 8)}`),
              p.barcode ? String(p.barcode) : null,
              String(p.name || 'Cloud Product'),
              String(p.category || 'General'),
              String(p.unit || 'Piece'),
              costPrice,
              Number(p.salePricePaisa ?? 100),
              Number(p.minimumStockMilli ?? 0),
              p.isActive === false ? 0 : 1,
              evt.createdAt,
              nowIso,
            )
            db.prepare(
              "INSERT OR REPLACE INTO entity_sync_state(entity_type,entity_id,sync_version,cloud_updated_at) VALUES ('product',?,?,?)",
            ).run(evt.entityId, Number(p.syncVersion ?? 1), evt.createdAt)
            db.prepare('INSERT OR IGNORE INTO stock_levels(branch_id, product_id, quantity_milli, updated_at) VALUES (?,?,?,?)').run(
              branchId,
              evt.entityId,
              openingQty,
              nowIso,
            )
            if (openingQty > 0) {
              const mvId = `stock-cld-${evt.eventId}`
              db.prepare(
                `INSERT OR IGNORE INTO stock_movements (
                  id, branch_id, product_id, movement_type, quantity_delta_milli, balance_after_milli,
                  reference_type, reference_id, reason, occurred_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
              ).run(mvId, branchId, evt.entityId, 'opening_stock', openingQty, openingQty, 'cloud_product', evt.entityId, 'Cloud opening stock', evt.createdAt)
              db.prepare("INSERT OR REPLACE INTO movement_origins(movement_id,origin_source,counter_id) VALUES (?,'cloud_owner','counter-1')").run(mvId)
            }
            openingStockValue(db, branchId, evt.entityId, openingQty, costPrice, nowIso)
          }
        }
        updatedProductIds.add(evt.entityId)
      } else if (evt.entityType === 'stock_movement') {
        // Movement-ledger delta reconciliation (NEVER blindly overwrite stock quantities!)
        const productId = String(p.productId || evt.entityId)
        const deltaMilli = Number(p.quantityDeltaMilli ?? 0)
        const movementId = String(p.id || `stock-${evt.eventId}`)
        const note = String(p.note || 'Remote cloud adjustment')
        const mvType = String(p.movementType || (deltaMilli >= 0 ? 'adjustment_increase' : 'adjustment_decrease'))

        db.prepare('INSERT OR IGNORE INTO stock_levels(branch_id, product_id, quantity_milli, updated_at) VALUES (?,?,0,?)').run(
          branchId,
          productId,
          nowIso,
        )
        const levelRow = db
          .prepare('SELECT quantity_milli FROM stock_levels WHERE branch_id=? AND product_id=?')
          .get(branchId, productId) as SqlRow
        const currentQty = Number(levelRow.quantity_milli)
        const rawNext = currentQty + deltaMilli
        let finalBalance = rawNext
        let clampedOffset = 0

        if (rawNext < 0) {
          // Local offline sales consumed stock before remote cloud reduction arrived:
          // preserve all offline sales, clamp inventory at 0, emit explicit reconciliation & audit conflict!
          finalBalance = 0
          clampedOffset = Math.abs(rawNext)
          conflictsCount += 1
          recordConflict(db, {
            entityType: 'stock_level',
            entityId: productId,
            cloudSeq: evt.cloudSeq,
            conflictType: 'negative_stock_clamp',
            localSummary: `local_qty=${currentQty}`,
            cloudSummary: `remote_delta=${deltaMilli} (raw_next=${rawNext})`,
            resolution: 'preserved_local_sales_clamped_stock_to_zero',
            nowIso,
          })
        }

        const appliedDelta = finalBalance - currentQty
        db.prepare(
          `INSERT OR IGNORE INTO stock_movements (
            id, branch_id, product_id, movement_type, quantity_delta_milli, balance_after_milli,
            reference_type, reference_id, reason, occurred_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        ).run(movementId, branchId, productId, mvType, deltaMilli, Math.max(0, rawNext), 'cloud_adjustment', evt.eventId, note, evt.createdAt)
        db.prepare("INSERT OR REPLACE INTO movement_origins(movement_id,origin_source,counter_id) VALUES (?,'cloud_owner','counter-1')").run(movementId)

        if (clampedOffset > 0) {
          const recId = `stock-reconcile-${randomUUID()}`
          db.prepare(
            `INSERT INTO stock_movements (
              id, branch_id, product_id, movement_type, quantity_delta_milli, balance_after_milli,
              reference_type, reference_id, reason, occurred_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
          ).run(
            recId,
            branchId,
            productId,
            'reconciliation',
            clampedOffset,
            0,
            'conflict_clamp',
            evt.eventId,
            `Auto-clamped after remote decrease (${currentQty} + ${deltaMilli} = ${rawNext})`,
            nowIso,
          )
          db.prepare("INSERT OR REPLACE INTO movement_origins(movement_id,origin_source,counter_id) VALUES (?,'cloud_reconcile','counter-1')").run(recId)
        }

        db.prepare(
          'UPDATE stock_levels SET quantity_milli=?, updated_at=? WHERE branch_id=? AND product_id=?',
        ).run(finalBalance, nowIso, branchId, productId)
        db.prepare(
          "INSERT INTO entity_sync_state(entity_type,entity_id,sync_version,cloud_updated_at) VALUES ('stock_level',?,2,?) ON CONFLICT(entity_type,entity_id) DO UPDATE SET sync_version=sync_version+1, cloud_updated_at=excluded.cloud_updated_at",
        ).run(`${branchId}:${productId}`, evt.createdAt)

        // Keep stock valuation strictly invariant (empty stock => 0 value)
        const valRow = db
          .prepare('SELECT total_cost_paisa FROM stock_values WHERE branch_id=? AND product_id=?')
          .get(branchId, productId) as SqlRow | undefined
        const prodRow = db
          .prepare('SELECT purchase_price_paisa FROM products WHERE id=?')
          .get(productId) as SqlRow | undefined
        const currentValue = Number(valRow?.total_cost_paisa ?? 0)
        if (finalBalance === 0) {
          if (currentValue !== 0) {
            changeStockValue(db, branchId, productId, -currentValue, false, nowIso, movementId)
          }
        } else if (appliedDelta !== 0) {
          const unitCost = Number(prodRow?.purchase_price_paisa ?? 0)
          const costDelta =
            appliedDelta < 0 && currentQty > 0
              ? -proportionalCost(currentValue, Math.min(currentQty, Math.abs(appliedDelta)), currentQty)
              : proportionalCost(unitCost, appliedDelta)
          changeStockValue(db, branchId, productId, costDelta, true, nowIso, movementId)
        }
        updatedProductIds.add(productId)
      } else if (evt.entityType === 'customer') {
        if (evt.operation === 'delete' || evt.operation === 'deactivate') {
          db.prepare('UPDATE customers SET is_active=0 WHERE id=?').run(evt.entityId)
        } else {
          const existing = db.prepare('SELECT id FROM customers WHERE id=?').get(evt.entityId)
          if (existing) {
            db.prepare(
              'UPDATE customers SET name=COALESCE(?,name), phone=COALESCE(?,phone), is_active=COALESCE(?,is_active) WHERE id=?',
            ).run(
              p.name ? String(p.name) : null,
              p.phone !== undefined ? (p.phone ? String(p.phone) : null) : null,
              p.isActive !== undefined ? (p.isActive ? 1 : 0) : null,
              evt.entityId,
            )
          } else {
            db.prepare(
              'INSERT INTO customers(id, business_id, name, phone, is_walk_in, is_active, created_at) VALUES (?,?,?,?,0,?,?)',
            ).run(
              evt.entityId,
              businessId,
              String(p.name || 'Customer'),
              p.phone ? String(p.phone) : null,
              p.isActive === false ? 0 : 1,
              evt.createdAt,
            )
          }
        }
        db.prepare(
          "INSERT INTO entity_sync_state(entity_type,entity_id,sync_version,cloud_updated_at) VALUES ('customer',?,?,?) ON CONFLICT(entity_type,entity_id) DO UPDATE SET sync_version=MAX(sync_version,excluded.sync_version), cloud_updated_at=excluded.cloud_updated_at",
        ).run(evt.entityId, Number(p.syncVersion ?? 1), evt.createdAt)
      } else if (evt.entityType === 'supplier') {
        if (evt.operation === 'delete' || evt.operation === 'deactivate') {
          db.prepare('UPDATE suppliers SET is_active=0 WHERE id=?').run(evt.entityId)
        } else {
          const existing = db.prepare('SELECT id FROM suppliers WHERE id=?').get(evt.entityId)
          if (existing) {
            db.prepare(
              'UPDATE suppliers SET name=COALESCE(?,name), phone=COALESCE(?,phone), is_active=COALESCE(?,is_active) WHERE id=?',
            ).run(
              p.name ? String(p.name) : null,
              p.phone !== undefined ? (p.phone ? String(p.phone) : null) : null,
              p.isActive !== undefined ? (p.isActive ? 1 : 0) : null,
              evt.entityId,
            )
          } else {
            db.prepare(
              'INSERT INTO suppliers(id, business_id, name, phone, is_active, created_at) VALUES (?,?,?,?,?,?)',
            ).run(
              evt.entityId,
              businessId,
              String(p.name || 'Supplier'),
              p.phone ? String(p.phone) : null,
              p.isActive === false ? 0 : 1,
              evt.createdAt,
            )
          }
        }
        db.prepare(
          "INSERT INTO entity_sync_state(entity_type,entity_id,sync_version,cloud_updated_at) VALUES ('supplier',?,?,?) ON CONFLICT(entity_type,entity_id) DO UPDATE SET sync_version=MAX(sync_version,excluded.sync_version), cloud_updated_at=excluded.cloud_updated_at",
        ).run(evt.entityId, Number(p.syncVersion ?? 1), evt.createdAt)
      } else if (evt.entityType === 'counter' && evt.operation === 'revoke') {
        db.prepare("UPDATE counters SET status='revoked', device_token_hash=NULL, revoked_at=? WHERE id=? AND is_primary=0").run(
          nowIso,
          evt.entityId,
        )
        db.prepare('UPDATE auth_sessions SET revoked_at=? WHERE counter_id=? AND revoked_at IS NULL').run(
          nowIso,
          evt.entityId,
        )
      } else if (evt.entityType === 'user_credential' && evt.operation === 'password_change') {
        const targetUserId = String(p.userId || evt.entityId)
        const remoteShopUuid = typeof p.shopUuid === 'string' ? p.shopUuid.toLowerCase() : ''
        const nextHash = typeof p.passwordHash === 'string' ? p.passwordHash : ''
        const nextVersion = Number(p.credentialVersion ?? 0)
        const hashFormatValid = /^scrypt-v1\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(nextHash)

        if (!remoteShopUuid || remoteShopUuid !== localShopUuid) {
          conflictsCount += 1
          recordConflict(db, {
            entityType: 'user_credential',
            entityId: targetUserId,
            cloudSeq: evt.cloudSeq,
            conflictType: 'cross_shop_rejected',
            localSummary: `shop=${localShopUuid}`,
            cloudSummary: `shop=${remoteShopUuid || 'missing'}`,
            resolution: 'rejected_cross_shop_credential_event',
            nowIso,
          })
        } else if (!hashFormatValid || !Number.isSafeInteger(nextVersion) || nextVersion < 1) {
          conflictsCount += 1
          recordConflict(db, {
            entityType: 'user_credential',
            entityId: targetUserId,
            cloudSeq: evt.cloudSeq,
            conflictType: 'invalid_credential_payload',
            localSummary: 'expected valid scrypt-v1 hash and positive credential_version',
            cloudSummary: `credVer=${nextVersion}`,
            resolution: 'rejected_invalid_credential_payload',
            nowIso,
          })
        } else {
          const localCred = db
            .prepare('SELECT user_id, credential_version, updated_at FROM user_credentials WHERE user_id = ?')
            .get(targetUserId) as SqlRow | undefined
          if (!localCred) {
            conflictsCount += 1
            recordConflict(db, {
              entityType: 'user_credential',
              entityId: targetUserId,
              cloudSeq: evt.cloudSeq,
              conflictType: 'missing_local_user',
              localSummary: 'user_credentials row not found',
              cloudSummary: `credVer=${nextVersion}`,
              resolution: 'skipped_unknown_user',
              nowIso,
            })
          } else if (nextVersion <= Number(localCred.credential_version)) {
            conflictsCount += 1
            recordConflict(db, {
              entityType: 'user_credential',
              entityId: targetUserId,
              cloudSeq: evt.cloudSeq,
              conflictType: 'stale_credential_version',
              localSummary: `local_cred_ver=${localCred.credential_version}`,
              cloudSummary: `cloud_cred_ver=${nextVersion}`,
              resolution: 'kept_local_newer_credential',
              nowIso,
            })
          } else {
            const mustChange = p.mustChangePassword === true ? 1 : 0
            const updatedAt = typeof p.updatedAt === 'string' && p.updatedAt ? p.updatedAt : nowIso
            db.prepare(
              `UPDATE user_credentials
               SET password_hash = ?, credential_version = ?, must_change_password = ?, failed_attempts = 0, locked_until = NULL, updated_at = ?
               WHERE user_id = ?`,
            ).run(nextHash, nextVersion, mustChange, updatedAt, targetUserId)
            db.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(
              nowIso,
              targetUserId,
            )
            updatedUserIds.add(targetUserId)
          }
        }
      }

      db.prepare('INSERT INTO processed_cloud_events (event_id, cloud_seq, entity_type, processed_at) VALUES (?, ?, ?, ?)').run(
        evt.eventId,
        evt.cloudSeq,
        evt.entityType,
        nowIso,
      )
      appliedCount += 1
    }

    if (maxSeq > 0) {
      setSyncStateValue(db, 'last_pulled_seq', String(maxSeq), nowIso)
    }
    if (appliedCount > 0) {
      appendSyncLog(
        db,
        'reconcile',
        conflictsCount > 0 ? 'conflict' : 'ok',
        appliedCount,
        `Reconciled ${appliedCount} cloud event(s); conflicts=${conflictsCount}`,
        nowIso,
      )
    }
    db.exec('COMMIT')
    return {
      appliedCount,
      skippedCount,
      conflictsCount,
      lastPulledSeq: maxSeq,
      updatedProductIds: [...updatedProductIds],
      updatedUserIds: [...updatedUserIds],
    }
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}
