import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'

export const MEDKIT_SERVER_URL = 'https://iaqevipmygglullkzzsf.supabase.co/functions/v1/medkit-api'
export const MEDKIT_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAko1NXv+rCcEV5i+tiDXiB/wm8HI3hS6nkgGNe5aiLdQ=
-----END PUBLIC KEY-----
`

function hash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function deviceIdFor(publicKey: string, machineId: string): string {
  return hash(`${publicKey}\n${machineId}`)
}

export function decodeSignedReceipt(token: string, publicKeyPem: string = MEDKIT_PUBLIC_KEY): any {
  const parts = String(token || '').split('.')
  if (parts.length !== 2 || parts[0].length > 20000) {
    throw new Error('Invalid license token structure')
  }
  const key = crypto.createPublicKey(publicKeyPem)
  const verified = crypto.verify(null, Buffer.from(parts[0]), key, Buffer.from(parts[1], 'base64url'))
  if (!verified) {
    throw new Error('Invalid license signature')
  }
  const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
  if (payload.version !== 1 || payload.product !== 'medkit-pos') {
    throw new Error('Invalid license product or version')
  }
  return payload
}

function createProof(action: string, payload: any, identity: { publicKey: string; privateKey: string; machineId: string }, now = Date.now()) {
  const body = {
    action,
    payload,
    publicKey: identity.publicKey,
    machineId: identity.machineId,
    timestamp: now,
    nonce: crypto.randomBytes(24).toString('hex'),
  }
  const key = crypto.createPrivateKey(identity.privateKey)
  const signature = crypto.sign(null, Buffer.from(JSON.stringify(body)), key).toString('base64url')
  return { ...body, signature }
}

export function getMachineFingerprint(): string {
  if (process.platform === 'win32') {
    try {
      const result = execFileSync('reg.exe', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid', '/reg:64'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5000,
      })
      const match = result.match(/MachineGuid\s+REG_SZ\s+(\S+)/)
      if (match?.[1]) {
        return hash(match[1].trim().toLowerCase())
      }
    } catch {}
  }
  return hash(`${process.platform}:${os.hostname()}`)
}

export type CloudRegistration = {
  businessId: string
  businessName: string
  ownerName: string
  phone: string
  email?: string
  city: string
  businessType?: string
}

export type CloudLicenseStatus = {
  status: 'ACTIVE' | 'ACTIVATION_REQUIRED' | 'EXPIRED' | 'SUSPENDED' | 'DEVICE_RELEASED' | 'BACKEND_UNAVAILABLE' | 'CLOCK_ERROR'
  accessAllowed: boolean
  businessId?: string
  license_id?: string
  license_type?: 'PERMANENT' | 'DATED'
  expires_at?: string | null
  offline_until?: string | null
  last_verified_at?: string | null
  message: string
  contact?: {
    companyName?: string
    phone?: string
    whatsapp?: string
    email?: string
    instructions?: string
  }
  deviceId: string
  registration?: CloudRegistration | null
}

export class CloudLicenseClient {
  private identity: { publicKey: string; privateKey: string; machineId: string }
  public readonly deviceId: string
  public readonly installationId: string
  private cachePath: string
  private registrationPath: string
  private cache: any = null
  private registration: CloudRegistration | null = null
  public contact = {
    companyName: 'Vertexia',
    phone: '03172981931',
    whatsapp: '923172981931',
    email: 'support@vertexiaagency.com',
    instructions: 'Contact Vertexia on WhatsApp with your Registration ID to purchase or renew your Retail POS license.',
  }

  constructor(private readonly dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true })
    this.cachePath = path.join(dataDir, 'cloud-license-cache.json')
    this.registrationPath = path.join(dataDir, 'cloud-registration.json')

    const identityPath = path.join(dataDir, 'cloud-device.json')
    const machineId = getMachineFingerprint()
    let id: any = null
    try {
      if (fs.existsSync(identityPath)) {
        id = JSON.parse(fs.readFileSync(identityPath, 'utf8'))
      }
    } catch {}

    if (!id || !id.publicKey || !id.privateKey) {
      const keys = crypto.generateKeyPairSync('ed25519')
      id = {
        publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
        privateKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      }
      fs.writeFileSync(identityPath, JSON.stringify(id, null, 2), { mode: 0o600 })
    }

    this.identity = { ...id, machineId }
    this.deviceId = deviceIdFor(id.publicKey, machineId)
    this.installationId = `inst_${this.deviceId.slice(0, 40)}`

    try {
      if (fs.existsSync(this.cachePath)) {
        this.cache = JSON.parse(fs.readFileSync(this.cachePath, 'utf8'))
      }
    } catch {}

    try {
      if (fs.existsSync(this.registrationPath)) {
        this.registration = JSON.parse(fs.readFileSync(this.registrationPath, 'utf8'))
      }
    } catch {}
  }

  public getRegistration(): CloudRegistration | null {
    return this.registration
  }

  public saveRegistration(reg: CloudRegistration) {
    this.registration = reg
    try {
      fs.writeFileSync(this.registrationPath, JSON.stringify(reg, null, 2), 'utf8')
    } catch {}
  }

  private async request(action: string, payload: any) {
    const proof = createProof(action, payload, this.identity)
    const url = `${MEDKIT_SERVER_URL}/license-api/${action}`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(proof),
      signal: AbortSignal.timeout(10000),
    })

    const data: any = await response.json().catch(() => ({}))
    if (!response.ok) {
      const err = new Error(data.message || 'Licensing server rejected the request.')
      ;(err as any).code = data.code
      ;(err as any).status = response.status
      throw err
    }
    return data
  }

  public inspect(): CloudLicenseStatus {
    const base: CloudLicenseStatus = {
      status: 'ACTIVATION_REQUIRED',
      accessAllowed: false,
      deviceId: this.deviceId,
      message: 'Enter the license key supplied by Vertexia.',
      contact: this.contact,
      registration: this.registration,
    }

    if (!this.cache?.receipt) {
      return base
    }

    try {
      const license = decodeSignedReceipt(this.cache.receipt, MEDKIT_PUBLIC_KEY)
      const permanent = license.permanent === true && license.expiresAt === null
      const now = Date.now()

      if (this.registration?.businessId && license.businessId !== this.registration.businessId) {
        throw new Error('License belongs to another business registration')
      }

      if (license.deviceId !== this.deviceId) {
        throw new Error('License belongs to another computer')
      }

      if (license.status !== 'ACTIVE') {
        return {
          ...base,
          status: license.status,
          businessId: license.businessId,
          message: license.status === 'SUSPENDED'
            ? 'Your Retail POS license is suspended. Contact Vertexia.'
            : license.status === 'DEVICE_RELEASED'
            ? "This computer's activation was removed. Contact Vertexia to restore."
            : 'License is not active. Contact Vertexia.',
        }
      }

      if (!permanent && license.expiresAt && now >= license.expiresAt) {
        return {
          ...base,
          status: 'EXPIRED',
          businessId: license.businessId,
          message: 'Your Retail POS license has expired. Contact Vertexia for renewal.',
        }
      }

      if (license.offlineUntil && now >= license.offlineUntil) {
        return {
          ...base,
          status: 'ACTIVATION_REQUIRED',
          businessId: license.businessId,
          message: 'Connect to the internet to verify your license.',
        }
      }

      return {
        ...base,
        status: 'ACTIVE',
        accessAllowed: true,
        businessId: license.businessId,
        license_id: license.licenseId,
        license_type: permanent ? 'PERMANENT' : 'DATED',
        expires_at: permanent ? null : new Date(license.expiresAt).toISOString(),
        offline_until: new Date(license.offlineUntil).toISOString(),
        last_verified_at: new Date(license.issuedAt).toISOString(),
        message: 'License verified and active.',
      }
    } catch {
      return {
        ...base,
        status: 'ACTIVATION_REQUIRED',
        message: 'License requires activation or online verification.',
      }
    }
  }

  public async register(reg: CloudRegistration): Promise<any> {
    this.saveRegistration(reg)
    const result = await this.request('register', {
      businessId: reg.businessId,
      businessName: reg.businessName,
      ownerName: reg.ownerName,
      phone: reg.phone,
      email: reg.email || '',
      city: reg.city,
      businessType: reg.businessType || 'Retail Mart / POS',
    })
    return result
  }

  public async activate(key: string, businessId?: string): Promise<CloudLicenseStatus> {
    const reg = this.registration
    const targetBusinessId = businessId || reg?.businessId
    if (!targetBusinessId) {
      throw new Error('Please complete store registration first.')
    }

    const normalizedKey = key.trim().toUpperCase()
    if (!/^MK-[A-F0-9]{8}(?:-[A-F0-9]{8}){3}$/.test(normalizedKey)) {
      throw new Error('Invalid key format. Expected MK-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX')
    }

    // Ensure business is registered first
    if (reg) {
      try {
        await this.register(reg)
      } catch {}
    }

    const data = await this.request('activate', {
      businessId: targetBusinessId,
      key: normalizedKey,
      deviceName: os.hostname() || 'Retail POS Terminal',
    })

    if (!data.receipt) {
      throw new Error('Licensing server did not return a valid receipt.')
    }

    // Verify receipt immediately
    decodeSignedReceipt(data.receipt, MEDKIT_PUBLIC_KEY)

    this.cache = { receipt: data.receipt, lastSeen: Date.now() }
    fs.writeFileSync(this.cachePath, JSON.stringify(this.cache, null, 2), 'utf8')

    return this.inspect()
  }

  public async refresh(): Promise<CloudLicenseStatus> {
    const reg = this.registration
    if (!reg?.businessId) {
      return this.inspect()
    }

    const data = await this.request('refresh', {
      businessId: reg.businessId,
    })

    if (data.receipt) {
      decodeSignedReceipt(data.receipt, MEDKIT_PUBLIC_KEY)
      this.cache = { receipt: data.receipt, lastSeen: Date.now() }
      fs.writeFileSync(this.cachePath, JSON.stringify(this.cache, null, 2), 'utf8')
    }

    return this.inspect()
  }
}
