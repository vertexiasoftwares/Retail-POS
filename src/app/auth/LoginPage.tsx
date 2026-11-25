import { useState, type FormEvent } from 'react'
import { Icon } from '../../shared/ui/Icon'
import type { AuthSession } from '../../types/auth'

type LoginPageProps = {
  businessName?: string
  onSuccess: (session: AuthSession) => void
  onNavigateToRegister: () => void
  onNavigateToActivate: () => void
}

export function LoginPage({
  businessName,
  onSuccess,
  onNavigateToRegister,
  onNavigateToActivate,
}: LoginPageProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const displayBusinessName = businessName?.trim() || 'your retail mart'

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setError('')
    setBusy(true)

    try {
      if (!window.vertexia?.auth) {
        throw new Error('Desktop core is starting up. Please try again.')
      }
      const session = await window.vertexia.auth.login(username.trim(), password)
      onSuccess(session)
    } catch (err: any) {
      setError(err?.message || 'Invalid username or password. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative flex min-h-[var(--app-viewport-height,100vh)] w-full overflow-hidden bg-[#f8fafc] font-sans text-slate-900">
      {/* Left Side: Clean Deep Dark Branding (Like Pharmacy POS - themed in Retail POS Purple) */}
      <div
        className="relative hidden w-1/2 flex-col items-center justify-center overflow-hidden p-12 lg:flex select-none"
        style={{ background: 'linear-gradient(165deg, #240a3f 0%, #17072a 52%, #0e031a 100%)' }}
      >
        {/* Subtle Background Pattern Outlines */}
        <div className="absolute inset-0 opacity-15 pointer-events-none">
          <div className="absolute -left-16 -top-16 h-72 w-72 rounded-full border border-[#5E0CF3]/30" />
          <div className="absolute -bottom-28 -right-20 h-96 w-96 rounded-full border border-[#8238f7]/20" />
          <div className="absolute right-16 top-24 text-[#5E0CF3]/20">
            <Icon name="cart" size={88} />
          </div>
          <div className="absolute bottom-20 left-16 text-[#5E0CF3]/20">
            <Icon name="box" size={100} />
          </div>
        </div>

        <div className="relative z-10 flex max-w-lg flex-col items-center text-center">
          {/* Logo Area (Transparent Brand Logo - No white background box) */}
          <div className="mb-12 flex items-center gap-3">
            <img
              src="/retail-logo-transparent.png"
              alt="Vertexia Retail POS"
              className="h-11 w-auto max-w-[50px] object-contain filter drop-shadow-[0_4px_16px_rgba(168,117,255,0.4)]"
            />
            <h1 className="text-2xl font-bold tracking-tight text-white font-heading">
              Vertexia <span className="text-[#a875ff]">POS</span>
            </h1>
          </div>

          {/* Isometric-style 3D Composition (Pharmacy POS Match, Purple Themed) */}
          <div className="relative h-72 w-96">
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="relative scale-90">
                {/* Base Platform */}
                <div className="h-32 w-64 rotate-12 rounded-2xl border border-[#5E0CF3]/30 bg-[#2d1154] shadow-2xl" />

                {/* Store Icon floating above */}
                <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-[120%]">
                  <Icon name="store" size={120} className="text-[#b18aff] drop-shadow-2xl" />
                </div>

                {/* Floating Elements */}
                <div
                  className="absolute top-0 right-0 transform -translate-y-20 translate-x-10 animate-bounce"
                  style={{ animationDuration: '3s' }}
                >
                  <div className="rounded-xl bg-white p-3 shadow-xl">
                    <Icon name="cart" size={24} className="text-[#5E0CF3]" />
                  </div>
                </div>

                <div
                  className="absolute bottom-0 left-0 transform translate-y-10 -translate-x-10 animate-bounce"
                  style={{ animationDuration: '4s' }}
                >
                  <div className="rounded-xl bg-white p-3 shadow-xl">
                    <Icon name="box" size={24} className="text-[#5E0CF3]" />
                  </div>
                </div>

                <div className="absolute top-1/2 left-0 transform -translate-x-16 -translate-y-10 animate-pulse">
                  <div className="rounded-xl border border-[#5E0CF3]/35 bg-[#381566] p-4 shadow-lg">
                    <Icon name="shieldCheck" size={32} className="text-[#cbb9e8]" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom Clean Tagline */}
          <div className="mt-6">
            <h3 className="text-base font-semibold text-white/90 tracking-tight font-heading">
              Enterprise Retail & Inventory System
            </h3>
            <p className="mt-1.5 text-xs text-[#d8c5ff]/70 max-w-sm leading-relaxed">
              High-speed checkout, barcode scanning, real-time stock transfers, and multi-terminal synchronization.
            </p>
          </div>
        </div>
      </div>

      {/* Right Side: Clean Login Form Side */}
      <div className="flex w-full items-center justify-center px-6 py-10 sm:px-12 lg:w-1/2 lg:px-20 bg-[#f8fafc]">
        <div className="w-full max-w-md py-4">
          <div className="mb-8">
            <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-xl bg-[#efe7ff] text-[#5E0CF3] lg:hidden">
              <Icon name="store" size={20} />
            </div>
            <p className="mb-2 inline-block rounded-full bg-[#efe7ff] px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-[#5E0CF3] font-heading">
              Secure access
            </p>
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 font-heading">
              Welcome back
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              Sign in to manage {displayBusinessName} with confidence.
            </p>
          </div>

          {error && (
            <div className="mb-5 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-sm text-rose-700">
              <Icon name="warning" size={18} className="shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <div className="relative">
                <input
                  type="text"
                  name="username"
                  required
                  autoComplete="username"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  disabled={busy}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-slate-800 outline-none transition-all placeholder:text-slate-400 focus:border-[#5E0CF3] focus:bg-white focus:ring-4 focus:ring-[#5E0CF3]/15 font-body text-sm"
                  placeholder="Username"
                />
              </div>
            </div>

            <div>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  disabled={busy}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3.5 pl-4 pr-12 text-slate-800 outline-none transition-all placeholder:text-slate-400 focus:border-[#5E0CF3] focus:bg-white focus:ring-4 focus:ring-[#5E0CF3]/15 font-body text-sm"
                  placeholder="Password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-1 cursor-pointer"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  <Icon name={showPassword ? 'eyeOff' : 'eye'} size={20} />
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={busy}
              style={{ color: '#ffffff' }}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#5E0CF3] py-3.5 text-sm font-bold uppercase tracking-wide !text-white shadow-lg shadow-[#5E0CF3]/25 transition-all hover:bg-[#5113ce] active:bg-[#430cb8] active:scale-[0.98] disabled:opacity-70 cursor-pointer font-heading"
            >
              <span style={{ color: '#ffffff' }}>{busy ? 'Signing In...' : 'Sign In'}</span>
            </button>
          </form>

          <button
            type="button"
            onClick={onNavigateToActivate}
            style={{ color: '#ffffff' }}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#6d4aff] to-[#5E0CF3] py-3.5 text-sm font-bold !text-white shadow-lg shadow-[#5E0CF3]/25 transition-all hover:from-[#5e38e8] hover:to-[#4e07d0] active:scale-[0.98] cursor-pointer font-body"
          >
            <Icon name="key" size={18} className="text-white" />
            <span style={{ color: '#ffffff' }}>Activate POS License</span>
          </button>

          <button
            type="button"
            onClick={onNavigateToRegister}
            className="mt-6 block w-full text-center text-sm font-semibold text-[#5E0CF3] hover:text-[#5113ce] transition-colors cursor-pointer font-body"
          >
            New business? <strong>Register & Set up Account</strong>
          </button>
        </div>
      </div>
    </div>
  )
}
