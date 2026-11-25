import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { AuthRepository } from '../electron-dist/electron/database/auth.mjs'
import { VertexiaDatabase } from '../electron-dist/electron/database/database.mjs'
import { authorizeIpc, scopeOperation } from '../electron-dist/electron/ipc-policy.mjs'
import { createServer } from '../server-dist/server/server.mjs'

const branchId = 'branch-main'
const ownerPassword = 'Owner phase1 passphrase 2026'
const staffPassword = 'Staff phase1 passphrase 2026'
const clock = () => new Date('2026-10-15T12:00:00+05:00')

const readRepoFile = rel => readFileSync(join(process.cwd(), rel), 'utf8')

const productDraft = (changes = {}) => ({
  name: 'Phase 1 Rice',
  sku: `PH1-${randomUUID().slice(0, 6).toUpperCase()}`,
  barcode: `PH1B-${randomUUID().slice(0, 6).toUpperCase()}`,
  category: 'Grocery',
  subcategory: '',
  brand: 'TestBrand',
  unit: 'Kg',
  purchasePricePaisa: 10000,
  sellingPricePaisa: 15000,
  mrpPaisa: 0,
  minimumStockMilli: 0,
  openingStockMilli: 0,
  status: 'active',
  imageDataUrl: null,
  ...changes,
})

function extractCookie(response) {
  const raw = response.headers.get('set-cookie')
  assert.ok(raw, 'Expected Set-Cookie header')
  return raw.split(';')[0]
}

test('1.1 startup does not override owner taha into jameel', async t => {
  const mainSrc = readRepoFile('electron/main.mts')
  assert.equal(mainSrc.includes("username.toLowerCase() === 'taha'"), false)
  assert.equal(mainSrc.includes("UPDATE businesses SET name='Jameel'"), false)

  const dir = mkdtempSync(join(tmpdir(), 'vertexia-ph1-taha-'))
  const dbPath = join(dir, 'store.db')
  let db
  t.after(() => {
    try { db?.close() } catch {}
    rmSync(dir, { recursive: true, force: true })
  })

  db = new VertexiaDatabase(dbPath, clock)
  let auth = new AuthRepository(db.connection, clock)
  await auth.setup({
    businessName: 'Taha Super Store',
    branchName: 'Main Branch',
    city: 'Lahore',
    ownerName: 'Taha',
    username: 'taha',
    password: ownerPassword,
  })
  db.close()

  db = new VertexiaDatabase(dbPath, clock)
  auth = new AuthRepository(db.connection, clock)
  const logged = await auth.login('taha', ownerPassword)
  assert.equal(logged.name, 'Taha')
  assert.equal(logged.username, 'taha')
  assert.equal(logged.businessName, 'Taha Super Store')
})

test('1.2 LoginPage removes auth.setup({force:true}) auto-heal and failed login stays rejected', async t => {
  const loginSrc = readRepoFile('src/app/auth/LoginPage.tsx')
  assert.equal(loginSrc.includes('auth.setup('), false)
  assert.equal(loginSrc.includes('force: true'), false)
  assert.equal(loginSrc.includes("!== 'taha'"), false)

  const db = new VertexiaDatabase(':memory:', clock)
  t.after(() => db.close())
  const auth = new AuthRepository(db.connection, clock)
  await auth.setup({
    businessName: 'Real Mart',
    branchName: 'Main',
    city: 'Karachi',
    ownerName: 'Owner',
    username: 'owner',
    password: ownerPassword,
  })
  auth.logout()
  await assert.rejects(auth.login('owner', 'wrong-password-123'), /Invalid username or password/)
  assert.equal(auth.current(), null)
  const cred = db.connection.prepare("SELECT failed_attempts FROM user_credentials WHERE username='owner'").get()
  assert.equal(cred.failed_attempts, 1)
})

