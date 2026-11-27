import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  cloudApi,
  getSavedCloudUrl,
  type BackupRecord,
  type CloudOwnerSession,
  type ConflictRecord,
  type SyncStatusPayload,
} from '../services/cloudApi'
import { formatBytes, formatDateTime, formatRelativeSync } from '../utils/format'
import { DownloadIcon, RefreshIcon } from '../components/Icons'
import { EmptyState, ErrorBanner, KpiCard, PageHeader, StatusBadge } from '../components/UiPrimitives'

export function SyncStatusScreen({ refreshTick, wsState }: { refreshTick: number; wsState: string }) {
  const [status, setStatus] = useState<SyncStatusPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await cloudApi.getSyncStatus()
      setStatus(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sync status.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshTick])

  return (
    <div>
      <PageHeader
        title="Cloud Sync Status & Installation Health"
        subtitle={`Realtime channel: ${wsState} • Shop UUID ${status?.shopUuid || '...'}`}
        action={
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[#dce6f4] bg-white px-3.5 py-2 text-xs font-semibold text-[#10243f] hover:bg-slate-50"
          >
            <RefreshIcon className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh Status
          </button>
        }
      />
      <ErrorBanner message={error} onRetry={load} />

      {status && (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard label="Processed Main PC Events" value={String(status.processedEventsCount)} hint={`Last: ${formatDateTime(status.lastProcessedAt)}`} />
            <KpiCard label="Cloud Owner Events" value={String(status.cloudOwnerEventsCount)} hint={`Cursor seq #${status.latestCloudSeq}`} />
            <KpiCard
              tone={status.conflictsCount > 0 ? 'warning' : 'success'}
              label="Recorded Conflicts"
              value={String(status.conflictsCount)}
              hint="Auto-resolved cleanly in ledger"
            />
            <KpiCard label="Registered Nodes" value={String(status.installations.length)} hint={`WebSocket: ${wsState}`} />
          </div>

          <div className="overflow-hidden rounded-2xl border border-[#dce6f4] bg-white shadow-xs">
            <div className="border-b border-[#dce6f4] px-4 py-3">
              <h2 className="font-display text-sm font-bold text-[#10243f]">Registered Shop Nodes</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-[#dce6f4] bg-[#f8fbff] text-xs font-semibold uppercase text-[#55667d]">
                  <tr>
                    <th className="px-4 py-3">Device Name</th>
                    <th className="px-4 py-3">Node ID</th>
                    <th className="px-4 py-3">Version</th>
                    <th className="px-4 py-3">Last Sync</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#edf2fa]">
                  {status.installations.map(inst => {
                    const rel = formatRelativeSync(inst.lastSyncAt)
                    return (
                      <tr key={inst.nodeId}>
                        <td className="px-4 py-3 font-semibold text-[#10243f]">{inst.deviceName}</td>
                        <td className="px-4 py-3 font-mono text-xs text-[#55667d]">{inst.nodeId}</td>
                        <td className="px-4 py-3 text-xs">v{inst.appVersion}</td>
                        <td className="px-4 py-3 text-xs text-[#55667d]">
                          {rel.label} ({formatDateTime(inst.lastSyncAt)})
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge variant={inst.status === 'active' ? 'success' : 'danger'} label={inst.status} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export function ConflictsScreen({ refreshTick }: { refreshTick: number }) {
  const [conflicts, setConflicts] = useState<ConflictRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await cloudApi.getConflicts()
      setConflicts(res.conflicts)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conflicts.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshTick])

  return (
    <div>
      <PageHeader
        title="Sync Conflicts Audit Trail"
        subtitle="Non-destructive stock clamps and version arbitration are logged here automatically"
      />
      <ErrorBanner message={error} onRetry={load} />

      {!loading && conflicts.length === 0 ? (
        <EmptyState title="Zero sync conflicts recorded" description="All Main PC and Cloud Owner events reconciled cleanly." />
      ) : (
        <div className="space-y-3">
          {conflicts.map(c => (
            <div key={c.id} className="rounded-2xl border border-amber-200 bg-white p-4 shadow-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <StatusBadge variant="warning" label={c.conflict_type} />
                  <span className="font-semibold text-sm text-[#10243f]">
                    {c.entity_type} • {c.entity_id}
                  </span>
                </div>
                <span className="text-xs text-[#55667d]">{formatDateTime(c.resolved_at)}</span>
              </div>
              <div className="mt-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                <p className="rounded-lg bg-[#f8fbff] p-2">
                  <strong>Local:</strong> {c.local_summary}
                </p>
                <p className="rounded-lg bg-[#f8fbff] p-2">
                  <strong>Cloud:</strong> {c.cloud_summary}
                </p>
                <p className="rounded-lg bg-emerald-50 p-2 text-emerald-900">
                  <strong>Resolution:</strong> {c.resolution}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function BackupsScreen({ refreshTick }: { refreshTick: number }) {
  const [records, setRecords] = useState<BackupRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [busyFile, setBusyFile] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await cloudApi.listBackups()
      setRecords(res.records)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to list cloud backups.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshTick])

  async function handleCreate() {
    setCreating(true)
    setError(null)
    setNotice(null)
    try {
      const res = await cloudApi.createBackup()
      setNotice(`Cloud backup created: ${res.fileName} (${formatBytes(res.sizeBytes)})`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create cloud backup.')
    } finally {
      setCreating(false)
    }
  }

  async function handleVerify(fileName: string) {
    setBusyFile(fileName)
    setError(null)
    setNotice(null)
    try {
      const res = await cloudApi.verifyBackup(fileName)
      if (res.valid) {
        setNotice(`Checksum VERIFIED for ${fileName} (SHA-256: ${res.checksum.slice(0, 16)}...).`)
      } else {
        setError(`Checksum mismatch on ${fileName}.`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backup verification failed.')
    } finally {
      setBusyFile(null)
    }
  }

  async function handleDownload(fileName: string) {
    setBusyFile(fileName)
    setError(null)
    try {
      await cloudApi.downloadBackup(fileName)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed.')
    } finally {
      setBusyFile(null)
    }
  }

  return (
    <div>
      <PageHeader
        title="Cloud Tenant Backups"
        subtitle="SHA-256 verified JSON archives stored in MongoDB Atlas"
        action={
          <button
            type="button"
            disabled={creating}
            onClick={handleCreate}
            className="rounded-xl bg-[#6d4aff] px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-[#5835eb] disabled:opacity-50"
          >
            {creating ? 'Creating Snapshot...' : '+ Create Cloud Backup'}
          </button>
        }
      />

      <div className="mb-4 rounded-xl border border-[#dce6f4] bg-white px-4 py-3 text-xs text-[#55667d]">
        <strong className="text-[#10243f]">Backup &amp; Restore Scope:</strong> Cloud backups store a verified snapshot of synced tenant collections inside MongoDB Atlas so backups persist across container restarts. Full SQLite point-in-time restore onto the Shop Main PC remains Main PC desktop-only for local fiscal safety.
      </div>

      {notice && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-800">
          {notice}
        </div>
      )}
      <ErrorBanner message={error} onRetry={load} />

      {!loading && records.length === 0 ? (
        <EmptyState title="No cloud backups generated yet" description="Click Create Cloud Backup to generate your first SHA-256 snapshot." />
      ) : (
        <div className="space-y-3">
          {records.map(rec => (
            <div key={rec.fileName} className="flex flex-col gap-3 rounded-2xl border border-[#dce6f4] bg-white p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate font-mono text-xs font-bold text-[#10243f]">{rec.fileName}</p>
                <p className="mt-1 text-xs text-[#55667d]">
                  {formatBytes(rec.sizeBytes)} • Created {formatDateTime(rec.createdAt)}
                </p>
                {rec.checksum && (
                  <p className="mt-0.5 truncate font-mono text-[11px] text-[#55667d]">SHA-256: {rec.checksum}</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busyFile === rec.fileName}
                  onClick={() => handleVerify(rec.fileName)}
                  className="rounded-xl border border-[#dce6f4] px-3 py-1.5 text-xs font-semibold text-[#10243f] hover:bg-slate-50 disabled:opacity-50"
                >
                  Verify Integrity
                </button>
                <button
                  type="button"
                  disabled={busyFile === rec.fileName}
                  onClick={() => handleDownload(rec.fileName)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#6d4aff]/10 px-3 py-1.5 text-xs font-semibold text-[#5835eb] hover:bg-[#6d4aff]/20 disabled:opacity-50"
                >
                  <DownloadIcon className="h-3.5 w-3.5" /> Download JSON
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function AccountSettingsScreen({
  session,
  onLogout,
}: {
  session: CloudOwnerSession
  onLogout: () => Promise<void>
}) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('New password confirmation does not match.')
      return
    }
    setSaving(true)
    try {
      const res = await cloudApi.changePassword(currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setNotice(
        `Password updated to credential v${res.credentialVersion}. Other remote sessions have been signed out, and the salted scrypt hash is queued to synchronize cleanly to the Shop Main PC.`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password change failed.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl">
      <PageHeader title="Account & Security Settings" subtitle="Changes your password on Cloud AND syncs securely to Main PC" />
      <ErrorBanner message={error} />
      {notice && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-800">
          {notice}
        </div>
      )}

      <div className="mb-5 rounded-2xl border border-[#dce6f4] bg-white p-5 shadow-xs">
        <h2 className="font-display mb-3 text-base font-bold text-[#10243f]">Active Session Identity</h2>
        <dl className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-[#55667d]">Signed-in Owner</dt>
            <dd className="mt-0.5 font-semibold text-[#10243f]">
              {session.name} (@{session.username})
            </dd>
          </div>
          <div>
            <dt className="text-[#55667d]">Role</dt>
            <dd className="mt-0.5">
              <StatusBadge variant="accent" label={session.role} />
            </dd>
          </div>
          <div>
            <dt className="text-[#55667d]">Shop UUID</dt>
            <dd className="mt-0.5 font-mono text-[#10243f]">{session.shopUuid}</dd>
          </div>
          <div>
            <dt className="text-[#55667d]">Connected Gateway</dt>
            <dd className="mt-0.5 truncate text-[#10243f]">{getSavedCloudUrl()}</dd>
          </div>
        </dl>
      </div>

      <div className="rounded-2xl border border-[#dce6f4] bg-white p-5 shadow-xs">
        <h2 className="font-display mb-1 text-base font-bold text-[#10243f]">Change Owner Password</h2>
        <p className="mb-4 text-xs text-[#55667d]">
          Uses salted scrypt hashing (zero plaintext transmitted or stored in sync outbox).
        </p>

        <form onSubmit={handleChangePassword} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold">Current Password</label>
            <input
              required
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              className="w-full rounded-xl border border-[#dce6f4] px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold">New Password (8–128 chars)</label>
            <input
              required
              type="password"
              minLength={8}
              maxLength={128}
              autoComplete="new-password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              className="w-full rounded-xl border border-[#dce6f4] px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold">Confirm New Password</label>
            <input
              required
              type="password"
              minLength={8}
              maxLength={128}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              className="w-full rounded-xl border border-[#dce6f4] px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-[#6d4aff] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#5835eb] disabled:opacity-50"
            >
              {saving ? 'Updating Password...' : 'Update & Sync Password'}
            </button>
            <button
              type="button"
              onClick={() => void onLogout()}
              className="rounded-xl border border-rose-200 px-4 py-2.5 text-xs font-semibold text-rose-700 hover:bg-rose-50"
            >
              Sign Out of This Device
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
