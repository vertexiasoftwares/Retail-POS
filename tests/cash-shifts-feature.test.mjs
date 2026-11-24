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

test('Cash & Shifts Feature Verification', async (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), 'vertexia-cash-test-'));
  const dbPath = join(tempDir, 'cash-test.db');

  const server = await createServer({
    port: 0,
    host: '127.0.0.1',
    databasePath: dbPath,
    logger: false,
  });

  const baseUrl = await server.start();
  const db = server.database;
  const auth = server.auth;

  // Setup business
  await auth.setup({
    businessName: 'Vertexia Cash Mart',
    branchName: 'Main Branch',
    city: 'Karachi',
    ownerName: 'Owner User',
    username: 'owner',
    password: 'Password123!',
  });

  // Create Cashier User
  await auth.createUser({
    name: 'Cashier One',
    username: 'cashier1',
    password: 'Password123!',
    role: 'Cashier',
    branchIds: ['branch-main'],
  });
  db.connection.prepare("UPDATE user_credentials SET must_change_password=0 WHERE username='cashier1'").run();

  t.after(async () => {
    await server.stop();
    try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
  });

  // Login as cashier
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'cashier1', password: 'Password123!' }),
  });
  assert.equal(loginRes.status, 200);
  const cashierCookie = parseCookie(loginRes);
  const cashierHeaders = {
    'Content-Type': 'application/json',
    Cookie: `vertexia_session=${cashierCookie}`,
  };

  // 1. Initial State: No active shift -> Snapshot returns null activeShift and movements
  const snap1 = await fetch(`${baseUrl}/api/cash/snapshot?branchId=branch-main`, { headers: cashierHeaders });
  assert.equal(snap1.status, 200);
  const snapData1 = await snap1.json();
  assert.equal(snapData1.activeShift, null, 'Active shift must be null before opening');

  // 2. Open Shift normally with Counter 1 and note
  const openRes1 = await fetch(`${baseUrl}/api/pos/open-shift`, {
    method: 'POST',
    headers: cashierHeaders,
    body: JSON.stringify({
      branchId: 'branch-main',
      openingCashPaisa: 500000, // Rs. 5,000
      counterId: 'Counter 1',
      note: 'Morning shift',
    }),
  });
  assert.equal(openRes1.status, 200);
  const { shiftId: shift1 } = await openRes1.json();
  assert.ok(shift1);

  // Verify shift record in snapshot
  const snap2 = await fetch(`${baseUrl}/api/cash/snapshot?branchId=branch-main`, { headers: cashierHeaders });
  const snapData2 = await snap2.json();
  assert.equal(snapData2.activeShift.id, shift1);
  assert.equal(snapData2.activeShift.openingCashPaisa, 500000);
  assert.equal(snapData2.activeShift.counterId, 'Counter 1');
  assert.equal(snapData2.activeShift.note, 'Morning shift');

  // 3. Prevent multiple open shifts: Trying to open a second shift for same cashier must fail
  const openRes2 = await fetch(`${baseUrl}/api/pos/open-shift`, {
    method: 'POST',
    headers: cashierHeaders,
    body: JSON.stringify({
      branchId: 'branch-main',
      openingCashPaisa: 300000,
      counterId: 'Counter 2',
    }),
  });
  assert.equal(openRes2.status, 400);
  const err2 = await openRes2.json();
  assert.match(err2.message, /already open/i);

  // 4. Try opening on same counter from another user (owner) -> must fail counter conflict
  const ownerLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'owner', password: 'Password123!' }),
  });
  const ownerCookie = parseCookie(ownerLoginRes);
  const ownerHeaders = {
    'Content-Type': 'application/json',
    Cookie: `vertexia_session=${ownerCookie}`,
  };

  const openCounterConflict = await fetch(`${baseUrl}/api/pos/open-shift`, {
    method: 'POST',
    headers: ownerHeaders,
    body: JSON.stringify({
      branchId: 'branch-main',
      openingCashPaisa: 200000,
      counterId: 'Counter 1', // same counter!
    }),
  });
  assert.equal(openCounterConflict.status, 400);
  const errConflict = await openCounterConflict.json();
  assert.match(errConflict.message, /Counter 1/i);

  // 5. Close Shift 1 with counted cash Rs. 5,000
  const closeRes1 = await fetch(`${baseUrl}/api/cash/close-shift`, {
    method: 'POST',
    headers: cashierHeaders,
    body: JSON.stringify({
      branchId: 'branch-main',
      shiftId: shift1,
      countedCashPaisa: 500000,
      note: 'Reconciled smoothly',
    }),
  });
  assert.equal(closeRes1.status, 200);

  // 6. Verify previous closed shift shows actual closing cash
  const snap3 = await fetch(`${baseUrl}/api/cash/snapshot?branchId=branch-main`, { headers: cashierHeaders });
  const snapData3 = await snap3.json();
  assert.equal(snapData3.activeShift, null);
  const closedShift = snapData3.shifts.find(s => s.id === shift1);
  assert.equal(closedShift.status, 'closed');
  assert.equal(closedShift.countedCashPaisa, 500000);

  // 7. Test Stale Shift Force-Close: Insert an unclosed shift from yesterday
  const yesterday = new Date(Date.now() - 86400000).toISOString();
  db.connection.prepare("INSERT INTO cash_shifts (id, branch_id, cashier_id, opening_cash_paisa, status, opened_at, closed_at, counter_id, note) VALUES ('shift-stale', 'branch-main', ?, 100000, 'open', ?, NULL, 'Counter 2', 'Abandoned shift')").run(snapData2.activeShift.cashierId, yesterday);

  // Cashier opening a shift must now be blocked due to unclosed previous shift
  const openBlockedRes = await fetch(`${baseUrl}/api/pos/open-shift`, {
    method: 'POST',
    headers: cashierHeaders,
    body: JSON.stringify({
      branchId: 'branch-main',
      openingCashPaisa: 200000,
      counterId: 'Counter 1',
    }),
  });
  assert.equal(openBlockedRes.status, 400);
  const errBlocked = await openBlockedRes.json();
  assert.match(errBlocked.message, /Previous shift/i);

  // Manager force-closes the stale shift
  const forceCloseRes = await fetch(`${baseUrl}/api/cash/force-close`, {
    method: 'POST',
    headers: ownerHeaders,
    body: JSON.stringify({
      branchId: 'branch-main',
      shiftId: 'shift-stale',
      reason: 'Cashier forgot to close shift yesterday. Reconciled and verified.',
    }),
  });
  assert.equal(forceCloseRes.status, 200);

  // Now Cashier CAN open a new shift again
  const openRes3 = await fetch(`${baseUrl}/api/pos/open-shift`, {
    method: 'POST',
    headers: cashierHeaders,
    body: JSON.stringify({
      branchId: 'branch-main',
      openingCashPaisa: 500000,
      counterId: 'Counter 1',
    }),
  });
  assert.equal(openRes3.status, 200);
  const { shiftId: shift3 } = await openRes3.json();
  assert.ok(shift3);
});