test('1.3 ReportsRepository & ReportsPage show real zeros when empty and real breakdowns with sales/returns/expenses', async t => {
  const reportsSrc = readRepoFile('src/features/reports/ReportsPage.tsx')
  for (const banned of ['TOP_PRODUCTS', 'STAFF_SALES', '248560000', '64230000', '18675000', '45555000', '1,843,300', 'SAL-2026-1258', 'Tax Report']) {
    assert.equal(reportsSrc.includes(banned), false, `Found banned mock marker in ReportsPage.tsx: ${banned}`)
  }

  let now = clock()
  const db = new VertexiaDatabase(':memory:', () => now)
  t.after(() => db.close())
  const auth = new AuthRepository(db.connection, () => now)
  const ownerSession = await auth.setup({ businessName: 'Reports Store', branchName: 'Main', city: 'Karachi', ownerName: 'Owner', username: 'owner', password: ownerPassword })

  const empty = db.reports.snapshot({ branchId, dateFrom: '2026-10-01', dateTo: '2026-10-31', section: 'overview' })
  assert.equal(empty.summary.salesPaisa, 0)
  assert.equal(empty.summary.grossProfitPaisa, 0)
  assert.equal(empty.summary.expensesPaisa, 0)
  assert.equal(empty.summary.operatingProfitPaisa, 0)
  assert.equal(empty.summary.invoiceCount, 0)
  assert.equal(empty.summary.itemsSoldMilli, 0)
  assert.equal(empty.summary.averageInvoicePaisa, 0)
  assert.equal(empty.summary.newCustomersCount, 0)
  assert.deepEqual(empty.salesTrend, [])
  assert.deepEqual(empty.categorySales, [])
  assert.deepEqual(empty.topProducts, [])
  assert.deepEqual(empty.staffSales, [])
  assert.deepEqual(empty.recentSales, [])
  assert.deepEqual(empty.expenseByCategory, [])

  const cashierUsers = await auth.createUser({ name: 'Sara Cashier', username: 'sara', password: staffPassword, role: 'Cashier', branchIds: [branchId] })
  const sara = cashierUsers.find(u => u.username === 'sara')
  const pRice = db.saveProduct(branchId, productDraft({ name: 'Basmati Rice', category: 'Grocery', purchasePricePaisa: 10000, sellingPricePaisa: 15000, openingStockMilli: 10000 }))
  const pCola = db.saveProduct(branchId, productDraft({ name: 'Cola 1.5L', category: 'Beverages', purchasePricePaisa: 8000, sellingPricePaisa: 12000, openingStockMilli: 10000 }))
  const { customerId } = db.accounts.createCustomer({ branchId, operationId: randomUUID(), name: 'Hina Traders', phone: '03001112233', openingBalancePaisa: 0 })

  db.setActor(sara.id)
  db.openPosShift(branchId, 100000)
  const sale = db.completePosSale({
    branchId,
    operationId: randomUUID(),
    customerId,
    paymentMethod: 'Cash',
    cashReceivedPaisa: 42000,
    lines: [
      { productId: pRice.id, quantityMilli: 2000, discountBasisPoints: 0 },
      { productId: pCola.id, quantityMilli: 1000, discountBasisPoints: 0 },
    ],
  })
  const itemCola = db.getSalesDetail(branchId, sale.saleId).lines.find(l => l.productId === pCola.id)
  db.createSalesReturn({ branchId, operationId: randomUUID(), saleId: sale.saleId, reason: 'Returned cola', lines: [{ saleItemId: itemCola.id, quantityMilli: 1000 }] })
  db.setActor(ownerSession.userId)
  db.accounts.postExpense({ branchId, operationId: randomUUID(), businessDate: '2026-10-15', description: 'Shop electricity', category: 'Utilities', amountPaisa: 2500, method: 'Cash', reference: '' })

  const daily = db.reports.snapshot({ branchId, dateFrom: '2026-10-01', dateTo: '2026-10-31', section: 'overview', trendGranularity: 'daily' })
  assert.equal(daily.summary.salesPaisa, 42000)
  assert.equal(daily.summary.returnsPaisa, 12000)
  assert.equal(daily.summary.netSalesPaisa, 30000)
  assert.equal(daily.summary.costPaisa, 20000)
  assert.equal(daily.summary.grossProfitPaisa, 10000)
  assert.equal(daily.summary.expensesPaisa, 2500)
  assert.equal(daily.summary.operatingProfitPaisa, 7500)
  assert.equal(daily.summary.invoiceCount, 1)
  assert.equal(daily.summary.itemsSoldMilli, 2000)
  assert.equal(daily.summary.averageInvoicePaisa, 42000)
  assert.equal(daily.summary.newCustomersCount, 1)
  assert.equal(daily.salesTrend.length, 1)
  assert.equal(daily.salesTrend[0].netSalesPaisa, 30000)
  assert.equal(daily.categorySales.length, 1)
  assert.equal(daily.categorySales[0].category, 'Grocery')
  assert.equal(daily.topProducts.length, 1)
  assert.equal(daily.topProducts[0].productId, pRice.id)
  assert.equal(daily.staffSales[0].name, 'Sara Cashier')
  assert.equal(daily.staffSales[0].netSalesPaisa, 30000)
  assert.equal(daily.recentSales.length, 1)
  assert.equal(daily.recentSales[0].customerName, 'Hina Traders')
  assert.equal(daily.expenseByCategory[0].category, 'Utilities')
  assert.equal(daily.expenseByCategory[0].netPaisa, 2500)

  const monthly = db.reports.snapshot({ branchId, dateFrom: '2026-10-01', dateTo: '2026-10-31', section: 'shifts', trendGranularity: 'monthly' })
  assert.equal(monthly.salesTrend[0].periodKey, '2026-10')
  assert.equal(monthly.table.rows.length, 1)
})

