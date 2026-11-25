import { useEffect, useState, type ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { AppFooter } from './AppFooter'

export type PageProps = {
  onNavigate: (page: string) => void
}

type PageShellProps = PageProps & {
  activePage: string
  className?: string
  header: (onMenu: () => void) => ReactNode
  children: ReactNode
}

export function PageShell({ activePage, className = '', header, children, onNavigate }: PageShellProps) {
  const [isSidebarHovered, setIsSidebarHovered] = useState(false)
  const [isSidebarLocked, setIsSidebarLocked] = useState(() => {
    try {
      const saved = localStorage.getItem('vertexia_sidebar_locked')
      return saved !== 'false'
    } catch {
      return true
    }
  })

  useEffect(() => {
    const sync = () => {
      try {
        const saved = localStorage.getItem('vertexia_sidebar_locked')
        setIsSidebarLocked(saved !== 'false')
      } catch {}
    }
    window.addEventListener('vertexia:sidebar-lock-changed', sync)
    return () => window.removeEventListener('vertexia:sidebar-lock-changed', sync)
  }, [])

  const setAndPersistLock = (next: boolean) => {
    setIsSidebarLocked(next)
    try {
      localStorage.setItem('vertexia_sidebar_locked', String(next))
    } catch {}
  }

  const toggleLock = () => {
    setIsSidebarLocked(curr => {
      const next = !curr
      try {
        localStorage.setItem('vertexia_sidebar_locked', String(next))
      } catch {}
      return next
    })
  }

  const isExpanded = isSidebarLocked || isSidebarHovered

  return (
    <div
      className={`app-shell ${className} ${
        isExpanded ? 'sidebar-expanded sidebar-locked' : 'sidebar-collapsed sidebar-is-collapsed'
      }`.trim()}
    >
      <Sidebar
        activePage={activePage}
        onNavigate={onNavigate}
        isLockedExternally={isSidebarLocked}
        onLockChange={setAndPersistLock}
        isHoveredExternally={isSidebarHovered}
        onHoverChange={setIsSidebarHovered}
        locked={isSidebarLocked}
        onToggleLock={toggleLock}
        collapsed={!isExpanded}
      />
      <div className="main-shell" style={{ willChange: 'margin-left' }}>
        {header(() => setIsSidebarLocked(val => !val))}
        {children}
        <AppFooter />
      </div>
    </div>
  )
}
