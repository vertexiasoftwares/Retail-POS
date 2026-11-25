/**
 * Single configuration source for Vertexia POS customer support details.
 * Update phone, WhatsApp number, or support hours here only.
 */
export const SUPPORT_CONFIG = {
  companyName: 'Vertexia Retail POS',
  supportNumber: '+92 317 2981931',
  whatsappNumber: '+92 317 2981931',
  supportHours: 'Mon to Sat, 10:00 AM to 8:00 PM',
  fallbackVersion: '1.0.0',
} as const

export function getSupportTelHref(numberOverride?: string): string {
  const raw = numberOverride ?? SUPPORT_CONFIG.supportNumber
  return `tel:${raw.replace(/[\s()-]/g, '')}`
}

export function normalizeWhatsAppDigits(numberOverride?: string): string {
  const raw = numberOverride ?? SUPPORT_CONFIG.whatsappNumber
  return raw.replace(/[\s+()-]/g, '')
}

export function buildWhatsAppSupportMessage(params: {
  shopName: string
  appVersion: string
  licenseId: string
  issue?: string
}): string {
  const base =
    `Hello Vertexia Support, I need help with my POS.\n` +
    `Shop: ${params.shopName || 'N/A'}\n` +
    `Version: ${params.appVersion || SUPPORT_CONFIG.fallbackVersion}\n` +
    `License ID: ${params.licenseId || 'Unregistered'}\n` +
    `Issue: `
  return params.issue ? `${base}${params.issue}` : base
}

export function buildWhatsAppSupportUrl(
  params: {
    shopName: string
    appVersion: string
    licenseId: string
    issue?: string
  },
  numberOverride?: string
): string {
  const phone = normalizeWhatsAppDigits(numberOverride)
  const message = buildWhatsAppSupportMessage(params)
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
}

export function formatDbSize(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return 'Unavailable'
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  return `${mb.toFixed(2)} MB`
}

/**
 * Builds clipboard support summary using strictly non-sensitive technical metadata.
 * Never includes customer records, sales data, or passwords.
 */
export function buildSupportClipboardText(info: {
  appVersion: string
  licenseId: string
  deviceId: string
  databaseSizeBytes: number | null
  os: string
}): string {
  return [
    `App Version: ${info.appVersion || SUPPORT_CONFIG.fallbackVersion}`,
    `License ID: ${info.licenseId || 'Unregistered'}`,
    `Device ID: ${info.deviceId || 'N/A'}`,
    `Database Size: ${formatDbSize(info.databaseSizeBytes)}`,
    `OS: ${info.os || 'Unknown'}`,
  ].join('\n')
}

export function formatLicenseExpiry(expiryDate: string | null | undefined): string {
  if (!expiryDate) return 'Lifetime'
  const parsed = new Date(expiryDate)
  if (Number.isNaN(parsed.getTime())) return expiryDate
  return parsed.toLocaleDateString('en-PK', { year: 'numeric', month: 'short', day: 'numeric' })
}