test('1.4 ExpensesRepository & ExpensesPage compute real today/year/filter numbers with no fake fallbacks', t => {
  const expensesSrc = readRepoFile('src/features/expenses/ExpensesPage.tsx')
  for (const banned of ['18675000', '320000', '6000000', '1,950,400']) {
    assert.equal(expensesSrc.includes(banned), false, `Found banned fake number in ExpensesPage.tsx: ${banned}`)
  }
  assert.equal(expensesSrc.includes('DateRangeFilter'), true)

  const db = new VertexiaDatabase(':memory:', clock)
  t.after(() => db.close())
  const empty = db.accounts.expenses({ branchId, dateFrom: '2026-10-01', dateTo: '2026-10-31', search: '', category: '', method: '', page: 1, pageSize: 10 })
  assert.equal(empty.netPaisa, 0)
  assert.equal(empty.todayPaisa, 0)
  assert.equal(empty.yearPaisa, 0)
  assert.deepEqual(empty.byCategory, [])

  db.openPosShift(branchId, 100000)
  db.accounts.postExpense({ branchId, operationId: randomUUID(), businessDate: '2026-09-10', description: 'Sept Rent', category: 'Rent', amountPaisa: 50000, method: 'Bank Transfer', reference: 'BT-01' })
  db.accounts.postExpense({ branchId, operationId: randomUUID(), businessDate: '2026-10-15', description: 'Today Tea', category: 'Other', amountPaisa: 1500, method: 'Cash', reference: '' })

  const filtered = db.accounts.expenses({ branchId, dateFrom: '2026-10-01', dateTo: '2026-10-31', search: '', category: '', method: '', page: 1, pageSize: 10 })
  assert.equal(filtered.netPaisa, 1500)
  assert.equal(filtered.todayPaisa, 1500)
  assert.equal(filtered.yearPaisa, 51500)
  assert.deepEqual(filtered.byCategory, [{ category: 'Other', netPaisa: 1500 }])
})

test('1.5 InventoryPage ExpiryView removes fake batches and displays setup message', () => {
  const invSrc = readRepoFile('src/features/inventory/InventoryPage.tsx')
  assert.equal(invSrc.includes('Batch & expiry tracking is not set up yet'), true)
  assert.equal(invSrc.includes('BAT-'), false)
  assert.equal(invSrc.includes('(idx * 37) % 360'), false)
})

