import type { ReactNode } from 'react'
import { formatRelativeSync } from '../utils/format'
import { AlertIcon, RefreshIcon } from './Icons'

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="font-display text-xl font-bold tracking-tight text-[#10243f] sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-[#55667d]">{subtitle}</p>}
      </div>
      {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
    </div>
  )
}

export function KpiCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string
  value: string
  hint?: string
  tone?: 'default' | 'accent' | 'success' | 'warning'
}) {
  const toneClass =
    tone === 'accent'
      ? 'border-[#6d4aff]/25 bg-gradient-to-br from-[#6d4aff] to-[#4f2ee6] text-white'
      : tone === 'success'
        ? 'border-emerald-200 bg-white text-[#10243f]'
        : tone === 'warning'
          ? 'border-amber-200 bg-amber-50/70 text-[#10243f]'
          : 'border-[#dce6f4] bg-white text-[#10243f]'
  const labelClass = tone === 'accent' ? 'text-white/80' : 'text-[#55667d]'
  const hintClass = tone === 'accent' ? 'text-white/80' : 'text-[#55667d]'

  return (
    <div className={`rounded-2xl border p-4 shadow-xs ${toneClass}`}>
      <p className={`text-xs font-semibold uppercase tracking-wide ${labelClass}`}>{label}</p>
      <p className="font-display mt-1.5 text-xl font-bold tracking-tight sm:text-2xl">{value}</p>
      {hint && <p className={`mt-1 text-xs ${hintClass}`}>{hint}</p>}
    </div>
  )
}

export function StatusBadge({
  label,
  variant = 'neutral',
}: {
  label: string
  variant?: 'success' | 'warning' | 'danger' | 'neutral' | 'accent'
}) {
  const cls =
    variant === 'success'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : variant === 'warning'
        ? 'bg-amber-50 text-amber-800 border-amber-200'
        : variant === 'danger'
          ? 'bg-rose-50 text-rose-700 border-rose-200'
          : variant === 'accent'
            ? 'bg-[#6d4aff]/10 text-[#5835eb] border-[#6d4aff]/25'
            : 'bg-slate-100 text-slate-700 border-slate-200'

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cls}`}>
      {label}
    </span>
  )
}

export function ErrorBanner({
  message,
  onRetry,
}: {
  message: string | null | undefined
  onRetry?: () => void
}) {
  if (!message) return null
  return (
    <div className="mb-4 flex flex-col gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2.5">
        <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
        <span>{message}</span>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 self-start rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 shadow-xs ring-1 ring-rose-200 hover:bg-rose-100/50"
        >
          <RefreshIcon className="h-3.5 w-3.5" /> Retry
        </button>
      )}
    </div>
  )
}

export function SyncBanner({
  mainPcLastSyncAt,
  onRefresh,
  loading,
}: {
  mainPcLastSyncAt: string | null | undefined
  onRefresh?: () => void
  loading?: boolean
}) {
  const rel = formatRelativeSync(mainPcLastSyncAt)
  return (
    <div
      className={`mb-4 flex flex-col gap-2 rounded-xl border px-4 py-2.5 text-xs sm:flex-row sm:items-center sm:justify-between ${
        rel.isStale
          ? 'border-amber-200 bg-amber-50/80 text-amber-900'
          : 'border-[#dce6f4] bg-white text-[#55667d]'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${rel.isStale ? 'bg-amber-500' : 'bg-emerald-500'}`} />
        <span className="font-semibold text-[#10243f]">Cloud Snapshot:</span>
        <span>Main PC last synced {rel.label}. Remote edits queue safely even if Main PC is switched off.</span>
      </div>
      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex items-center gap-1.5 self-start rounded-lg border border-[#dce6f4] bg-white px-2.5 py-1 text-xs font-semibold text-[#10243f] hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshIcon className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      )}
    </div>
  )
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[#dce6f4] bg-white/70 p-8 text-center">
      <p className="font-display text-sm font-semibold text-[#10243f]">{title}</p>
      <p className="mt-1 text-xs text-[#55667d]">{description}</p>
    </div>
  )
}

export function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#17082b]/55 p-0 backdrop-blur-[2px] sm:items-center sm:p-4">
      <div className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl border border-[#dce6f4] bg-white p-5 shadow-xl sm:max-w-lg sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between border-b border-[#dce6f4] pb-3">
          <h3 className="font-display text-lg font-bold text-[#10243f]">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2.5 py-1 text-sm font-semibold text-[#55667d] hover:bg-slate-100"
          >
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
