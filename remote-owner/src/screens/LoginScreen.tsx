import { useEffect, useState, type FormEvent } from 'react'
import { cloudApi, CloudApiError, getSavedCloudUrl, type CloudOwnerSession } from '../services/cloudApi'
import { AlertIcon, KeyIcon } from '../components/Icons'

export function LoginScreen({
  onAuthenticated,
  sessionNotice,
}: {
  onAuthenticated: (session: CloudOwnerSession) => void
  sessionNotice?: string | null
}) {
  const [gatewayUrl, setGatewayUrl] = useState(() => getSavedCloudUrl() || '')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [shopUuid, setShopUuid] = useState('')
  const [showShopField, setShowShopField] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showUrlEditor, setShowUrlEditor] = useState(() => !getSavedCloudUrl())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [healthState, setHealthState] = useState<'checking' | 'online' | 'offline'>('checking')

  useEffect(() => {
    const url = gatewayUrl.trim()
    if (!url) {
      setHealthState('offline')
      return
    }
    let cancelled = false
    setHealthState('checking')
    cloudApi
      .checkHealth(url)
      .then(() => {
        if (!cancelled) setHealthState('online')
      })
      .catch(() => {
        if (!cancelled) setHealthState('offline')
      })
    return () => {
      cancelled = true
    }
  }, [gatewayUrl])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!gatewayUrl.trim()) {
      setError('Enter your Vertexia Cloud API URL.')
      return
    }
    if (!username.trim() || !password) {
      setError('Username and password are required.')
      return
    }
    setLoading(true)
    try {
      const res = await cloudApi.login({
        baseUrl: gatewayUrl.trim(),
        username: username.trim(),
        password,
        shopUuid: shopUuid.trim() || undefined,
      })
      setPassword('')
      onAuthenticated(res.session)
    } catch (err) {
      if (err instanceof CloudApiError && err.statusCode === 409) {
        setShowShopField(true)
      }
      setError(err instanceof Error ? err.message : 'Unable to sign in.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-[#17082b] via-[#220e41] to-[#10243f] px-4 py-8">
      <div className="w-full max-w-md rounded-3xl border border-white/12 bg-white p-6 shadow-2xl sm:p-8">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/retail-pos-icon.png" alt="Vertexia Logo" className="h-11 w-11 rounded-2xl object-contain shadow-sm" />
            <div>
              <h1 className="font-display text-xl font-bold text-[#10243f]">Vertexia Remote Owner</h1>
              <p className="text-xs font-medium text-[#55667d]">Cloud Shop Management Console</p>
            </div>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              healthState === 'online'
                ? 'bg-emerald-50 text-emerald-700'
                : healthState === 'checking'
                  ? 'bg-slate-100 text-slate-600'
                  : 'bg-rose-50 text-rose-700'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                healthState === 'online' ? 'bg-emerald-500' : healthState === 'checking' ? 'bg-slate-400' : 'bg-rose-500'
              }`}
            />
            {healthState === 'online' ? 'Gateway Online' : healthState === 'checking' ? 'Checking...' : 'Unreachable'}
          </span>
        </div>

        {sessionNotice && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs font-medium text-amber-900">
            {sessionNotice}
          </div>
        )}

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-800">
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs font-semibold text-[#10243f]">Cloud Gateway Server</label>
              <button
                type="button"
                onClick={() => setShowUrlEditor(v => !v)}
                className="text-xs font-semibold text-[#6d4aff] hover:text-[#5835eb]"
              >
                {showUrlEditor ? 'Hide URL' : 'Change URL'}
              </button>
            </div>
            {showUrlEditor ? (
              <input
                type="url"
                value={gatewayUrl}
                onChange={e => setGatewayUrl(e.target.value)}
                placeholder="https://your-cloud-api.onrender.com"
                className="w-full rounded-xl border border-[#dce6f4] bg-[#f8fbff] px-3.5 py-2.5 text-sm text-[#10243f] outline-none focus:border-[#6d4aff] focus:ring-2 focus:ring-[#6d4aff]/20"
                required
              />
            ) : (
              <p className="truncate rounded-xl border border-[#dce6f4] bg-[#f8fbff] px-3.5 py-2 text-xs text-[#55667d]">{gatewayUrl}</p>
            )}
          </div>

          <div>
            <label htmlFor="owner-username" className="mb-1 block text-xs font-semibold text-[#10243f]">
              Owner Username
            </label>
            <input
              id="owner-username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="Enter your POS owner username"
              className="w-full rounded-xl border border-[#dce6f4] bg-white px-3.5 py-2.5 text-sm text-[#10243f] outline-none focus:border-[#6d4aff] focus:ring-2 focus:ring-[#6d4aff]/20"
              required
            />
          </div>

          <div>
            <label htmlFor="owner-password" className="mb-1 block text-xs font-semibold text-[#10243f]">
              Password
            </label>
            <div className="relative">
              <input
                id="owner-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter password"
                className="w-full rounded-xl border border-[#dce6f4] bg-white px-3.5 py-2.5 pr-16 text-sm text-[#10243f] outline-none focus:border-[#6d4aff] focus:ring-2 focus:ring-[#6d4aff]/20"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(s => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-[#6d4aff]"
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          {(showShopField || shopUuid) && (
            <div>
              <label htmlFor="shop-uuid" className="mb-1 block text-xs font-semibold text-[#10243f]">
                Shop UUID (disambiguation required)
              </label>
              <input
                id="shop-uuid"
                type="text"
                value={shopUuid}
                onChange={e => setShopUuid(e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className="w-full rounded-xl border border-[#dce6f4] bg-white px-3.5 py-2.5 text-xs font-mono text-[#10243f] outline-none focus:border-[#6d4aff]"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#6d4aff] px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#5835eb] disabled:opacity-60"
          >
            <KeyIcon className="h-4 w-4" />
            {loading ? 'Signing In...' : 'Sign In to Cloud Console'}
          </button>
        </form>

        <p className="mt-5 text-center text-[11px] leading-relaxed text-[#55667d]">
          Works independently of Main PC power status using MongoDB Atlas synced data. Passwords are never saved on this device.
        </p>
      </div>
    </div>
  )
}