test('1.6 ProductsPage hides unsaved form fields until backend supports them', () => {
  const prodSrc = readRepoFile('src/features/products/ProductsPage.tsx')
  for (const field of ['GST / Sales Tax Rate', 'Shelf / Storage Location', 'Electronic Weight Scale Item', 'Allow POS Cashier Discount', 'Batch & Expiry Tracking', 'setTaxRate', 'setStorageShelf']) {
    assert.equal(prodSrc.includes(field), false, `Unsaved field still present in ProductsPage.tsx: ${field}`)
  }
})

test('1.7 deleteProduct blocks all 6 history tables and allows deactivating, deleting only zero-history products', async t => {
  const prodSrc = readRepoFile('src/features/products/ProductsPage.tsx')
  assert.equal(prodSrc.includes('Deactivate Product Instead'), true)

  const dir = mkdtempSync(join(tmpdir(), 'vertexia-ph1-del-'))
  const dbPath = join(dir, 'store.db')
  let db
  let server
  t.after(async () => {
    try { await server?.stop() } catch {}
    try { db?.close() } catch {}
    rmSync(dir, { recursive: true, force: true })
  })

  db = new VertexiaDatabase(dbPath, clock)
  const auth = new AuthRepository(db.connection, clock)
  await auth.setup({ businessName: 'Delete Test Shop', branchName: 'Main', city: 'Karachi', ownerName: 'Owner', username: 'owner', password: ownerPassword })
  db.connection.prepare('INSERT INTO branches(id,business_id,name,code,city,is_active,created_at) VALUES (?,?,?,?,?,?,?)').run('branch-2', db.businessId, 'Branch 2', 'B2', 'Lahore', 1, clock().toISOString())
  db.openPosShift(branchId, 100000)

  // 0. Zero-history product deletes cleanly
  const pClean = db.saveProduct(branchId, productDraft({ name: 'Unused Item', openingStockMilli: 0 }))
  assert.deepEqual(db.deleteProduct(branchId, pClean.id), { success: true, archived: false })
  assert.equal(db.connection.prepare('SELECT COUNT(*) AS n FROM products WHERE id=?').get(pClean.id).n, 0)

  // 1. Product with stock_movements (opening stock)
  const pMove = db.saveProduct(branchId, productDraft({ name: 'Opening Move Item', openingStockMilli: 5000 }))
  assert.throws(() => db.deleteProduct(branchId, pMove.id), /cannot be permanently deleted/)

  // 2. Product with purchase_items (created with 0 stock, then purchased)
  const pPur = db.saveProduct(branchId, productDraft({ name: 'Purchased Item', openingStockMilli: 0 }))
  db.retail.receivePurchase({ branchId, operationId: randomUUID(), supplierName: 'Supplier A', supplierInvoiceNumber: 'INV-1', businessDate: '2026-10-15', paidAmountPaisa: 0, paymentMethod: 'Cash', lines: [{ productId: pPur.id, quantityMilli: 2000, unitCostPaisa: 9000 }] })
  assert.throws(() => db.deleteProduct(branchId, pPur.id), /cannot be permanently deleted/)
  assert.equal(db.connection.prepare('SELECT COUNT(*) AS n FROM purchase_items WHERE product_id=?').get(pPur.id).n, 1)

  // 3. Product with sale_items
  const sale = db.completePosSale({ branchId, operationId: randomUUID(), customerId: 'customer-walk-in', paymentMethod: 'Cash', cashReceivedPaisa: 30000, lines: [{ productId: pMove.id, quantityMilli: 1000, discountBasisPoints: 0 }] })
  assert.throws(() => db.deleteProduct(branchId, pMove.id), /cannot be permanently deleted/)
  assert.equal(db.connection.prepare('SELECT COUNT(*) AS n FROM sale_items WHERE product_id=?').get(pMove.id).n, 1)

  // 4. Product with sale_return_items
  const sLine = db.getSalesDetail(branchId, sale.saleId).lines[0]
  db.createSalesReturn({ branchId, operationId: randomUUID(), saleId: sale.saleId, reason: 'Returned', lines: [{ saleItemId: sLine.id, quantityMilli: 1000 }] })
  assert.throws(() => db.deleteProduct(branchId, pMove.id), /cannot be permanently deleted/)
  assert.equal(db.connection.prepare('SELECT COUNT(*) AS n FROM sale_return_items WHERE product_id=?').get(pMove.id).n, 1)

  // 5. Product with manual_return_items
  const pMan = db.saveProduct(branchId, productDraft({ name: 'Manual Return Item', openingStockMilli: 0 }))
  db.createManualReturn({ branchId, operationId: randomUUID(), customerId: 'customer-walk-in', refundMethod: 'Cash', reason: 'Manual', lines: [{ productId: pMan.id, quantityMilli: 1000, unitPricePaisa: 12000 }] })
  assert.throws(() => db.deleteProduct(branchId, pMan.id), /cannot be permanently deleted/)
  assert.equal(db.connection.prepare('SELECT COUNT(*) AS n FROM manual_return_items WHERE product_id=?').get(pMan.id).n, 1)

  // 6. Product with stock_transfer_items (even without any other table if movement deleted in fixture, ensure transfer check triggers)
  const pTrx = db.saveProduct(branchId, productDraft({ name: 'Transfer Item', openingStockMilli: 3000 }))
  db.transfers.dispatch({ branchId, destinationBranchId: 'branch-2', operationId: randomUUID(), note: 'Transfer', lines: [{ productId: pTrx.id, quantityMilli: 1000 }] })
  assert.throws(() => db.deleteProduct(branchId, pTrx.id), /cannot be permanently deleted/)
  assert.equal(db.connection.prepare('SELECT COUNT(*) AS n FROM stock_transfer_items WHERE product_id=?').get(pTrx.id).n, 1)

  // Deactivating preserves everything
  assert.equal(db.toggleProductStatus(branchId, pPur.id), 'inactive')
  assert.equal(db.connection.prepare('SELECT is_active FROM products WHERE id=?').get(pPur.id).is_active, 0)

  // REST parity returns 409 on blocked delete and 200 on clean delete
  server = await createServer({ port: 0, host: '127.0.0.1', databasePath: dbPath, database: db, auth, logger: false })
  const baseUrl = await server.start()
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'owner', password: ownerPassword }),
  })
  const cookie = extractCookie(loginRes)

  const blockedRes = await fetch(`${baseUrl}/api/products/delete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ branchId, id: pPur.id }),
  })
  assert.equal(blockedRes.status, 409)
  const blockedBody = await blockedRes.json()
  assert.match(blockedBody.message, /cannot be permanently deleted/)

  const pFreshRest = db.saveProduct(branchId, productDraft({ name: 'Fresh REST Delete', openingStockMilli: 0 }))
  const cleanRes = await fetch(`${baseUrl}/api/products/delete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ branchId, id: pFreshRest.id }),
  })
  assert.equal(cleanRes.status, 200)
})

