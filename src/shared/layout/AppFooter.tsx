import { useEffect, useState } from 'react'
import { useAuth } from '../../app/auth/useAuth'

export function AppFooter() {
  const { session } = useAuth()
  const [time, setTime] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const currentBranch = session?.branches.find(b => b.id === session.branchId)

  return (
    <footer className="app-pos-footer" aria-label="System status bar">
      <div className="footer-status-left">
        <span className="live-status-pulse" />
        <span className="system-status-text">
          <strong>Vertexia Engine Active</strong>
          <small className="hidden sm:inline"> &middot; Offline Ready</small>
        </span>
      </div>

      <div className="footer-shortcuts-center">
        <span className="shortcut-badge">
          <kbd>F2</kbd> <span>POS Sale</span>
        </span>
        <span className="shortcut-badge">
          <kbd>Ctrl+K</kbd> <span>Search</span>
        </span>
        <span className="shortcut-badge">
          <kbd>Ctrl+Wheel</kbd> <span>Zoom</span>
        </span>
      </div>

      <div className="footer-meta-right">
        <span className="branch-meta-badge">
          {session?.businessName || 'Vertexia Mart'} &bull; {currentBranch?.name || 'Main Branch'}
        </span>
        <time className="footer-clock">
          {time.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </time>
      </div>
    </footer>
  )
}
