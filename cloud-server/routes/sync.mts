import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { CloudEnvConfig } from '../config/env.mjs'
import { CLOUD_COLLECTIONS, type MongoCloudStore } from '../db/mongo-store.mjs'
import type { CloudRealtimeBroker } from '../realtime.mjs'
import { sha256Hex, verifyNodeHmac } from './auth.mjs'

async function applyStockMovementDelta(
  store: MongoCloudStore,
  params: {
    shopUuid: string
    movementId: string
    branchId: string
    productId: string
    movementType: string
    quantityDeltaMilli: number
    referenceType: string
    referenceId: string
    originSource: 'local' | 'cloud_owner'
    counterId: string
    note: string
    occurredAt: string
    localEventId?: string
  },
): Promise<{ balanceAfterMilli: number; conflictLogged: boolean }> {
  const mvId = `${params.shopUuid}:${params.movementId}`
  try {
    await store.col(CLOUD_COLLECTIONS.stockMovements).insertOne({
      _id: mvId as any,
      id: params.movementId,
      shopUuid: params.shopUuid,
      branchId: params.branchId,
      productId: params.productId,
      movementType: params.movementType,
      quantityDeltaMilli: params.quantityDeltaMilli,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      originSource: params.originSource,
      counterId: params.counterId,
      note: params.note,
      occurredAt: params.occurredAt,
    })
  } catch (err: any) {
    if (err?.code === 11000) {
      const sl = await store.col(CLOUD_COLLECTIONS.stockLevels).findOne({
        shopUuid: params.shopUuid,
        branchId: params.branchId,
        productId: params.productId,
      })
      return { balanceAfterMilli: Number(sl?.quantityMilli ?? 0), conflictLogged: false }
    }
    throw err
  }

  const slId = `${params.shopUuid}:${params.branchId}:${params.productId}`
  const existing = await store.col(CLOUD_COLLECTIONS.stockLevels).findOne({
    shopUuid: params.shopUuid,
    branchId: params.branchId,
    productId: params.productId,
  })
  const currentQty = Number(existing?.quantityMilli ?? 0)
  const rawNext = currentQty + params.quantityDeltaMilli
  const finalBalance = Math.max(0, rawNext)
  let conflictLogged = false

  if (rawNext < 0) {
    conflictLogged = true
    const conflictId = `conf-${randomUUID()}`
    await store.col(CLOUD_COLLECTIONS.syncConflicts).insertOne({
      _id: `${params.shopUuid}:${conflictId}` as any,
      id: conflictId,
      shopUuid: params.shopUuid,
      entityType: 'stock_level',
      entityId: params.productId,
      counterId: params.counterId,
      cloudSeq: null,
      conflictType: 'negative_stock_clamp',
      localSummary: `delta=${params.quantityDeltaMilli} event=${params.localEventId ?? params.movementId}`,
      cloudSummary: `cloud_before=${currentQty} raw_next=${rawNext}`,
      resolution: 'clamped_to_zero_and_logged',
      resolvedAt: new Date().toISOString(),
    })
  }

  await store.col(CLOUD_COLLECTIONS.stockLevels).updateOne(
    { shopUuid: params.shopUuid, branchId: params.branchId, productId: params.productId },
    {
      $set: {
        quantityMilli: finalBalance,
        updatedAt: params.occurredAt,
      },
      $inc: { syncVersion: 1 },
      $setOnInsert: {
        _id: slId as any,
        shopUuid: params.shopUuid,
        branchId: params.branchId,
        productId: params.productId,
      },
    },
    { upsert: true },
  )

  return { balanceAfterMilli: finalBalance, conflictLogged }
}