test('1.8 createSupplier enforces backend permission, idempotency, opening balance ledger & migration v15 repair', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'vertexia-ph1-sup-'))
  const dbPath = join(dir, 'store.db')
  let db
  let server
  t.after(async () => {
    try { await server?.stop() } catch {}
    try { db?.close() } catch {}
    rmSync(dir, { recursive: true, force: true })
  })

  db = new VertexiaDatabase(dbPath, clock)
  const auth = new AuthRepository(db.connection, clock)
  await auth.setup({ businessName: 'Supplier Shop', branchName: 'Main', city: 'Karachi', ownerName: 'Owner', username: 'owner', password: ownerPassword })
  await auth.createUser({ name: 'Inventory User', username: 'invuser', password: staffPassword, role: 'Inventory', branchIds: [branchId] })

  // Permission enforcement via IPC policy & REST
  auth.logout()
  await auth.login('invuser', staffPassword)
  await auth.changePassword(staffPassword, 'Inventory own pass 2026')
  assert.throws(() => authorizeIpc(auth, db, 'retail:create-supplier', [{ branchId, operationId: randomUUID(), name: 'Blocked Sup', openingBalancePaisa: 10000 }]), /permission/)

  server = await createServer({ port: 0, host: '127.0.0.1', databasePath: dbPath, database: db, auth, logger: false })
  const baseUrl = await server.start()

  const invLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'invuser', password: 'Inventory own pass 2026' }),
  })
  const invCookie = extractCookie(invLogin)
  const forbiddenRes = await fetch(`${baseUrl}/api/retail/create-supplier`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: invCookie },
    body: JSON.stringify({ branchId, operationId: randomUUID(), name: 'Blocked Sup', openingBalancePaisa: 10000 }),
  })
  assert.equal(forbiddenRes.status, 403)

  const ownerLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'owner', password: ownerPassword }),
  })
  const ownerCookie = extractCookie(ownerLogin)
  const opId = randomUUID()
  const supRes1 = await fetch(`${baseUrl}/api/retail/create-supplier`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: ownerCookie },
    body: JSON.stringify({ branchId, operationId: opId, name: 'Jodia Traders', openingBalancePaisa: 10000 }),
  })
  assert.equal(supRes1.status, 200)
  const created1 = await supRes1.json()
  const supRes2 = await fetch(`${baseUrl}/api/retail/create-supplier`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: ownerCookie },
    body: JSON.stringify({ branchId, operationId: opId, name: 'Jodia Traders', openingBalancePaisa: 10000 }),
  })
  assert.equal(supRes2.status, 200)
  assert.deepEqual(await supRes2.json(), created1)

  const ledgerCount = db.connection.prepare("SELECT COUNT(*) AS n FROM supplier_ledger WHERE supplier_id=? AND entry_type='opening_balance'").get(created1.id).n
  assert.equal(ledgerCount, 1)
  db.openPosShift(branchId, 50000)
  const paid = db.retail.paySupplier({ branchId, operationId: randomUUID(), supplierId: created1.id, amountPaisa: 10000, method: 'Cash', reference: 'Paid OB' })
  assert.equal(paid.outstandingPaisa, 0)

  // Verify scopeOperation handles retail:create-supplier
  const ipcArgs = [{ branchId, operationId: 'same-op', name: 'X' }]
  scopeOperation('retail:create-supplier', ipcArgs, 'user-1')
  assert.notEqual(ipcArgs[0].operationId, 'same-op')

  await server.stop()
  db.close()

  // Migration v15 repair idempotency on legacy suppliers
  db = new VertexiaDatabase(dbPath, clock)
  db.connection.prepare('INSERT INTO suppliers(id,business_id,name,phone,is_active,created_at) VALUES (?,?,?,?,1,?)').run('legacy-sup-1', db.businessId, 'Pre-v15 Supplier', null, clock().toISOString())
  db.connection.prepare('INSERT INTO supplier_profiles(supplier_id,opening_balance_paisa) VALUES (?,?)').run('legacy-sup-1', 25000)
  db.connection.exec('PRAGMA user_version = 14')
  db.close()

  db = new VertexiaDatabase(dbPath, clock)
  assert.equal(db.retail.getSnapshot(branchId).suppliers.find(s => s.id === 'legacy-sup-1').outstandingPaisa, 25000)
  assert.equal(db.connection.prepare("SELECT COUNT(*) AS n FROM supplier_ledger WHERE supplier_id='legacy-sup-1' AND entry_type='opening_balance'").get().n, 1)
})

