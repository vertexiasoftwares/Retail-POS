import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { AuthSession, AuthStatus } from '../../types/auth'
import { canAccessPage } from '../../shared/auth-policy'
import './auth.css'
import { AuthContext, type AuthValue } from './auth.context'
import { LoginPage } from './LoginPage'
import { RegisterPage } from './RegisterPage'
import { LicenseActivation } from './LicenseActivation'

type AuthView = 'login' | 'register' | 'activate'

function PasswordChange({
  session,
  acceptSession,
}: {
  session: AuthSession
  acceptSession: (session: AuthSession) => void
}) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  return (
    <form
      className="auth-card"
      onSubmit={async event => {
        event.preventDefault()
        if (busy) return
        if (next !== confirm) {
          setError('New passwords do not match.')
          return
        }
        setBusy(true)
        setError('')
        try {
          acceptSession(await window.vertexia!.auth.changePassword(current, next))
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Password could not be changed.')
        } finally {
          setBusy(false)
        }
      }}
    >
      <span className="auth-eyebrow">{session.businessName}</span>
      <h1>Set your own password</h1>
      <p>{session.name}, change your temporary password to continue.</p>
      <fieldset disabled={busy}>
        <label>
          Temporary password
          <input
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={event => setCurrent(event.target.value)}
          />
        </label>
        <label>
          New password
          <input
            name="newPassword"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
            required
            value={next}
            onChange={event => setNext(event.target.value)}
          />
        </label>
        <label>
          Confirm new password
          <input
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={event => setConfirm(event.target.value)}
          />
        </label>
        <small>Use 8–128 characters.</small>
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        <button className="auth-btn-primary">{busy ? 'Updating…' : 'Save password and continue'}</button>
        <button
          type="button"
          className="auth-btn-secondary"
          onClick={() =>
            void window
              .vertexia!.auth.logout()
              .then(() => window.dispatchEvent(new Event('vertexia:auth-refresh')))
          }
        >
          Sign out
        </button>
      </fieldset>
    </form>
  )
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [error, setError] = useState('')
  const [view, setView] = useState<AuthView>('login')

  const refresh = useCallback(async () => {
    if (!window.vertexia?.auth) {
      setError('Start the desktop app with npm run dev:desktop to connect to your local database.')
      return
    }
    try {
      const s = await window.vertexia.auth.status()
      setStatus(s)
      setError('')
      if (s.needsSetup) {
        setView('register')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load sign in.')
    }
  }, [])

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0)
    const timer = window.setInterval(() => void refresh(), 30000)
    const expire = () => {
      setStatus(value => (value ? { ...value, session: null } : value))
      void refresh()
    }
    const unsubscribe = window.vertexia?.auth?.onSessionExpired(expire)
    const focus = () => void refresh()
    window.addEventListener('focus', focus)
    window.addEventListener('vertexia:auth-refresh', focus)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(timer)
      unsubscribe?.()
      window.removeEventListener('focus', focus)
      window.removeEventListener('vertexia:auth-refresh', focus)
    }
  }, [refresh])

  const acceptSession = (session: AuthSession) =>
    setStatus(value => ({
      needsSetup: false,
      businessName: value?.businessName === session.businessName ? value.businessName : session.businessName,
      session,
    }))

  const session = status?.session ?? null
  const value: AuthValue = {
    session,
    can: permission => Boolean(session?.permissions.includes(permission)),
    canPage: page => canAccessPage(page, session?.permissions ?? []),
    acceptSession,
    logout: async () => {
      await window.vertexia!.auth.logout()
      setStatus(current => (current ? { ...current, session: null } : current))
    },
    selectBranch: async id => acceptSession(await window.vertexia!.auth.selectBranch(id)),
  }

  if (!status || !session || session.mustChangePassword) {
    if (!status) {
      return (
        <main className="auth-screen">
          <section className="auth-card">
            <h1>Vertexia Retail POS</h1>
            <p role={error ? 'alert' : 'status'}>{error || 'Loading your retail store records…'}</p>
            {error && (
              <button className="auth-btn-primary" onClick={() => void refresh()}>
                Retry
              </button>
            )}
          </section>
        </main>
      )
    }

    if (session?.mustChangePassword) {
      return (
        <main className="auth-screen">
          <PasswordChange key={session.userId} session={session} acceptSession={acceptSession} />
        </main>
      )
    }

    if (view === 'register') {
      return (
        <RegisterPage
          onSuccess={() => {
            void refresh()
            setView('activate')
          }}
          onNavigateToLogin={() => setView('login')}
          onNavigateToActivate={() => setView('activate')}
        />
      )
    }

    if (view === 'activate') {
      return (
        <LicenseActivation
          onSuccess={() => {
            void refresh()
            setView('login')
          }}
          onNavigateToLogin={() => setView('login')}
          onNavigateToRegister={() => setView('register')}
        />
      )
    }

    // Default to login view
    return (
      <LoginPage
        businessName={status.businessName}
        onSuccess={acceptSession}
        onNavigateToRegister={() => setView('register')}
        onNavigateToActivate={() => setView('activate')}
      />
    )
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
