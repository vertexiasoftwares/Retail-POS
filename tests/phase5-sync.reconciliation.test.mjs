import assert from 'node:assert/strict'
import { test } from 'node:test'
import http from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VertexiaDatabase } from '../electron-dist/electron/database/database.mjs'
import { AuthRepository } from '../electron-dist/electron/database/auth.mjs'
import { BackupService } from '../electron-dist/electron/backup.mjs'
import { HybridSyncEngine } from '../electron-dist/electron/sync/engine.mjs'
import { reconcileCloudEvents } from '../electron-dist/electron/sync/reconciler.mjs'
import {
  claimPendingOutboxBatch,
  getSyncEpoch,
  listOutboxSummary,
  markOutboxFailed,
  recoverInterruptedOutbox,
  retryFailedOutboxEvents,
} from '../electron-dist/electron/sync/outbox.mjs'

test('Phase 5: Outbox crash recovery, backoff, movement-ledger stock reconciliation & backup epoch bump', async (t) => {
  await t.test('recovers interrupted in_flight outbox rows, pushes offline bills & reconciles remote negative stock conflict cleanly', async () => {
    const db = new VertexiaDatabase(':memory:')
    const auth = new AuthRepository(db.connection)
    t.after(() => db.close())

    const session = await auth.setup({
      businessName: 'Offline Sync Mart',
      branchName: 'Main',
      city: 'Karachi',
      ownerName: 'Owner',
      username: 'owner.sync',
      password: 'Password!2026',
    })
    const branchId = session.branchId
    const product = db.saveProduct(branchId, {
      name: 'Rice Bag 5kg',
      sku: 'RICE-5KG',
      barcode: 'RICE-5KG',
      category: 'Grocery',
      subcategory: '',
      brand: 'Guard',
      unit: 'Bag',
      purchasePricePaisa: 120000,
      sellingPricePaisa: 150000,
      mrpPaisa: 160000,
      minimumStockMilli: 2000,
      openingStockMilli: 10_000, // 10 bags
      status: 'active',
      imageDataUrl: null,
    })

    // Sell 8 bags offline (2 bags left locally)
    db.openPosShift(branchId, 50000, 'shift-sync-1')
    const sale = db.completePosSale({
      operationId: 'offline-sale-1',
      branchId,
      customerId: 'customer-walk-in',
      lines: [{ productId: product.id, quantityMilli: 8_000, discountBasisPoints: 0 }],
      paymentMethod: 'Cash',
      cashReceivedPaisa: 150000 * 8,
    })
    assert.ok(sale.saleId)

    // Simulate process crash leaving batch in_flight
    const claimed = claimPendingOutboxBatch(db.connection, 10, new Date().toISOString())
    assert.ok(claimed.length >= 4)
    assert.ok(listOutboxSummary(db.connection).inFlightCount >= 4)

    // Startup crash recovery resets in_flight -> pending
    const recovered = recoverInterruptedOutbox(db.connection, new Date().toISOString())
    assert.equal(recovered, claimed.length)
    assert.equal(listOutboxSummary(db.connection).inFlightCount, 0)

    // Simulate repeated failure -> backoff -> failed_permanent -> manual retry
    const testId = claimed[0].eventId
    for (let attempt = 0; attempt < 25; attempt++) {
      markOutboxFailed(db.connection, [testId], 'Network timeout', Date.now())
    }
    assert.equal(listOutboxSummary(db.connection).failedPermanentCount, 1)
    assert.equal(retryFailedOutboxEvents(db.connection, new Date().toISOString()), 1)
    assert.equal(listOutboxSummary(db.connection).failedPermanentCount, 0)

    // Spin up temporary HTTP cloud simulator to exercise HybridSyncEngine end-to-end
    const pushedEvents = []
    let pullReturned = false
    const cloudHttp = http.createServer((req, res) => {
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', () => {
        res.setHeader('content-type', 'application/json')
        if (req.url === '/api/cloud/sync/register-node' || req.url === '/api/cloud/sync/credentials') {
          res.end(JSON.stringify({ ok: true }))
          return
        }
        if (req.url === '/api/cloud/sync/push') {
          const parsed = JSON.parse(body)
          for (const evt of parsed.events) pushedEvents.push(evt)
          res.end(JSON.stringify({ ok: true, ackedEventIds: parsed.events.map(e => e.eventId) }))
          return
        }
        if (req.url?.startsWith('/api/cloud/sync/pull')) {
          if (pullReturned) {
            res.end(JSON.stringify({ events: [] }))
            return
          }
          pullReturned = true
          // Remote owner reduced stock by 5 units while Main PC was offline (2 remaining - 5 = -3 -> must clamp to 0!)
          res.end(
            JSON.stringify({
              events: [
                {
                  cloudSeq: 101,
                  eventId: 'cevt-remote-reduce-5',
                  originSource: 'cloud_owner',
                  entityType: 'stock_movement',
                  entityId: 'mv-remote-1',
                  operation: 'adjust',
                  createdAt: '2026-11-26T12:00:00Z',
                  payload: {
                    id: 'mv-remote-1',
                    branchId,
                    productId: product.id,
                    movementType: 'adjustment_decrease',
                    quantityDeltaMilli: -5_000,
                    note: 'Owner damaged stock write-off while shop offline',
                  },
                },
              ],
            }),
          )
          return
        }
        res.statusCode = 404
        res.end('{}')
      })
    })
    await new Promise(resolve => cloudHttp.listen(0, '127.0.0.1', resolve))
    t.after(() => cloudHttp.close())
    const cloudPort = cloudHttp.address().port

    const engine = new HybridSyncEngine({
      db: db.connection,
      cloudUrl: `http://127.0.0.1:${cloudPort}`,
      hmacSecret: 'test-hmac-secret-at-least-32-chars-long',
    })
    const syncRes = await engine.triggerNow()
    assert.equal(syncRes.synced, true)
    assert.ok(pushedEvents.some(e => e.entityType === 'sale' && e.entityId === sale.saleId))
    assert.equal(syncRes.pulledCount, 1)
    assert.equal(syncRes.conflictsCount, 1)

    // Verify local offline sale is untouched, stock clamped safely at 0, stock_value is 0 (accounting invariant!), and conflict logged
    assert.equal(Number(db.connection.prepare("SELECT COUNT(*) AS c FROM sales WHERE id=?").get(sale.saleId).c), 1)
    assert.equal(Number(db.connection.prepare('SELECT quantity_milli FROM stock_levels WHERE branch_id=? AND product_id=?').get(branchId, product.id).quantity_milli), 0)
    assert.equal(Number(db.connection.prepare('SELECT total_cost_paisa FROM stock_values WHERE branch_id=? AND product_id=?').get(branchId, product.id).total_cost_paisa), 0)
    const conflict = db.connection.prepare("SELECT * FROM sync_conflicts WHERE conflict_type='negative_stock_clamp'").get()
    assert.ok(conflict)

    // Re-applying duplicate cloud event is a strict no-op
    const dupReconcile = reconcileCloudEvents(
      db.connection,
      [
        {
          cloudSeq: 101,
          eventId: 'cevt-remote-reduce-5',
          originSource: 'cloud_owner',
          entityType: 'stock_movement',
          entityId: 'mv-remote-1',
          operation: 'adjust',
          createdAt: '2026-11-26T12:00:00Z',
          payload: { id: 'mv-remote-1', branchId, productId: product.id, quantityDeltaMilli: -5_000 },
        },
      ],
      new Date().toISOString(),
    )
    assert.equal(dupReconcile.appliedCount, 0)
    assert.equal(dupReconcile.skippedCount, 1)
  })

  await t.test('BackupService.restore increments sync_epoch on restored snapshot', async (subT) => {
    const dir = mkdtempSync(join(tmpdir(), 'vertexia-bk-epoch-'))
    let db
    subT.after(() => {
      try { db?.close() } catch {}
      try { rmSync(dir, { recursive: true, force: true }) } catch {}
    })
    const dbPath = join(dir, 'main.sqlite')
    const bkDir = join(dir, 'backups')

    db = new VertexiaDatabase(dbPath)
    let auth = new AuthRepository(db.connection)
    await auth.setup({
      businessName: 'Restore Epoch Mart',
      branchName: 'Main',
      city: 'Lahore',
      ownerName: 'Owner',
      username: 'owner.bk',
      password: 'Password!2026',
    })
    const initialEpoch = getSyncEpoch(db.connection)
    const service = new BackupService(() => db, dbPath, bkDir)
    const record = await service.create('manual')
    const preview = await service.preview(record.path, auth.current().userId)

    await service.restore(
      {
        token: preview.token,
        confirmation: 'RESTORE',
        currentPassword: 'Password!2026',
        backupOwnerUsername: 'owner.bk',
        backupOwnerPassword: 'Password!2026',
        allowDifferentInstallation: false,
      },
      auth.current().userId,
      {
        authorize: () => {},
        close: () => db.close(),
        reopen: () => {
          db = new VertexiaDatabase(dbPath)
          auth = new AuthRepository(db.connection)
        },
        setMaintenance: () => {},
      },
    )

    assert.equal(getSyncEpoch(db.connection), initialEpoch + 1, 'Restore must rotate sync_epoch')
  })
})