test('1.9 LAN /api/backup/* routes connect to real BackupService and restrict restore to main PC', async t => {
  const settingsSrc = readRepoFile('src/features/settings/SettingsPage.tsx')
  assert.equal(settingsSrc.includes('Take backups from the main PC'), true)

  const dir = mkdtempSync(join(tmpdir(), 'vertexia-ph1-bkp-'))
  const dbPath = join(dir, 'store.db')
  let db
  let server
  t.after(async () => {
    try { await server?.stop() } catch {}
    try { db?.close() } catch {}
    rmSync(dir, { recursive: true, force: true })
  })

  db = new VertexiaDatabase(dbPath, clock)
  const auth = new AuthRepository(db.connection, clock)
  await auth.setup({ businessName: 'Backup Shop', branchName: 'Main', city: 'Karachi', ownerName: 'Owner', username: 'owner', password: ownerPassword })
  await auth.createUser({ name: 'Cashier', username: 'cashier', password: staffPassword, role: 'Cashier', branchIds: [branchId] })
  auth.logout()
  await auth.login('cashier', staffPassword)
  await auth.changePassword(staffPassword, 'Cashier own pass 2026')
  auth.logout()

  server = await createServer({ port: 0, host: '127.0.0.1', databasePath: dbPath, database: db, auth, logger: false })
  const baseUrl = await server.start()

  const ownerLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'owner', password: ownerPassword }),
  })
  const ownerCookie = extractCookie(ownerLogin)

  const st1 = await fetch(`${baseUrl}/api/backup/status`, { headers: { cookie: ownerCookie } })
  assert.equal(st1.status, 200)
  const st1Body = await st1.json()
  assert.equal(st1Body.remoteClient, true)
  assert.equal(st1Body.canRestore, false)
  assert.ok(Array.isArray(st1Body.records))

  const createRes = await fetch(`${baseUrl}/api/backup/create`, {
    method: 'POST',
    headers: { cookie: ownerCookie },
  })
  assert.equal(createRes.status, 200)
  const created = await createRes.json()
  assert.ok(created.sizeBytes > 0, `Expected real SQLite backup sizeBytes > 0, got ${created.sizeBytes}`)
  assert.match(created.checksum, /^[a-f0-9]{64}$/)
  assert.equal(existsSync(created.path), true)

  const dlRes = await fetch(`${baseUrl}/api/backup/download/${created.id}`, { headers: { cookie: ownerCookie } })
  assert.equal(dlRes.status, 200)
  const bytes = new Uint8Array(await dlRes.arrayBuffer())
  assert.equal(Buffer.from(bytes.slice(0, 15)).toString('utf8'), 'SQLite format 3')

  const previewRes = await fetch(`${baseUrl}/api/backup/preview`, { method: 'POST', headers: { cookie: ownerCookie } })
  assert.equal(previewRes.status, 501)
  assert.match((await previewRes.json()).message, /Take backups from the main PC/)

  const cashierLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'cashier', password: 'Cashier own pass 2026' }),
  })
  const cashierCookie = extractCookie(cashierLogin)
  const deniedCreate = await fetch(`${baseUrl}/api/backup/create`, { method: 'POST', headers: { cookie: cashierCookie } })
  assert.equal(deniedCreate.status, 403)
})

