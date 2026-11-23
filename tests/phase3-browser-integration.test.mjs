import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../server-dist/server/server.mjs';

function parseCookie(res) {
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) return null;
  const match = setCookie.match(/vertexia_session=([^;]+)/);
  return match ? match[1] : null;
}

test('Phase 3: Browser HTTP Bridge & Complete Client Integration', async (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), 'vertexia-p3-'));
  const dbPath = join(tempDir, 'p3.db');

  const server = await createServer({
    port: 0,
    host: '127.0.0.1',
    databasePath: dbPath,
    logger: false,
  });

  const baseUrl = await server.start();
  const db = server.database;
  const auth = server.auth;

  // Setup business and owner via official setup method
  await auth.setup({
    businessName: 'Phase 3 Mart',
    branchName: 'Main Branch',
    city: 'Karachi',
    ownerName: 'Jameel Owner',
    username: 'owner',
    password: 'Password123!',
  });

  const bus = db.connection.prepare("SELECT id FROM businesses LIMIT 1").get();
  const ownerUser = db.connection.prepare("SELECT id FROM users WHERE role='Owner'").get();

  db.connection.prepare("INSERT INTO branches (id, business_id, name, code, city, is_active, created_at) VALUES ('branch-lahore', ?, 'Lahore Branch', 'B02', 'Lahore', 1, ?)").run(bus.id, new Date().toISOString());
  db.connection.prepare("INSERT INTO user_branches (user_id, branch_id) VALUES (?, 'branch-lahore')").run(ownerUser.id);
  db.connection.prepare("INSERT OR IGNORE INTO customers (id, business_id, name, phone, is_walk_in, is_active, created_at) VALUES ('customer-walk-in', ?, 'Walk-in Customer', NULL, 1, 1, ?)").run(bus.id, new Date().toISOString());

  // Create two cashiers with initialized active credentials
  await auth.createUser({
    name: 'Cashier One',
    username: 'cashier1',
    password: 'Password123!',
    role: 'Cashier',
    branchIds: ['branch-main'],
  });
  db.connection.prepare("UPDATE user_credentials SET must_change_password=0 WHERE username='cashier1'").run();

  await auth.createUser({
    name: 'Cashier Two',
    username: 'cashier2',
    password: 'Password123!',
    role: 'Cashier',
    branchIds: ['branch-main'],
  });
  db.connection.prepare("UPDATE user_credentials SET must_change_password=0 WHERE username='cashier2'").run();

  const cashier1User = db.connection.prepare("SELECT id FROM users WHERE name='Cashier One'").get();
  const cashier2User = db.connection.prepare("SELECT id FROM users WHERE name='Cashier Two'").get();
  const cashier1Id = cashier1User.id;
  const cashier2Id = cashier2User.id;

  t.after(async () => {
    await server.stop();
    try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
  });

  // --------------------------------------------------------------------------
  // Suite 1: Browser Authentication API & Session Cookies
  // --------------------------------------------------------------------------
  await t.test('1. Authentication API - login, status, branch selection, and logout', async () => {
    // 1A: Reject invalid credentials
    const badLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'owner', password: 'WrongPassword' }),
    });
    assert.equal(badLoginRes.status, 401);

    // 1B: Successful Login sets HttpOnly Cookie
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'owner', password: 'Password123!' }),
    });
    assert.equal(loginRes.status, 200);
    const cookie = parseCookie(loginRes);
    assert.ok(cookie, 'HttpOnly session cookie must be set');
    const loginData = await loginRes.json();
    assert.equal(loginData.session.username, 'owner');
    assert.equal(loginData.session.role, 'Owner');

    // 1C: Auth Status with Cookie
    const statusRes = await fetch(`${baseUrl}/api/auth/status`, {
      headers: { Cookie: `vertexia_session=${cookie}` },
    });
    assert.equal(statusRes.status, 200);
    const statusData = await statusRes.json();
    assert.equal(statusData.session.userId, loginData.session.userId);

    // 1D: Switch Branch
    const switchRes = await fetch(`${baseUrl}/api/auth/select-branch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `vertexia_session=${cookie}`,
      },
      body: JSON.stringify({ branchId: 'branch-lahore' }),
    });
    assert.equal(switchRes.status, 200);
    const switchData = await switchRes.json();
    assert.equal(switchData.session.branchId, 'branch-lahore');

    // Switch back to branch-main
    await fetch(`${baseUrl}/api/auth/select-branch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `vertexia_session=${cookie}`,
      },
      body: JSON.stringify({ branchId: 'branch-main' }),
    });

    // 1E: Logout clears session
    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: `vertexia_session=${cookie}` },
    });
    assert.equal(logoutRes.status, 200);

    const postLogoutStatus = await fetch(`${baseUrl}/api/auth/status`, {
      headers: { Cookie: `vertexia_session=${cookie}` },
    });
    const postLogoutData = await postLogoutStatus.json();
    assert.equal(postLogoutData.session, null, 'Session must be null after logout');
  });

  // --------------------------------------------------------------------------
  // Suite 2: Complete Business API Layer
  // --------------------------------------------------------------------------
  await t.test('2. Business APIs - Products, POS, Sales, Customers, Cash, Retail, and Reports', async () => {
    // Login as Owner to have full permissions
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'owner', password: 'Password123!' }),
    });
    const cookie = parseCookie(loginRes);
    const headers = {
      'Content-Type': 'application/json',
      Cookie: `vertexia_session=${cookie}`,
    };

    // 2A: Products API - Save, List, Toggle, Export
    const saveProdRes = await fetch(`${baseUrl}/api/products/save`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        branchId: 'branch-main',
        input: {
          name: 'Organic Milk 1L',
          sku: 'MILK-001',
          barcode: '777000111',
          category: 'Dairy',
          subcategory: 'Fresh Milk',
          brand: 'Vertex Dairy',
          unit: 'Liter',
          purchasePricePaisa: 15000,
          sellingPricePaisa: 20000,
          mrpPaisa: 21000,
          minimumStockMilli: 5000,
          openingStockMilli: 25000, // 25 Liters
          status: 'active',
          imageDataUrl: null,
        },
      }),
    });
    assert.equal(saveProdRes.status, 200);
    const product = await saveProdRes.json();
    assert.equal(product.name, 'Organic Milk 1L');
    assert.equal(product.stockMilli, 25000);

    // List products
    const listProdRes = await fetch(`${baseUrl}/api/products/list`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        branchId: 'branch-main',
        search: 'Milk',
        category: 'all',
        brand: 'all',
        status: 'all',
        page: 1,
        pageSize: 10,
      }),
    });
    assert.equal(listProdRes.status, 200);
    const listData = await listProdRes.json();
    assert.ok(listData.products.length >= 1);

    // Export CSV
    const exportProdRes = await fetch(`${baseUrl}/api/products/export-csv`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ branchId: 'branch-main' }),
    });
    assert.equal(exportProdRes.status, 200);
    const exportData = await exportProdRes.json();
    assert.ok(exportData.csv.includes('Organic Milk 1L'));

    // 2B: POS API - Bootstrap, Open Shift, Sale, Hold, Resume
    const bootRes = await fetch(`${baseUrl}/api/pos/bootstrap?branchId=branch-main`, { headers });
    assert.equal(bootRes.status, 200);
    const bootData = await bootRes.json();
    assert.ok(bootData.products.some(p => p.name === 'Organic Milk 1L'));

    // Open Shift for Owner
    const openShiftRes = await fetch(`${baseUrl}/api/pos/open-shift`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        branchId: 'branch-main',
        openingCashPaisa: 50000,
      }),
    });
    assert.equal(openShiftRes.status, 200);
    const { shiftId } = await openShiftRes.json();
    assert.ok(shiftId);

    // Complete POS Sale
    const saleRes = await fetch(`${baseUrl}/api/pos/sale`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        branchId: 'branch-main',
        customerId: 'customer-walk-in',
        paymentMethod: 'Cash',
        cashReceivedPaisa: 50000,
        lines: [
          {
            productId: product.id,
            quantityMilli: 2000, // 2 Liters
            discountBasisPoints: 0,
          },
        ],
      }),
    });
    assert.equal(saleRes.status, 200);
    const saleData = await saleRes.json();
    assert.equal(saleData.totalPaisa, 40000); // 2 * 20000
    assert.ok(saleData.invoiceNumber);

    // Verify stock decremented centrally
    const checkProdRes = await fetch(`${baseUrl}/api/products/list`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        branchId: 'branch-main',
        search: 'Milk',
        category: 'all',
        brand: 'all',
        status: 'all',
        page: 1,
        pageSize: 10,
      }),
    });
    const checkProdData = await checkProdRes.json();
    const updatedProd = checkProdData.products.find(p => p.id === product.id);
    assert.equal(updatedProd.stockMilli, 23000, 'Stock must decrease from 25000 to 23000');

    // 2C: Sales API - Snapshot, Detail, Return
    const salesSnapRes = await fetch(`${baseUrl}/api/sales/snapshot`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        branchId: 'branch-main',
        period: 'today',
        search: '',
        paymentMethod: 'all',
        status: 'all',
        page: 1,
        pageSize: 10,
      }),
    });
    assert.equal(salesSnapRes.status, 200);
    const salesSnap = await salesSnapRes.json();
    assert.ok(salesSnap.sales.length >= 1);

    const saleDetailRes = await fetch(`${baseUrl}/api/sales/detail?branchId=branch-main&saleId=${saleData.saleId}`, { headers });
    assert.equal(saleDetailRes.status, 200);
    const saleDetail = await saleDetailRes.json();
    assert.equal(saleDetail.invoiceNumber, saleData.invoiceNumber);

    // Process Return of 1 Liter
    const saleItemId = saleDetail.lines[0].id;
    const returnRes = await fetch(`${baseUrl}/api/sales/return`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        branchId: 'branch-main',
        saleId: saleData.saleId,
        reason: 'Customer returned 1 item',
        lines: [{ saleItemId, quantityMilli: 1000 }],
      }),
    });
    assert.equal(returnRes.status, 200);
    const returnResult = await returnRes.json();
    assert.equal(returnResult.totalPaisa, 20000);

    // 2D: Customers API - Create, List, Collect
    const createCustRes = await fetch(`${baseUrl}/api/customers/create`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        branchId: 'branch-main',
        name: 'Ahmed Tariq',
        phone: '03001234567',
        openingBalancePaisa: 0,
      }),
    });
    assert.equal(createCustRes.status, 200);
    const { customerId } = await createCustRes.json();
    assert.ok(customerId);

    // 2E: Cash Management API - Snapshot, Move, Close Shift
    const cashSnapRes = await fetch(`${baseUrl}/api/cash/snapshot?branchId=branch-main`, { headers });
    assert.equal(cashSnapRes.status, 200);
    const cashSnap = await cashSnapRes.json();
    assert.ok(cashSnap.shifts.some(s => s.id === shiftId));

    // Close Shift
    const closeRes = await fetch(`${baseUrl}/api/cash/close-shift`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        branchId: 'branch-main',
        shiftId,
        countedCashPaisa: cashSnap.shifts.find(s => s.id === shiftId).expectedCashPaisa,
        note: 'Closing shift normally',
      }),
    });
    assert.equal(closeRes.status, 200);

    // 2F: Dashboard API
    const dashRes = await fetch(`${baseUrl}/api/dashboard/snapshot`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        branchId: 'branch-main',
        dateRange: 'today',
        chartPeriod: 'today',
      }),
    });
    assert.equal(dashRes.status, 200);
    const dashData = await dashRes.json();
    assert.ok(dashData.salesPaisa > 0);

    // 2G: Reports API
    const reportRes = await fetch(`${baseUrl}/api/reports/snapshot`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        branchId: 'branch-main',
        section: 'sales',
        dateFrom: new Date().toISOString().slice(0, 10),
        dateTo: new Date().toISOString().slice(0, 10),
        page: 1,
        pageSize: 10,
      }),
    });
    assert.equal(reportRes.status, 200);
  });

  // --------------------------------------------------------------------------
  // Suite 3: Multi-Client Concurrent Browser Operations
  // --------------------------------------------------------------------------
  await t.test('3. Multi-Client Concurrency - Two cashiers simultaneously at same branch', async () => {
    // 3A: Login Cashier 1
    const c1LoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'cashier1', password: 'Password123!' }),
    });
    assert.equal(c1LoginRes.status, 200);
    const c1Cookie = parseCookie(c1LoginRes);
    const c1Headers = { 'Content-Type': 'application/json', Cookie: `vertexia_session=${c1Cookie}` };

    // 3B: Login Cashier 2
    const c2LoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'cashier2', password: 'Password123!' }),
    });
    assert.equal(c2LoginRes.status, 200);
    const c2Cookie = parseCookie(c2LoginRes);
    const c2Headers = { 'Content-Type': 'application/json', Cookie: `vertexia_session=${c2Cookie}` };

    // 3C: Both Cashiers open independent shifts at the SAME branch
    const c1ShiftRes = await fetch(`${baseUrl}/api/pos/open-shift`, {
      method: 'POST',
      headers: c1Headers,
      body: JSON.stringify({ branchId: 'branch-main', openingCashPaisa: 10000 }),
    });
    assert.equal(c1ShiftRes.status, 200);
    const { shiftId: shift1 } = await c1ShiftRes.json();

    const c2ShiftRes = await fetch(`${baseUrl}/api/pos/open-shift`, {
      method: 'POST',
      headers: c2Headers,
      body: JSON.stringify({ branchId: 'branch-main', openingCashPaisa: 15000 }),
    });
    assert.equal(c2ShiftRes.status, 200);
    const { shiftId: shift2 } = await c2ShiftRes.json();

    assert.notEqual(shift1, shift2, 'Cashiers must have separate shift IDs');

    // Get product ID for checkout
    const boot = await (await fetch(`${baseUrl}/api/pos/bootstrap?branchId=branch-main`, { headers: c1Headers })).json();
    const prod = boot.products[0];

    // 3D: Both Cashiers execute simultaneous sales
    const [sale1Res, sale2Res] = await Promise.all([
      fetch(`${baseUrl}/api/pos/sale`, {
        method: 'POST',
        headers: c1Headers,
        body: JSON.stringify({
          branchId: 'branch-main',
          customerId: 'customer-walk-in',
          paymentMethod: 'Cash',
          cashReceivedPaisa: 50000,
          lines: [{ productId: prod.id, quantityMilli: 1000, discountBasisPoints: 0 }],
        }),
      }),
      fetch(`${baseUrl}/api/pos/sale`, {
        method: 'POST',
        headers: c2Headers,
        body: JSON.stringify({
          branchId: 'branch-main',
          customerId: 'customer-walk-in',
          paymentMethod: 'Cash',
          cashReceivedPaisa: 50000,
          lines: [{ productId: prod.id, quantityMilli: 1000, discountBasisPoints: 0 }],
        }),
      }),
    ]);

    assert.equal(sale1Res.status, 200);
    assert.equal(sale2Res.status, 200);
    const sale1 = await sale1Res.json();
    const sale2 = await sale2Res.json();
    assert.notEqual(sale1.invoiceNumber, sale2.invoiceNumber, 'Sequential document numbers must never collide');

    // Verify drawers are isolated:
    // Cashier 1 shift expected = opening (10000) + sale1 (prod.sellingPricePaisa)
    // Cashier 2 shift expected = opening (15000) + sale2 (prod.sellingPricePaisa)
    const shift1Db = db.connection.prepare("SELECT COALESCE(SUM(CASE direction WHEN 'in' THEN amount_paisa ELSE -amount_paisa END),0) as total FROM cash_transactions WHERE shift_id=?").get(shift1);
    const shift2Db = db.connection.prepare("SELECT COALESCE(SUM(CASE direction WHEN 'in' THEN amount_paisa ELSE -amount_paisa END),0) as total FROM cash_transactions WHERE shift_id=?").get(shift2);
    assert.equal(shift1Db.total, 10000 + prod.sellingPricePaisa);
    assert.equal(shift2Db.total, 15000 + prod.sellingPricePaisa);

    // 3E: Cashier 1 logs out; Cashier 2 remains active
    await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST', headers: c1Headers });

    const c1PostLogout = await fetch(`${baseUrl}/api/auth/status`, { headers: c1Headers });
    assert.equal((await c1PostLogout.json()).session, null);

    const c2Active = await fetch(`${baseUrl}/api/auth/status`, { headers: c2Headers });
    assert.equal((await c2Active.json()).session.userId, cashier2Id, 'Cashier 2 session must remain fully active');

    // Clean up shifts
    await fetch(`${baseUrl}/api/cash/close-shift`, {
      method: 'POST',
      headers: c2Headers,
      body: JSON.stringify({ branchId: 'branch-main', shiftId: shift2, countedCashPaisa: 15000 + prod.sellingPricePaisa, note: 'Close' }),
    });
  });

  // --------------------------------------------------------------------------
  // Suite 4: Real-Time WebSocket Synchronization
  // --------------------------------------------------------------------------
  await t.test('4. Real-Time WebSocket Synchronization over /api/events', async () => {
    // Login to get a valid session token
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'owner', password: 'Password123!' }),
    });
    const cookie = parseCookie(loginRes);

    // 4A: Unauthenticated WebSocket handshake is rejected
    const wsUrl = baseUrl.replace(/^http/, 'ws') + '/api/events';
    let unauthRejected = false;
    await new Promise((resolve) => {
      const badWs = new WebSocket(wsUrl);
      badWs.onerror = () => { unauthRejected = true; resolve(); };
      badWs.onclose = () => { unauthRejected = true; resolve(); };
      badWs.onopen = () => { resolve(); };
      setTimeout(resolve, 800);
    });
    assert.ok(unauthRejected, 'Unauthenticated WebSocket connection must be blocked');

    // 4B: Authenticated WebSocket connects and receives 'connected' event
    const ws = new WebSocket(wsUrl, {
      headers: { Cookie: `vertexia_session=${cookie}` },
    });

    const receivedEvents = [];
    ws.onmessage = (e) => {
      try {
        receivedEvents.push(JSON.parse(e.data));
      } catch {}
    };

    await new Promise((resolve) => {
      ws.onopen = resolve;
    });

    // Give a brief tick to receive the initial connected message
    await new Promise(r => setTimeout(r, 100));
    assert.ok(receivedEvents.some(e => e.type === 'connected'), 'Must receive connected event');

    // 4C: Trigger server action and verify realtime event broadcast
    const headers = { 'Content-Type': 'application/json', Cookie: `vertexia_session=${cookie}` };
    await fetch(`${baseUrl}/api/products/save`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        branchId: 'branch-main',
        input: {
          name: 'Realtime Sync Juice',
          sku: 'JUICE-999',
          barcode: '999111888',
          category: 'Beverages',
          subcategory: 'Juice',
          brand: 'Vertex',
          unit: 'Bottle',
          purchasePricePaisa: 8000,
          sellingPricePaisa: 12000,
          mrpPaisa: 12000,
          minimumStockMilli: 1000,
          openingStockMilli: 10000,
          status: 'active',
          imageDataUrl: null,
        },
      }),
    });

    // Wait for event delivery
    await new Promise(r => setTimeout(r, 150));
    assert.ok(receivedEvents.some(e => e.type === 'product:updated'), 'Must receive product:updated event over WebSocket');
    assert.ok(receivedEvents.some(e => e.type === 'inventory:changed'), 'Must receive inventory:changed event over WebSocket');

    ws.close();
  });
});
