export function formatPkr(paisa: number | null | undefined): string {
  const safe = Number.isFinite(Number(paisa)) ? Number(paisa) : 0
  const rupees = safe / 100
  const hasFraction = safe % 100 !== 0
  return `Rs ${rupees.toLocaleString('en-PK', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  })}`
}

export function formatQty(milli: number | null | undefined, unit = ''): string {
  const safe = Number.isFinite(Number(milli)) ? Number(milli) : 0
  const units = safe / 1000
  const formatted = Number.isInteger(units)
    ? units.toLocaleString('en-US')
    : units.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 3 })
  return unit ? `${formatted} ${unit}` : formatted
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return String(iso)
  return date.toLocaleString('en-PK', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatDateShort(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [y, m, d] = dateStr.split('-').map(Number)
    const dt = new Date(Date.UTC(y, m - 1, d))
    return dt.toLocaleDateString('en-PK', { year: 'numeric', month: 'short', day: '2-digit', timeZone: 'UTC' })
  }
  return formatDateTime(dateStr)
}

export function formatRelativeSync(iso: string | null | undefined): { label: string; isStale: boolean } {
  if (!iso) return { label: 'Main PC has never synced to cloud yet', isStale: true }
  const ts = Date.parse(iso)
  if (Number.isNaN(ts)) return { label: String(iso), isStale: false }
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (diffSec < 60) return { label: `${diffSec}s ago`, isStale: false }
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return { label: `${diffMin}m ago`, isStale: diffMin > 10 }
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return { label: `${diffHr}h ago`, isStale: true }
  const diffDays = Math.floor(diffHr / 24)
  return { label: `${diffDays}d ago`, isStale: true }
}

export function formatBytes(bytes: number | null | undefined): string {
  const b = Number(bytes ?? 0)
  if (!Number.isFinite(b) || b <= 0) return '0 B'
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / (1024 * 1024)).toFixed(2)} MB`
}

export function todayKarachiDate(): string {
  return new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10)
}