test('1.10 /api/auth/status returns allowedTabs across browser refresh', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'vertexia-ph1-auth-'))
  const dbPath = join(dir, 'store.db')
  let db
  let server
  t.after(async () => {
    try { await server?.stop() } catch {}
    try { db?.close() } catch {}
    rmSync(dir, { recursive: true, force: true })
  })

  db = new VertexiaDatabase(dbPath, clock)
  const auth = new AuthRepository(db.connection, clock)
  await auth.setup({ businessName: 'Tab Perm Shop', branchName: 'Main', city: 'Karachi', ownerName: 'Owner', username: 'owner', password: ownerPassword })
  await auth.createUser({ name: 'Custom Cashier', username: 'custom.cashier', password: staffPassword, role: 'Cashier', branchIds: [branchId], allowedTabs: ['POS', 'Sales'] })

  server = await createServer({ port: 0, host: '127.0.0.1', databasePath: dbPath, database: db, auth, logger: false })
  const baseUrl = await server.start()

  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'custom.cashier', password: staffPassword }),
  })
  const cookie = extractCookie(loginRes)

  const statusRes = await fetch(`${baseUrl}/api/auth/status`, { headers: { cookie } })
  assert.equal(statusRes.status, 200)
  const statusJson = await statusRes.json()
  assert.deepEqual(statusJson.session.allowedTabs, ['POS', 'Sales'])
})

test('1.11 legacy browser-mock storage, seeds, and legacyDataAvailable flags are removed', () => {
  for (const legacyFile of [
    'src/app/data/retailData.storage.ts',
    'src/features/products/products.seed.ts',
    'src/features/purchases/purchases.seed.ts',
    'src/features/suppliers/suppliers.seed.ts',
  ]) {
    assert.equal(existsSync(join(process.cwd(), legacyFile)), false, `Legacy seed file should be removed: ${legacyFile}`)
  }
  assert.equal(readRepoFile('src/app/data/retailData.context.ts').includes('legacyDataAvailable'), false)
  assert.equal(readRepoFile('src/app/data/RetailDataProvider.tsx').includes('legacyDataAvailable'), false)
})

