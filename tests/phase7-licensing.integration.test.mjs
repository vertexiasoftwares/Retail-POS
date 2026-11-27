import assert from 'node:assert/strict'
import { test } from 'node:test'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import http from 'node:http'

const MEDKIT_DIR = 'D:\\MUSIC 30 oct 26\\medkit 30 sep final'
const hasMedkitRepo = fs.existsSync(path.join(MEDKIT_DIR, 'company', 'licenseAuthority.js'))

test('Phase 7: Retail POS vs Pharmacy POS MedKit licensing product isolation & Fastify enforcement', { skip: !hasMedkitRepo }, async t => {
  const { LicenseAuthority } = await import(pathToFileURL(path.join(MEDKIT_DIR, 'company', 'licenseAuthority.js')).href)
  const { verifyProof, decodeSigned: decodeMedkitSigned } = await import(pathToFileURL(path.join(MEDKIT_DIR, 'services', 'licenseProtocol.js')).href)
  const { LicenseClient: MedkitLicenseClient } = await import(pathToFileURL(path.join(MEDKIT_DIR, 'services', 'licenseClient.js')).href)
  const { CloudLicenseClient, decodeSignedReceipt } = await import('../electron-dist/electron/licensing/cloudClient.mjs')
  const { LicenseClient: RetailLicenseClient } = await import('../electron-dist/electron/licensing/client.mjs')
  const { VertexiaDatabase } = await import('../electron-dist/electron/database/database.mjs')
  const { AuthRepository } = await import('../electron-dist/electron/database/auth.mjs')
  const { createServer } = await import('../server-dist/server/server.mjs')

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vtx-phase7-lic-'))
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }))

  const pair = crypto.generateKeyPairSync('ed25519')
  const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()

  let now = Date.now()
  const authority = new LicenseAuthority({
    databasePath: path.join(tmpDir, 'company-authority.json'),
    privateKey,
    now: () => now,
  })

  // Start lightweight MedKit licensing-compatible HTTP server wrapping real LicenseAuthority
  const licServer = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString('utf8')
    const urlPath = (req.url || '').split('?')[0]
    try {
      if (req.method === 'POST' && urlPath.startsWith('/license-api/')) {
        const action = urlPath.slice('/license-api/'.length)
        const body = raw ? JSON.parse(raw) : {}
        const proof = verifyProof(body, action, now)
        const out = await authority[action](proof.payload, proof)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(out))
        return
      }
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ message: 'Not found' }))
    } catch (err) {
      res.writeHead(err.status || 400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ code: err.code || 'ERROR', message: err.message }))
    }
  })

  await new Promise(resolve => licServer.listen(0, '127.0.0.1', resolve))
  const licUrl = `http://127.0.0.1:${licServer.address().port}`
  t.after(() => new Promise(resolve => licServer.close(resolve)))

  // 1. Register and activate a Pharmacy POS (medkit-pos)
  const pharmClient = new MedkitLicenseClient({
    dataDir: path.join(tmpDir, 'pharmacy-data'),
    config: { serverUrl: licUrl, publicKey, allowLocalhost: true },
    fingerprint: () => '1'.repeat(64),
    now: () => now,
  })
  const pharmReg = {
    businessId: 'biz_pharm_test',
    businessName: 'Al-Shifa Pharmacy',
    ownerName: 'Dr. Ali',
    phone: '+923001112233',
    city: 'Lahore',
    businessType: 'Pharmacy',
  }
  await pharmClient.register(pharmReg)
  const pharmIssued = await authority.issue('biz_pharm_test', { permanent: true, maxDevices: 2 }, 'admin')
  assert.ok(pharmIssued.key.startsWith('MK-'), `Expected MK- key for pharmacy, got ${pharmIssued.key}`)
  const pharmActivated = await pharmClient.activate(pharmReg, pharmIssued.key)
  assert.equal(pharmActivated.accessAllowed, true)
  const pharmReceipt = decodeMedkitSigned(pharmClient.cache.receipt, publicKey, 'medkit-pos')
  assert.equal(pharmReceipt.product, 'medkit-pos')

  // Verify Retail POS rejects Pharmacy signed receipt!
  assert.throws(() => decodeSignedReceipt(pharmClient.cache.receipt, publicKey), /Invalid license product/)

  // 2. Register Retail POS via Fastify /api/cloud-license/register + CloudLicenseClient
  const db = new VertexiaDatabase(':memory:')
  t.after(() => db.close())
  const auth = new AuthRepository(db.connection)
  const owner = await auth.setup({
    businessName: 'Noor Super Mart',
    branchName: 'Main',
    city: 'Karachi',
    ownerName: 'Noor Owner',
    username: 'noor_lic',
    password: 'Password!2026',
  })

  const cloudLicClient = new CloudLicenseClient(path.join(tmpDir, 'retail-data'), {
    serverUrl: licUrl,
    publicKey,
  })
  const protector = { encrypt: v => Buffer.from(v, 'utf8'), decrypt: b => b.toString('utf8') }
  const retailLicClient = new RetailLicenseClient({
    path: path.join(tmpDir, 'retail-data', 'device.bin'),
    trust: null,
    binding: () => db.shopUuid.replace(/-/g, ''),
    protector,
    cloudClient: cloudLicClient,
  })

  const server = await createServer({
    port: 0,
    host: '127.0.0.1',
    database: db,
    auth,
    licenseClient: retailLicClient,
    cloudLicenseClient: cloudLicClient,
    logger: false,
  })
  await server.start()
  t.after(() => server.stop())
  const apiBase = `http://127.0.0.1:${server.app.server.address().port}`

  // Initial status must be ACTIVATION_REQUIRED (never fake ACTIVE!)
  const preStatus = await fetch(`${apiBase}/api/cloud-license/status`).then(r => r.json())
  assert.equal(preStatus.accessAllowed, false)
  assert.equal(preStatus.status, 'ACTIVATION_REQUIRED')

  const retailReg = {
    businessId: 'biz_retail_noor_mart',
    businessName: 'Noor Super Mart',
    ownerName: 'Noor Owner',
    phone: '+923170001122',
    city: 'Karachi',
    businessType: 'Retail Mart / POS',
  }
  const regRes = await fetch(`${apiBase}/api/cloud-license/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(retailReg),
  })
  assert.equal(regRes.status, 200)
  const regJson = await regRes.json()
  assert.equal(regJson.product, 'retail-pos')

  // Check admin customers listing cleanly identifies Retail POS vs Pharmacy POS
  const customers = await authority.customers()
  const retailCust = customers.find(c => c.business_id === 'biz_retail_noor_mart')
  const pharmCust = customers.find(c => c.business_id === 'biz_pharm_test')
  assert.equal(retailCust.product, 'retail-pos')
  assert.equal(pharmCust.product, 'medkit-pos')

  // Admin issues Retail POS key -> VR-...
  const retailIssued = await authority.issue('biz_retail_noor_mart', { permanent: true, maxDevices: 2 }, 'admin')
  assert.ok(retailIssued.key.startsWith('VR-'), `Expected VR- key for Retail POS, got ${retailIssued.key}`)

  // Cross-product enforcement:
  // (a) Pharmacy key cannot activate Retail POS
  const wrongKeyRes = await fetch(`${apiBase}/api/cloud-license/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ businessId: 'biz_retail_noor_mart', key: pharmIssued.key }),
  })
  assert.equal(wrongKeyRes.status, 400)

  // (b) Retail key cannot activate Pharmacy POS
  await assert.rejects(
    pharmClient.activate(pharmReg, retailIssued.key),
    err => err.code === 'PRODUCT_MISMATCH' || /cannot activate/i.test(err.message),
  )

  // (c) Retail POS client cannot activate Pharmacy registration even with Pharmacy key
  const rogueRetailClient = new CloudLicenseClient(path.join(tmpDir, 'rogue-retail'), {
    serverUrl: licUrl,
    publicKey,
  })
  await assert.rejects(
    rogueRetailClient.activate(pharmIssued.key, 'biz_pharm_test'),
    /Pharmacy license keys/,
  )

  // (d) Retail key activates Retail POS cleanly
  const actRes = await fetch(`${apiBase}/api/cloud-license/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ businessId: 'biz_retail_noor_mart', key: retailIssued.key }),
  })
  assert.equal(actRes.status, 200)
  const actJson = await actRes.json()
  assert.equal(actJson.accessAllowed, true)
  assert.equal(actJson.status, 'ACTIVE')

  // Suspend in MedKit authority -> /api/cloud-license/refresh enforces suspension & blocks protected writes
  await authority.manage('biz_retail_noor_mart', { action: 'suspend' }, 'admin')
  const suspRes = await fetch(`${apiBase}/api/cloud-license/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  assert.equal(suspRes.status, 200)
  const suspJson = await suspRes.json()
  assert.equal(suspJson.accessAllowed, false)
  assert.equal(suspJson.status, 'SUSPENDED')

  // Resume -> restores active
  await authority.manage('biz_retail_noor_mart', { action: 'resume' }, 'admin')
  const resumeRes = await fetch(`${apiBase}/api/cloud-license/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  assert.equal(resumeRes.status, 200)
  const resumeJson = await resumeRes.json()
  assert.equal(resumeJson.accessAllowed, true)
  assert.equal(resumeJson.status, 'ACTIVE')
})