export function registerCloudSyncRoutes(
  app: FastifyInstance,
  config: CloudEnvConfig,
  store: MongoCloudStore,
  realtime?: CloudRealtimeBroker,
): void {
  // POST /api/cloud/sync/register-node
  app.post('/api/cloud/sync/register-node', async (request, reply) => {
    const verified = await verifyNodeHmac(request, reply, config, store, true)
    if (!verified) return

    const body = (request.body as {
      businessName?: string
      localBusinessId?: string
      branchId?: string
      branchName?: string
      city?: string
      appVersion?: string
      syncEpoch?: number
    }) || {}

    const bizName = body.businessName?.trim() || 'Vertexia Shop'
    const branchId = body.branchId?.trim() || 'branch-main'
    const branchName = body.branchName?.trim() || 'Main Shop'
    const city = body.city?.trim() || 'Main City'
    const localBusinessId = body.localBusinessId?.trim() || 'business-noor-mart'
    const now = new Date()

    await store.col(CLOUD_COLLECTIONS.shops).updateOne(
      { shopUuid: verified.shopUuid },
      {
        $set: {
          localBusinessId,
          name: bizName,
          branchName,
          city,
          activeBranchId: branchId,
          status: 'active',
          updatedAt: now,
        },
        $setOnInsert: {
          _id: verified.shopUuid as any,
          shopUuid: verified.shopUuid,
          createdAt: now,
        },
      },
      { upsert: true },
    )

    await store.col(CLOUD_COLLECTIONS.installations).updateOne(
      { nodeId: verified.nodeId },
      {
        $set: {
          shopUuid: verified.shopUuid,
          hmacSecretHash: sha256Hex(config.nodeHmacSecret),
          syncEpoch: Number(body.syncEpoch || 1),
          appVersion: body.appVersion || '1.0.0',
          lastIp: request.ip,
          lastSyncAt: now,
          status: 'active',
        },
        $setOnInsert: {
          _id: verified.nodeId as any,
          nodeId: verified.nodeId,
          createdAt: now,
        },
      },
      { upsert: true },
    )

    await store.col(CLOUD_COLLECTIONS.branches).updateOne(
      { shopUuid: verified.shopUuid, id: branchId },
      {
        $set: { name: branchName, city, isActive: true, businessId: localBusinessId },
        $setOnInsert: {
          _id: `${verified.shopUuid}:${branchId}` as any,
          id: branchId,
          shopUuid: verified.shopUuid,
          code: 'MAIN',
          createdAt: now.toISOString(),
        },
      },
      { upsert: true },
    )

    await store.col(CLOUD_COLLECTIONS.counters).updateOne(
      { shopUuid: verified.shopUuid, id: 'counter-1' },
      {
        $setOnInsert: {
          _id: `${verified.shopUuid}:counter-1` as any,
          id: 'counter-1',
          shopUuid: verified.shopUuid,
          businessId: localBusinessId,
          branchId,
          counterNumber: 1,
          name: 'Counter 1 (Main PC)',
          status: 'active',
          isPrimary: true,
          appVersion: body.appVersion || '1.0.0',
          lastIp: request.ip,
          lastSeenAt: now.toISOString(),
          createdAt: now.toISOString(),
          revokedAt: null,
        },
      },
      { upsert: true },
    )

    return {
      ok: true,
      shopUuid: verified.shopUuid,
      nodeId: verified.nodeId,
      databaseModel: 'mongodb-tenant-partitioned',
    }
  })

  // POST /api/cloud/sync/credentials — Syncs hashed credentials into MongoDB cloud_users
  app.post('/api/cloud/sync/credentials', async (request, reply) => {
    const verified = await verifyNodeHmac(request, reply, config, store, false)
    if (!verified) return

    const body = request.body as
      | {
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
        }
      | undefined

    if (!Array.isArray(body?.users)) {
      return reply.status(400).send({ error: 'BadRequest', message: 'users array required.', statusCode: 400 })
    }

    const now = new Date()
    for (const u of body.users) {
      if (!u.userId || !u.username || !u.passwordHash) continue
      const incomingVersion = Number(u.credentialVersion || 1)
      const existing = await store.col(CLOUD_COLLECTIONS.cloudUsers).findOne({
        shopUuid: verified.shopUuid,
        userId: u.userId,
      })
      const existingVersion = Number(existing?.credentialVersion ?? 0)
      const keepExistingPassword = Boolean(existing && existingVersion > incomingVersion)

      await store.col(CLOUD_COLLECTIONS.cloudUsers).updateOne(
        { shopUuid: verified.shopUuid, userId: u.userId },
        {
          $set: {
            branchId: u.branchId,
            username: u.username.toLowerCase(),
            name: u.name,
            role: u.role,
            passwordHash: keepExistingPassword ? String(existing!.passwordHash) : u.passwordHash,
            credentialVersion: Math.max(existingVersion, incomingVersion),
            isActive: Boolean(u.isActive),
            mustChangePassword: keepExistingPassword ? Boolean(existing!.mustChangePassword) : Boolean(u.mustChangePassword),
            updatedAt: now,
          },
          $setOnInsert: {
            _id: `${verified.shopUuid}:${u.userId}` as any,
            userId: u.userId,
            shopUuid: verified.shopUuid,
            createdAt: now,
          },
        },
        { upsert: true },
      )
    }

    return { ok: true, syncedCount: body.users.length }
  })

  // POST /api/cloud/sync/push — Idempotent batch push from Main PC outbox
  app.post('/api/cloud/sync/push', async (request, reply) => {
    const verified = await verifyNodeHmac(request, reply, config, store, false)
    if (!verified) return

    const body = request.body as
      | {
          events?: Array<{
            eventId: string
            entityType: string
            entityId: string
            operation: string
            counterId?: string
            syncEpoch?: number
            payloadHash?: string
            payload: Record<string, unknown>
            createdAt?: string
          }>
        }
      | undefined

    if (!Array.isArray(body?.events) || body.events.length > 200) {
      return reply.status(400).send({ error: 'BadRequest', message: 'Provide 0–200 events per sync batch.', statusCode: 400 })
    }

    const ackedEventIds: string[] = []
    let conflictsCount = 0
    const shopUuid = verified.shopUuid

    for (const evt of body.events) {
      if (!evt.eventId || !evt.entityType || !evt.entityId) continue

      try {
        await store.col(CLOUD_COLLECTIONS.processedSyncEvents).insertOne({
          _id: `${shopUuid}:${evt.eventId}` as any,
          eventId: evt.eventId,
          shopUuid,
          counterId: evt.counterId || 'counter-1',
          entityType: evt.entityType,
          entityId: evt.entityId,
          syncEpoch: Number(evt.syncEpoch ?? 1),
          payloadHash: evt.payloadHash || sha256Hex(JSON.stringify(evt.payload ?? {})),
          processedAt: new Date().toISOString(),
        })
      } catch (err: any) {
        if (err?.code === 11000) {
          ackedEventIds.push(evt.eventId)
          continue
        }
        throw err
      }

      const p = evt.payload || {}
      const occurredAt = String(p.occurredAt || p.completedAt || p.updatedAt || p.createdAt || evt.createdAt || new Date().toISOString())

      if (evt.entityType === 'product') {
        if (evt.operation === 'delete') {
          await store.col(CLOUD_COLLECTIONS.entityTombstones).updateOne(
            { shopUuid, entityType: 'product', entityId: evt.entityId },
            {
              $set: { deletedBy: evt.counterId || 'counter-1', deletedAt: occurredAt, reason: 'local_delete' },
              $setOnInsert: { _id: `${shopUuid}:product:${evt.entityId}` as any, shopUuid, entityType: 'product', entityId: evt.entityId },
            },
            { upsert: true },
          )
          await store.col(CLOUD_COLLECTIONS.products).updateOne(
            { shopUuid, id: evt.entityId },
            { $set: { isActive: false, isDeleted: true, deletedAt: occurredAt, updatedAt: occurredAt } },
          )
        } else {
          const tombstone = await store.col(CLOUD_COLLECTIONS.entityTombstones).findOne({
            shopUuid,
            entityType: 'product',
            entityId: evt.entityId,
          })
          const incomingVer = Number(p.syncVersion ?? 1)
          const existingProd = await store.col(CLOUD_COLLECTIONS.products).findOne({ shopUuid, id: evt.entityId })
          if (tombstone && (!existingProd || incomingVer <= Number(existingProd.syncVersion ?? 0))) {
            conflictsCount += 1
          } else {
            await store.col(CLOUD_COLLECTIONS.products).updateOne(
              { shopUuid, id: evt.entityId },
              {
                $set: {
                  businessId: String(p.businessId || 'business-noor-mart'),
                  sku: String(p.sku || evt.entityId),
                  barcode: p.barcode ? String(p.barcode) : null,
                  name: String(p.name || 'Unnamed Product'),
                  category: String(p.category || 'General'),
                  unit: String(p.unit || 'Piece'),
                  costPricePaisa: Number(p.purchasePricePaisa ?? p.costPricePaisa ?? 0),
                  salePricePaisa: Number(p.sellingPricePaisa ?? p.salePricePaisa ?? 0),
                  lowStockMilli: Number(p.minimumStockMilli ?? p.lowStockMilli ?? 0),
                  isActive: p.status ? p.status === 'active' : p.isActive !== false,
                  isDeleted: false,
                  syncVersion: Math.max(Number(existingProd?.syncVersion ?? 0), incomingVer),
                  updatedAt: occurredAt,
                },
                $setOnInsert: {
                  _id: `${shopUuid}:${evt.entityId}` as any,
                  id: evt.entityId,
                  shopUuid,
                  createdAt: String(p.createdAt || occurredAt),
                },
              },
              { upsert: true },
            )
            if (p.openingStockMilli !== undefined && p.branchId) {
              const slId = `${shopUuid}:${String(p.branchId)}:${evt.entityId}`
              await store.col(CLOUD_COLLECTIONS.stockLevels).updateOne(
                { shopUuid, branchId: String(p.branchId), productId: evt.entityId },
                {
                  $setOnInsert: {
                    _id: slId as any,
                    shopUuid,
                    branchId: String(p.branchId),
                    productId: evt.entityId,
                    quantityMilli: 0,
                    syncVersion: 1,
                    updatedAt: occurredAt,
                  },
                },
                { upsert: true },
              )
              if (Number(p.openingStockMilli) > 0) {
                const mv = await applyStockMovementDelta(store, {
                  shopUuid,
                  movementId: `mv-open-${evt.entityId}`,
                  branchId: String(p.branchId),
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
              }
            }
          }
        }
      } else if (evt.entityType === 'stock_movement') {
        const mv = await applyStockMovementDelta(store, {
          shopUuid,
          movementId: String(p.id || evt.entityId),
          branchId: String(p.branchId || 'branch-main'),
          productId: String(p.productId),
          movementType: String(p.movementType || 'adjustment'),
          quantityDeltaMilli: Number(p.quantityDeltaMilli ?? 0),
          referenceType: String(p.referenceType || 'stock_adjustment'),
          referenceId: String(p.referenceId || evt.entityId),
          originSource: 'local',
          counterId: String(p.counterId || evt.counterId || 'counter-1'),
          note: String(p.note || ''),
          occurredAt,
          localEventId: evt.eventId,
        })
        if (mv.conflictLogged) conflictsCount += 1
      } else if (evt.entityType === 'sale') {
        const items = Array.isArray(p.items) ? (p.items as Array<Record<string, unknown>>) : []
        const payments = Array.isArray(p.payments) ? (p.payments as Array<Record<string, unknown>>) : []
        const normalizedItems = items.map(item => ({
          id: String(item.id),
          saleId: evt.entityId,
          productId: String(item.productId),
          productNameSnapshot: String(item.productName || item.name || 'Item'),
          skuSnapshot: String(item.sku || ''),
          unitSnapshot: String(item.unit || 'Piece'),
          quantityMilli: Number(item.quantityMilli ?? 0),
          unitPricePaisa: Number(item.unitPricePaisa ?? 0),
          costPricePaisa: Number(item.costPricePaisa ?? 0),
          taxRateBps: Number(item.taxRateBps ?? 0),
          lineTotalPaisa: Number(item.lineTotalPaisa ?? 0),
        }))
        const primaryMethod = String(p.paymentMethod || payments[0]?.method || 'Cash')
        const paidPaisaVal = Number(p.paidPaisa ?? p.paidAmountPaisa ?? p.totalPaisa ?? 0)
        const normalizedPayments = payments.length
          ? payments.map(pay => ({
              id: String(pay.id),
              saleId: evt.entityId,
              method: String(pay.method || primaryMethod),
              amountPaisa: Number(pay.amountPaisa ?? 0),
              reference: String(pay.reference || ''),
              occurredAt,
            }))
          : paidPaisaVal > 0
            ? [
                {
                  id: String(p.paymentId || `pay-${evt.entityId}`),
                  saleId: evt.entityId,
                  method: primaryMethod,
                  amountPaisa: paidPaisaVal,
                  reference: '',
                  occurredAt,
                },
              ]
            : []

        try {
          await store.col(CLOUD_COLLECTIONS.sales).insertOne({
            _id: `${shopUuid}:${evt.entityId}` as any,
            id: evt.entityId,
            shopUuid,
            businessId: String(p.businessId || 'business-noor-mart'),
            branchId: String(p.branchId || 'branch-main'),
            counterId: String(p.counterId || evt.counterId || 'counter-1'),
            cashierId: String(p.cashierId || p.actorId || 'user-riyaz'),
            customerId: p.customerId ? String(p.customerId) : null,
            invoiceNumber: String(p.invoiceNumber),
            businessDate: String(p.businessDate || occurredAt.slice(0, 10)),
            status: String(p.status || 'completed'),
            paymentMethod: primaryMethod,
            subtotalPaisa: Number(p.subtotalPaisa ?? 0),
            discountPaisa: Number(p.discountPaisa ?? 0),
            taxPaisa: Number(p.taxPaisa ?? 0),
            totalPaisa: Number(p.totalPaisa ?? 0),
            costPaisa: Number(p.costPaisa ?? 0),
            paidPaisa: Number(p.paidPaisa ?? p.totalPaisa ?? 0),
            note: String(p.note || ''),
            completedAt: String(p.completedAt || occurredAt),
            items: normalizedItems,
            payments: normalizedPayments,
          })
        } catch (err: any) {
          if (err?.code !== 11000) throw err
        }

        const mvs = Array.isArray(p.stockMovements) ? (p.stockMovements as Array<Record<string, unknown>>) : []
        for (const m of mvs) {
          const mv = await applyStockMovementDelta(store, {
            shopUuid,
            movementId: String(m.movementId),
            branchId: String(p.branchId || 'branch-main'),
            productId: String(m.productId),
            movementType: 'sale',
            quantityDeltaMilli: Number(m.quantityDeltaMilli ?? 0),
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
        if (primaryMethod === 'Udhaar' && p.customerId && String(p.customerId) !== 'customer-walk-in') {
          const ledId = `cl-${evt.entityId}`
          await store.col(CLOUD_COLLECTIONS.customerLedger).updateOne(
            { shopUuid, id: ledId },
            {
              $setOnInsert: {
                _id: `${shopUuid}:${ledId}` as any,
                id: ledId,
                shopUuid,
                branchId: String(p.branchId || 'branch-main'),
                customerId: String(p.customerId),
                entryType: 'sale',
                debitPaisa: Number(p.totalPaisa ?? 0),
                creditPaisa: 0,
                referenceId: evt.entityId,
                occurredAt,
              },
            },
            { upsert: true },
          )
        }
      } else if (evt.entityType === 'sale_return') {
        await store.col(CLOUD_COLLECTIONS.saleReturns).updateOne(
          { shopUuid, id: evt.entityId },
          {
            $setOnInsert: {
              _id: `${shopUuid}:${evt.entityId}` as any,
              id: evt.entityId,
              shopUuid,
              branchId: String(p.branchId || 'branch-main'),
              counterId: String(p.counterId || evt.counterId || 'counter-1'),
              saleId: String(p.saleId),
              returnNumber: String(p.returnNumber),
              refundMethod: String(p.refundMethod || 'Cash'),
              subtotalPaisa: Number(p.subtotalPaisa ?? 0),
              taxPaisa: Number(p.taxPaisa ?? 0),
              totalPaisa: Number(p.totalPaisa ?? 0),
              costPaisa: Number(p.costPaisa ?? 0),
              note: String(p.note || ''),
              createdBy: String(p.createdBy || 'user-riyaz'),
              occurredAt,
            },
          },
          { upsert: true },
        )
        if (String(p.refundMethod) === 'Udhaar' && p.customerId) {
          const ledId = `cl-${evt.entityId}`
          await store.col(CLOUD_COLLECTIONS.customerLedger).updateOne(
            { shopUuid, id: ledId },
            {
              $setOnInsert: {
                _id: `${shopUuid}:${ledId}` as any,
                id: ledId,
                shopUuid,
                branchId: String(p.branchId || 'branch-main'),
                customerId: String(p.customerId),
                entryType: 'sale_return',
                debitPaisa: 0,
                creditPaisa: Number(p.totalPaisa ?? 0),
                referenceId: evt.entityId,
                occurredAt,
              },
            },
            { upsert: true },
          )
        }
        const mvs = Array.isArray(p.stockMovements) ? (p.stockMovements as Array<Record<string, unknown>>) : []
        for (const m of mvs) {
          const mv = await applyStockMovementDelta(store, {
            shopUuid,
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
        await store.col(CLOUD_COLLECTIONS.manualReturns).updateOne(
          { shopUuid, id: evt.entityId },
          {
            $setOnInsert: {
              _id: `${shopUuid}:${evt.entityId}` as any,
              id: evt.entityId,
              shopUuid,
              branchId: String(p.branchId || 'branch-main'),
              counterId: String(p.counterId || evt.counterId || 'counter-1'),
              customerId: String(p.customerId),
              businessDate: String(p.businessDate || occurredAt.slice(0, 10)),
              returnNumber: String(p.returnNumber),
              refundMethod: String(p.refundMethod || 'Cash'),
              totalPaisa: Number(p.totalPaisa ?? 0),
              costPaisa: Number(p.costPaisa ?? 0),
              note: String(p.note || ''),
              createdBy: String(p.createdBy || 'user-riyaz'),
              occurredAt,
            },
          },
          { upsert: true },
        )
        const mvs = Array.isArray(p.stockMovements) ? (p.stockMovements as Array<Record<string, unknown>>) : []
        for (const m of mvs) {
          const mv = await applyStockMovementDelta(store, {
            shopUuid,
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
        if (evt.operation === 'delete') {
          await store.col(CLOUD_COLLECTIONS.entityTombstones).updateOne(
            { shopUuid, entityType: 'customer', entityId: evt.entityId },
            {
              $set: { deletedBy: evt.counterId || 'counter-1', deletedAt: occurredAt, reason: 'local_delete' },
              $setOnInsert: { _id: `${shopUuid}:customer:${evt.entityId}` as any, shopUuid, entityType: 'customer', entityId: evt.entityId },
            },
            { upsert: true },
          )
          await store.col(CLOUD_COLLECTIONS.customers).updateOne(
            { shopUuid, id: evt.entityId },
            { $set: { isActive: false, isDeleted: true, deletedAt: occurredAt, updatedAt: occurredAt } },
          )
        } else {
          const existing = await store.col(CLOUD_COLLECTIONS.customers).findOne({ shopUuid, id: evt.entityId })
          await store.col(CLOUD_COLLECTIONS.customers).updateOne(
            { shopUuid, id: evt.entityId },
            {
              $set: {
                businessId: String(p.businessId || 'business-noor-mart'),
                name: String(p.name || 'Customer'),
                phone: String(p.phone || ''),
                isWalkIn: Boolean(p.isWalkIn),
                isActive: p.isActive !== false,
                isDeleted: false,
                syncVersion: Math.max(Number(existing?.syncVersion ?? 0), Number(p.syncVersion ?? 1)),
                updatedAt: occurredAt,
              },
              $setOnInsert: {
                _id: `${shopUuid}:${evt.entityId}` as any,
                id: evt.entityId,
                shopUuid,
                createdAt: String(p.createdAt || occurredAt),
              },
            },
            { upsert: true },
          )
          if (Number(p.openingBalancePaisa ?? 0) > 0 && p.branchId) {
            const obId = `cl-ob-${evt.entityId}`
            await store.col(CLOUD_COLLECTIONS.customerLedger).updateOne(
              { shopUuid, id: obId },
              {
                $setOnInsert: {
                  _id: `${shopUuid}:${obId}` as any,
                  id: obId,
                  shopUuid,
                  branchId: String(p.branchId),
                  customerId: evt.entityId,
                  entryType: 'opening_balance',
                  debitPaisa: Number(p.openingBalancePaisa),
                  creditPaisa: 0,
                  referenceId: evt.entityId,
                  occurredAt,
                },
              },
              { upsert: true },
            )
          }
        }
      } else if (evt.entityType === 'customer_receipt') {
        await store.col(CLOUD_COLLECTIONS.customerReceipts).updateOne(
          { shopUuid, id: evt.entityId },
          {
            $setOnInsert: {
              _id: `${shopUuid}:${evt.entityId}` as any,
              id: evt.entityId,
              shopUuid,
              branchId: String(p.branchId || 'branch-main'),
              customerId: String(p.customerId),
              receiptNumber: String(p.receiptNumber),
              businessDate: String(p.businessDate || occurredAt.slice(0, 10)),
              method: String(p.method || 'Cash'),
              amountPaisa: Number(p.amountPaisa ?? 0),
              note: String(p.note || ''),
              createdBy: String(p.createdBy || 'user-riyaz'),
              occurredAt,
            },
          },
          { upsert: true },
        )
        const ledId = `cl-rec-${evt.entityId}`
        await store.col(CLOUD_COLLECTIONS.customerLedger).updateOne(
          { shopUuid, id: ledId },
          {
            $setOnInsert: {
              _id: `${shopUuid}:${ledId}` as any,
              id: ledId,
              shopUuid,
              branchId: String(p.branchId || 'branch-main'),
              customerId: String(p.customerId),
              entryType: 'payment',
              debitPaisa: 0,
              creditPaisa: Number(p.amountPaisa ?? 0),
              referenceId: evt.entityId,
              occurredAt,
            },
          },
          { upsert: true },
        )
      } else if (evt.entityType === 'supplier') {
        if (evt.operation === 'delete' || evt.operation === 'deactivate') {
          await store.col(CLOUD_COLLECTIONS.entityTombstones).updateOne(
            { shopUuid, entityType: 'supplier', entityId: evt.entityId },
            {
              $set: { deletedBy: evt.counterId || 'counter-1', deletedAt: occurredAt, reason: evt.operation },
              $setOnInsert: { _id: `${shopUuid}:supplier:${evt.entityId}` as any, shopUuid, entityType: 'supplier', entityId: evt.entityId },
            },
            { upsert: true },
          )
          await store.col(CLOUD_COLLECTIONS.suppliers).updateOne(
            { shopUuid, id: evt.entityId },
            { $set: { isActive: false, isDeleted: true, deletedAt: occurredAt, updatedAt: occurredAt } },
          )
        } else {
          const existing = await store.col(CLOUD_COLLECTIONS.suppliers).findOne({ shopUuid, id: evt.entityId })
          await store.col(CLOUD_COLLECTIONS.suppliers).updateOne(
            { shopUuid, id: evt.entityId },
            {
              $set: {
                businessId: String(p.businessId || 'business-noor-mart'),
                name: String(p.name || 'Supplier'),
                phone: String(p.phone || ''),
                isActive: p.isActive !== false,
                isDeleted: false,
                syncVersion: Math.max(Number(existing?.syncVersion ?? 0), Number(p.syncVersion ?? 1)),
                updatedAt: occurredAt,
              },
              $setOnInsert: {
                _id: `${shopUuid}:${evt.entityId}` as any,
                id: evt.entityId,
                shopUuid,
                createdAt: String(p.createdAt || occurredAt),
              },
            },
            { upsert: true },
          )
          if (Number(p.openingBalancePaisa ?? 0) > 0 && p.branchId) {
            const obId = `sl-ob-${evt.entityId}`
            await store.col(CLOUD_COLLECTIONS.supplierLedger).updateOne(
              { shopUuid, id: obId },
              {
                $setOnInsert: {
                  _id: `${shopUuid}:${obId}` as any,
                  id: obId,
                  shopUuid,
                  branchId: String(p.branchId),
                  supplierId: evt.entityId,
                  entryType: 'opening_balance',
                  debitPaisa: Number(p.openingBalancePaisa),
                  creditPaisa: 0,
                  referenceId: evt.entityId,
                  occurredAt,
                },
              },
              { upsert: true },
            )
          }
        }
      } else if (evt.entityType === 'purchase') {
        await store.col(CLOUD_COLLECTIONS.purchases).updateOne(
          { shopUuid, id: evt.entityId },
          {
            $setOnInsert: {
              _id: `${shopUuid}:${evt.entityId}` as any,
              id: evt.entityId,
              shopUuid,
              branchId: String(p.branchId || 'branch-main'),
              supplierId: String(p.supplierId),
              supplierNameSnapshot: String(p.supplierName || ''),
              purchaseNumber: String(p.purchaseNumber),
              businessDate: String(p.businessDate || occurredAt.slice(0, 10)),
              totalPaisa: Number(p.totalPaisa ?? 0),
              paidPaisa: Number(p.paidPaisa ?? 0),
              note: String(p.note || ''),
              createdBy: String(p.createdBy || 'user-riyaz'),
              occurredAt,
            },
          },
          { upsert: true },
        )
        const slId = `sl-pur-${evt.entityId}`
        await store.col(CLOUD_COLLECTIONS.supplierLedger).updateOne(
          { shopUuid, id: slId },
          {
            $setOnInsert: {
              _id: `${shopUuid}:${slId}` as any,
              id: slId,
              shopUuid,
              branchId: String(p.branchId || 'branch-main'),
              supplierId: String(p.supplierId),
              entryType: 'purchase',
              debitPaisa: Number(p.totalPaisa ?? 0),
              creditPaisa: 0,
              referenceId: evt.entityId,
              occurredAt,
            },
          },
          { upsert: true },
        )
        const mvs = Array.isArray(p.stockMovements) ? (p.stockMovements as Array<Record<string, unknown>>) : []
        for (const m of mvs) {
          const mv = await applyStockMovementDelta(store, {
            shopUuid,
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
            await store.col(CLOUD_COLLECTIONS.products).updateOne(
              { shopUuid, id: String(m.productId) },
              { $set: { costPricePaisa: Number(m.unitCostPaisa), updatedAt: occurredAt } },
            )
          }
        }
        if (Number(p.paidPaisa ?? 0) > 0 && p.paymentId) {
          const payId = String(p.paymentId)
          await store.col(CLOUD_COLLECTIONS.supplierPayments).updateOne(
            { shopUuid, id: payId },
            {
              $setOnInsert: {
                _id: `${shopUuid}:${payId}` as any,
                id: payId,
                shopUuid,
                branchId: String(p.branchId || 'branch-main'),
                supplierId: String(p.supplierId),
                paymentNumber: String(p.purchaseNumber),
                businessDate: String(p.businessDate || occurredAt.slice(0, 10)),
                method: String(p.paymentMethod || 'Cash'),
                amountPaisa: Number(p.paidPaisa),
                note: String(p.note || ''),
                createdBy: String(p.createdBy || 'user-riyaz'),
                occurredAt,
              },
            },
            { upsert: true },
          )
          const slPayId = `sl-pay-${payId}`
          await store.col(CLOUD_COLLECTIONS.supplierLedger).updateOne(
            { shopUuid, id: slPayId },
            {
              $setOnInsert: {
                _id: `${shopUuid}:${slPayId}` as any,
                id: slPayId,
                shopUuid,
                branchId: String(p.branchId || 'branch-main'),
                supplierId: String(p.supplierId),
                entryType: 'payment',
                debitPaisa: 0,
                creditPaisa: Number(p.paidPaisa),
                referenceId: payId,
                occurredAt,
              },
            },
            { upsert: true },
          )
        }
      } else if (evt.entityType === 'supplier_payment') {
        await store.col(CLOUD_COLLECTIONS.supplierPayments).updateOne(
          { shopUuid, id: evt.entityId },
          {
            $setOnInsert: {
              _id: `${shopUuid}:${evt.entityId}` as any,
              id: evt.entityId,
              shopUuid,
              branchId: String(p.branchId || 'branch-main'),
              supplierId: String(p.supplierId),
              paymentNumber: String(p.paymentNumber || evt.entityId),
              businessDate: String(p.businessDate || occurredAt.slice(0, 10)),
              method: String(p.method || 'Cash'),
              amountPaisa: Number(p.amountPaisa ?? 0),
              note: String(p.note || ''),
              createdBy: String(p.createdBy || 'user-riyaz'),
              occurredAt,
            },
          },
          { upsert: true },
        )
        const slId = `sl-sp-${evt.entityId}`
        await store.col(CLOUD_COLLECTIONS.supplierLedger).updateOne(
          { shopUuid, id: slId },
          {
            $setOnInsert: {
              _id: `${shopUuid}:${slId}` as any,
              id: slId,
              shopUuid,
              branchId: String(p.branchId || 'branch-main'),
              supplierId: String(p.supplierId),
              entryType: 'payment',
              debitPaisa: 0,
              creditPaisa: Number(p.amountPaisa ?? 0),
              referenceId: evt.entityId,
              occurredAt,
            },
          },
          { upsert: true },
        )
      } else if (evt.entityType === 'expense') {
        await store.col(CLOUD_COLLECTIONS.expenses).updateOne(
          { shopUuid, id: evt.entityId },
          {
            $setOnInsert: {
              _id: `${shopUuid}:${evt.entityId}` as any,
              id: evt.entityId,
              shopUuid,
              branchId: String(p.branchId || 'branch-main'),
              expenseNumber: String(p.expenseNumber || evt.entityId),
              businessDate: String(p.businessDate || occurredAt.slice(0, 10)),
              category: String(p.category || 'General'),
              description: String(p.description || ''),
              method: String(p.method || 'Cash'),
              amountPaisa: Number(p.amountPaisa ?? 0),
              note: String(p.note || ''),
              createdBy: String(p.createdBy || 'user-riyaz'),
              occurredAt,
            },
          },
          { upsert: true },
        )
      } else if (evt.entityType === 'cash_shift') {
        const existing = await store.col(CLOUD_COLLECTIONS.cashShifts).findOne({ shopUuid, id: evt.entityId })
        await store.col(CLOUD_COLLECTIONS.cashShifts).updateOne(
          { shopUuid, id: evt.entityId },
          {
            $set: {
              branchId: String(p.branchId || existing?.branchId || 'branch-main'),
              counterId: String(p.counterId || evt.counterId || existing?.counterId || 'counter-1'),
              cashierId: String(p.cashierId || existing?.cashierId || 'user-riyaz'),
              status: String(p.status || 'open'),
              openingCashPaisa: Number(p.openingCashPaisa ?? existing?.openingCashPaisa ?? 0),
              expectedCashPaisa: p.expectedCashPaisa !== undefined ? Number(p.expectedCashPaisa) : (existing?.expectedCashPaisa ?? null),
              countedCashPaisa: p.countedCashPaisa !== undefined && p.countedCashPaisa !== null ? Number(p.countedCashPaisa) : (existing?.countedCashPaisa ?? null),
              variancePaisa: p.variancePaisa !== undefined && p.variancePaisa !== null ? Number(p.variancePaisa) : (existing?.variancePaisa ?? null),
              note: p.closingNote ? String(p.closingNote) : p.note ? String(p.note) : (existing?.note ?? null),
              openedAt: String(p.openedAt || existing?.openedAt || occurredAt),
              closedAt: p.closedAt ? String(p.closedAt) : (existing?.closedAt ?? null),
            },
            $setOnInsert: {
              _id: `${shopUuid}:${evt.entityId}` as any,
              id: evt.entityId,
              shopUuid,
            },
          },
          { upsert: true },
        )
      } else if (evt.entityType === 'cash_movement') {
        await store.col(CLOUD_COLLECTIONS.cashMovements).updateOne(
          { shopUuid, id: evt.entityId },
          {
            $setOnInsert: {
              _id: `${shopUuid}:${evt.entityId}` as any,
              id: evt.entityId,
              shopUuid,
              shiftId: String(p.shiftId),
              branchId: String(p.branchId || 'branch-main'),
              movementType: String(p.movementType || 'cash_in'),
              amountPaisa: Number(p.amountPaisa ?? 0),
              reason: String(p.reason || ''),
              createdBy: String(p.createdBy || 'user-riyaz'),
              occurredAt,
            },
          },
          { upsert: true },
        )
      } else if (evt.entityType === 'counter') {
        const existing = await store.col(CLOUD_COLLECTIONS.counters).findOne({ shopUuid, id: evt.entityId })
        await store.col(CLOUD_COLLECTIONS.counters).updateOne(
          { shopUuid, id: evt.entityId },
          {
            $set: {
              businessId: String(p.businessId || 'business-noor-mart'),
              branchId: String(p.branchId || 'branch-main'),
              counterNumber: Number(p.counterNumber ?? existing?.counterNumber ?? 1),
              name: String(p.name || 'Counter'),
              status: String(p.status || 'active'),
              isPrimary: Boolean(p.isPrimary),
              appVersion: p.appVersion ? String(p.appVersion) : (existing?.appVersion ?? null),
              lastIp: p.lastIp ? String(p.lastIp) : (existing?.lastIp ?? null),
              lastSeenAt: p.lastSeenAt ? String(p.lastSeenAt) : (existing?.lastSeenAt ?? null),
              revokedAt: p.revokedAt ? String(p.revokedAt) : null,
            },
            $setOnInsert: {
              _id: `${shopUuid}:${evt.entityId}` as any,
              id: evt.entityId,
              shopUuid,
              createdAt: String(p.createdAt || occurredAt),
            },
          },
          { upsert: true },
        )
      } else if (evt.entityType === 'user') {
        const existing = await store.col(CLOUD_COLLECTIONS.cloudUsers).findOne({ shopUuid, userId: evt.entityId })
        await store.col(CLOUD_COLLECTIONS.cloudUsers).updateOne(
          { shopUuid, userId: evt.entityId },
          {
            $set: {
              branchId: String(p.branchId || existing?.branchId || 'branch-main'),
              name: String(p.name || 'Staff'),
              username: p.username ? String(p.username).toLowerCase() : (existing?.username ?? evt.entityId),
              role: String(p.role || 'Cashier'),
              isActive: p.isActive !== false,
              allowedTabs: p.allowedTabs ?? null,
              syncVersion: Math.max(Number(existing?.syncVersion ?? 0), Number(p.syncVersion ?? 1)),
              updatedAt: new Date(occurredAt),
            },
            $setOnInsert: {
              _id: `${shopUuid}:${evt.entityId}` as any,
              userId: evt.entityId,
              shopUuid,
              passwordHash: '',
              credentialVersion: 1,
              mustChangePassword: false,
              createdAt: new Date(String(p.createdAt || occurredAt)),
            },
          },
          { upsert: true },
        )
      } else if (evt.entityType === 'business_profile') {
        await store.col(CLOUD_COLLECTIONS.shops).updateOne(
          { shopUuid },
          {
            $set: {
              ...(p.businessName ? { name: String(p.businessName) } : {}),
              ...(p.branchName ? { branchName: String(p.branchName) } : {}),
              ...(p.city ? { city: String(p.city) } : {}),
              updatedAt: new Date(),
            },
          },
        )
      }

      ackedEventIds.push(evt.eventId)
    }

    await store.col(CLOUD_COLLECTIONS.installations).updateOne(
      { nodeId: verified.nodeId, shopUuid },
      { $set: { lastSyncAt: new Date() } },
    )

    if (ackedEventIds.length > 0 && realtime) {
      realtime.broadcastToShop(shopUuid, {
        type: 'cloud:sync_updated',
        shopUuid,
        payload: { appliedCount: ackedEventIds.length, conflictsCount },
      })
    }

    return { ok: true, ackedEventIds, conflictsCount }
  })

  // GET /api/cloud/sync/pull — Cursor-based remote owner events awaiting Main PC reconciliation
  app.get('/api/cloud/sync/pull', async (request, reply) => {
    const verified = await verifyNodeHmac(request, reply, config, store, false)
    if (!verified) return

    const q = request.query as { sinceCloudSeq?: string; limit?: string }
    const sinceSeq = Math.max(0, Number(q.sinceCloudSeq ?? 0) || 0)
    const limit = Math.max(1, Math.min(200, Number(q.limit ?? 100) || 100))

    const rows = await store
      .col(CLOUD_COLLECTIONS.cloudSyncEvents)
      .find({
        shopUuid: verified.shopUuid,
        originSource: 'cloud_owner',
        cloudSeq: { $gt: sinceSeq },
      })
      .sort({ cloudSeq: 1 })
      .limit(limit)
      .toArray()

    return {
      events: rows.map(r => ({
        cloudSeq: Number(r.cloudSeq),
        eventId: String(r.eventId),
        originSource: String(r.originSource),
        counterId: r.counterId ? String(r.counterId) : null,
        entityType: String(r.entityType),
        entityId: String(r.entityId),
        operation: String(r.operation),
        payload: (r.payload || {}) as Record<string, unknown>,
        createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
      })),
    }
  })
}