test('1.12 CashRepository returns human-readable transaction descriptions & deleteSupplier enforces history/idempotency/audit', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'vertexia-ph1-cash-sup-'))
  const dbPath = join(dir, 'store.db')
  let db
  t.after(() => {
    try { db?.close() } catch {}
    rmSync(dir, { recursive: true, force: true })
  })

  db = new VertexiaDatabase(dbPath, clock)
  const auth = new AuthRepository(db.connection, clock)
  const setupSession = await auth.setup({ businessName: 'Kiryana Mart', branchName: 'Main', city: 'Lahore', ownerName: 'Owner', username: 'owner', password: ownerPassword })
  db.setActor(setupSession.userId)
  db.openPosShift(branchId, 500000, randomUUID(), 'Morning drawer', 'Counter 1')

  const item = db.saveProduct(branchId, productDraft({ name: 'Cooking Oil 1L', openingStockMilli: 5000 }))
  const sale = db.completePosSale({
    branchId,
    operationId: randomUUID(),
    customerId: 'customer-walk-in',
    paymentMethod: 'Cash',
    cashReceivedPaisa: 30000,
    lines: [{ productId: item.id, quantityMilli: 1000, discountBasisPoints: 0 }],
  })

  const supClean = db.retail.createSupplier({ branchId, name: 'Clean Unused Supplier', phone: '03001112222', operationId: randomUUID() })
  const supDue = db.retail.createSupplier({ branchId, name: 'Metro Wholesale', phone: '03003334444', openingBalancePaisa: 15000, operationId: randomUUID() })
  db.retail.paySupplier({ branchId, operationId: randomUUID(), supplierId: supDue.id, amountPaisa: 10000, method: 'Cash', reference: 'REF-100' })

  const cashSnap = db.cash.snapshot(branchId)
  const saleMov = cashSnap.movements.find(m => m.type === 'cash_sale')
  const supMov = cashSnap.movements.find(m => m.type === 'supplier_payment')
  const openMov = cashSnap.movements.find(m => m.type === 'opening_cash')
  assert.ok(saleMov && saleMov.description.includes(sale.invoiceNumber))
  assert.equal(saleMov.description.startsWith('sale-'), false)
  assert.ok(supMov && supMov.description.includes('Metro Wholesale'))
  assert.equal(supMov.description.startsWith('supplier-payment-'), false)
  assert.ok(openMov && openMov.description.includes('Opening Float'))
  assert.equal(saleMov.actorName, 'Owner')

  // Clean supplier with zero history deletes permanently + idempotent replay works
  const delOp = randomUUID()
  assert.deepEqual(db.retail.deleteSupplier({ branchId, operationId: delOp, supplierId: supClean.id }), { deleted: true, archived: false })
  assert.deepEqual(db.retail.deleteSupplier({ branchId, operationId: delOp, supplierId: supClean.id }), { deleted: true, archived: false })
  assert.equal(db.connection.prepare('SELECT COUNT(*) AS n FROM suppliers WHERE id=?').get(supClean.id).n, 0)

  // Supplier with payment/balance blocks permanent delete but allows deactivate + audit row
  assert.throws(() => db.retail.deleteSupplier({ branchId, operationId: randomUUID(), supplierId: supDue.id }), /cannot be permanently deleted/)
  const deact = db.retail.deleteSupplier({ branchId, operationId: randomUUID(), supplierId: supDue.id, deactivateIfHasHistory: true })
  assert.deepEqual(deact, { deleted: false, archived: true })
  assert.equal(db.connection.prepare('SELECT is_active FROM suppliers WHERE id=?').get(supDue.id).is_active, 0)
  const auditCount = db.connection.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE entity_type='supplier' AND entity_id IN (?,?)").get(supClean.id, supDue.id).n
  assert.ok(auditCount >= 2)
})
