import type { CloudLicenseStatusOutput, CloudRegistrationInput } from '../types/desktop-api'
export type { CloudLicenseStatusOutput, CloudRegistrationInput }

export const MEDKIT_SERVER_URL = 'https://iaqevipmygglullkzzsf.supabase.co/functions/v1/medkit-api'

export const DEFAULT_CONTACT = {
  companyName: 'Vertexia',
  phone: '03172981931',
  whatsapp: '923172981931',
  email: 'support@vertexiaagency.com',
  instructions: 'Contact Vertexia on WhatsApp with your Registration ID to purchase or renew your Retail POS license.',
}

export function createLocalId(prefix: string): string {
  const rand = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2)}`
  return `${prefix}_${rand}`
}

export function getRegistrationIdentity(): { businessId: string; installationId: string; deviceIdentifier: string } {
  try {
    const stored = JSON.parse(localStorage.getItem('vertexiaRegistrationIdentity') || '{}')
    const identity = {
      businessId: stored.businessId || createLocalId('biz_retail'),
      installationId: stored.installationId || createLocalId('inst_retail'),
      deviceIdentifier: stored.deviceIdentifier || createLocalId('device_retail'),
    }
    localStorage.setItem('vertexiaRegistrationIdentity', JSON.stringify(identity))
    return identity
  } catch {
    return {
      businessId: createLocalId('biz_retail'),
      installationId: createLocalId('inst_retail'),
      deviceIdentifier: createLocalId('device_retail'),
    }
  }
}

export function getStoredRegistration(): CloudRegistrationInput | null {
  try {
    const saved = localStorage.getItem('vertexiaRegisteredBusiness')
    return saved ? JSON.parse(saved) : null
  } catch {
    return null
  }
}

export function storeRegistration(reg: CloudRegistrationInput) {
  try {
    localStorage.setItem('vertexiaRegisteredBusiness', JSON.stringify(reg))
  } catch {}
}

// ---------------------------------------------------------------------------
// Browser / WebCrypto direct cloud licensing connection
// ---------------------------------------------------------------------------

function bufferToBase64Url(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function bufferToHex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = new Uint8Array(buffer)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text)
  const hashBuf = await crypto.subtle.digest('SHA-256', data)
  return bufferToHex(hashBuf)
}

let cachedWebKeys: { publicKeyPem: string; privateKey: CryptoKey; machineId: string } | null = null

async function getOrCreateWebIdentity(): Promise<{ publicKeyPem: string; privateKey: CryptoKey; machineId: string }> {
  if (cachedWebKeys) return cachedWebKeys

  try {
    const storedStr = localStorage.getItem('vertexia_web_device_identity')
    if (storedStr) {
      const stored = JSON.parse(storedStr)
      if (stored.publicKeyPem && stored.pkcs8Base64 && stored.machineId) {
        const pkcs8Bytes = Uint8Array.from(atob(stored.pkcs8Base64), c => c.charCodeAt(0))
        const privateKey = await crypto.subtle.importKey('pkcs8', pkcs8Bytes, 'Ed25519', true, ['sign'])
        cachedWebKeys = { publicKeyPem: stored.publicKeyPem, privateKey, machineId: stored.machineId }
        return cachedWebKeys
      }
    }
  } catch {}

  // Generate fresh keypair
  const keyPair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
  const spki = await crypto.subtle.exportKey('spki', keyPair.publicKey)
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)

  const spkiB64 = btoa(String.fromCharCode(...new Uint8Array(spki)))
  const pkcs8B64 = btoa(String.fromCharCode(...new Uint8Array(pkcs8)))
  const publicKeyPem = '-----BEGIN PUBLIC KEY-----\n' + spkiB64 + '\n-----END PUBLIC KEY-----\n'

  let machineSeed = 'browser_terminal_'
  try {
    machineSeed += (navigator.userAgent || '') + (screen?.width || '') + (screen?.height || '')
  } catch {}
  const machineId = await sha256Hex(machineSeed)

  cachedWebKeys = { publicKeyPem, privateKey: keyPair.privateKey, machineId }

  try {
    localStorage.setItem(
      'vertexia_web_device_identity',
      JSON.stringify({ publicKeyPem, pkcs8Base64: pkcs8B64, machineId })
    )
  } catch {}

  return cachedWebKeys
}

export async function postDirectCloudApi(action: string, payload: any): Promise<any> {
  const identity = await getOrCreateWebIdentity()
  const randomBytes = new Uint8Array(24)
  crypto.getRandomValues(randomBytes)
  const nonce = bufferToHex(randomBytes)

  const body = {
    action,
    payload,
    publicKey: identity.publicKeyPem,
    machineId: identity.machineId,
    timestamp: Date.now(),
    nonce,
  }

  const bodyBytes = new TextEncoder().encode(JSON.stringify(body))
  const sigBuffer = await crypto.subtle.sign('Ed25519', identity.privateKey, bodyBytes)
  const signature = bufferToBase64Url(sigBuffer)

  const proof = { ...body, signature }

  const url = `${MEDKIT_SERVER_URL}/license-api/${action}`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(proof),
    signal: AbortSignal.timeout(12000),
  })

  const result = await response.json().catch(() => ({}))
  if (!response.ok) {
    const err = new Error(result.message || `Licensing request to ${action} failed.`)
    ;(err as any).code = result.code
    ;(err as any).status = response.status
    throw err
  }
  return result
}

// ---------------------------------------------------------------------------
// High level client licensing operations
// ---------------------------------------------------------------------------

export async function fetchCloudLicenseStatus(): Promise<CloudLicenseStatusOutput> {
  if (window.vertexia?.cloudLicense) {
    try {
      const status = await window.vertexia.cloudLicense.status()
      return status
    } catch {}
  }

  // Fallback / mock snapshot from localStorage
  const savedLicense = localStorage.getItem('vertexia_cloud_license')
  const reg = getStoredRegistration()
  const identity = getRegistrationIdentity()

  if (savedLicense) {
    try {
      const parsed = JSON.parse(savedLicense)
      return {
        status: parsed.status || 'ACTIVE',
        accessAllowed: parsed.accessAllowed ?? true,
        businessId: parsed.businessId || reg?.businessId || identity.businessId,
        license_id: parsed.license_id || 'MK-RETAIL',
        license_type: parsed.license_type || 'PERMANENT',
        expires_at: parsed.expires_at || null,
        offline_until: parsed.offline_until || null,
        last_verified_at: parsed.last_verified_at || new Date().toISOString(),
        message: parsed.message || 'Retail POS license active.',
        contact: DEFAULT_CONTACT,
        deviceId: identity.deviceIdentifier,
        registration: reg,
      }
    } catch {}
  }

  return {
    status: 'ACTIVATION_REQUIRED',
    accessAllowed: false,
    businessId: reg?.businessId || identity.businessId,
    deviceId: identity.deviceIdentifier,
    message: 'Enter the license key supplied by Vertexia.',
    contact: DEFAULT_CONTACT,
    registration: reg,
  }
}

export async function registerRetailBusiness(input: CloudRegistrationInput): Promise<any> {
  storeRegistration(input)

  let registeredOnline = false
  let lastError: any = null

  // 1. First attempt via Electron main process if running on desktop
  if (window.vertexia?.cloudLicense) {
    try {
      const res = await window.vertexia.cloudLicense.register(input)
      registeredOnline = true
      window.dispatchEvent(new CustomEvent('vertexia:license-changed'))
      return res
    } catch (err: any) {
      lastError = err
      console.warn('Electron cloud registration attempt:', err.message)
    }
  }

  // 2. Direct WebCrypto fetch to Supabase (works in browser & desktop)
  try {
    const cloudRes = await postDirectCloudApi('register', {
      businessId: input.businessId,
      businessName: input.businessName,
      ownerName: input.ownerName,
      phone: input.phone,
      email: input.email || '',
      city: input.city,
      businessType: input.businessType || 'Retail Mart / POS',
    })
    registeredOnline = true
    window.dispatchEvent(new CustomEvent('vertexia:license-changed'))
    return cloudRes
  } catch (err: any) {
    console.error('Direct cloud registration failed:', err)
    if (!registeredOnline && lastError) {
      throw lastError
    }
    if (!registeredOnline) {
      throw err
    }
  }

  window.dispatchEvent(new CustomEvent('vertexia:license-changed'))
  return { success: true, businessId: input.businessId }
}

export async function activateRetailLicense(key: string, businessId?: string): Promise<CloudLicenseStatusOutput> {
  const normalizedKey = key.trim().toUpperCase()
  if (!/^MK-[A-F0-9]{8}(?:-[A-F0-9]{8}){3}$/.test(normalizedKey)) {
    throw new Error('Invalid key format. Expected format: MK-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX')
  }

  const reg = getStoredRegistration()
  const targetBizId = businessId || reg?.businessId || getRegistrationIdentity().businessId

  // Attempt Electron IPC activation
  if (window.vertexia?.cloudLicense) {
    try {
      const result = await window.vertexia.cloudLicense.activate(normalizedKey, targetBizId)
      window.dispatchEvent(new CustomEvent('vertexia:license-changed'))
      return result
    } catch (err: any) {
      console.warn('Electron cloud license activation error:', err.message)
    }
  }

  // Direct WebCrypto activation to Supabase
  try {
    const cloudResult = await postDirectCloudApi('activate', {
      businessId: targetBizId,
      key: normalizedKey,
      deviceName: 'Retail POS Terminal',
    })
    const activeSnapshot: CloudLicenseStatusOutput = {
      status: 'ACTIVE',
      accessAllowed: true,
      businessId: targetBizId,
      license_id: normalizedKey,
      license_type: 'PERMANENT',
      expires_at: null,
      offline_until: new Date(Date.now() + 365 * 86400000).toISOString(),
      last_verified_at: new Date().toISOString(),
      message: 'License verified & activated.',
      contact: cloudResult?.contact || DEFAULT_CONTACT,
      deviceId: getRegistrationIdentity().deviceIdentifier,
      registration: reg,
    }
    localStorage.setItem('vertexia_cloud_license', JSON.stringify(activeSnapshot))
    window.dispatchEvent(new CustomEvent('vertexia:license-changed'))
    return activeSnapshot
  } catch (directErr: any) {
    console.error('Direct cloud activation error:', directErr)
    throw directErr
  }
}

export async function refreshRetailLicense(): Promise<CloudLicenseStatusOutput> {
  if (window.vertexia?.cloudLicense) {
    try {
      const res = await window.vertexia.cloudLicense.refresh()
      window.dispatchEvent(new CustomEvent('vertexia:license-changed'))
      return res
    } catch {}
  }

  const reg = getStoredRegistration()
  const targetBizId = reg?.businessId || getRegistrationIdentity().businessId

  try {
    await postDirectCloudApi('refresh', { businessId: targetBizId })
    window.dispatchEvent(new CustomEvent('vertexia:license-changed'))
  } catch {}

  return fetchCloudLicenseStatus()
}
