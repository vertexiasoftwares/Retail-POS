import { useEffect, useState, type ReactNode } from 'react'
import { Icon } from '../ui/Icon'
import './DesktopShell.css'

export type DesktopShellProps = {
  children: ReactNode
}

export function DesktopShell({ children }: DesktopShellProps) {
  const [windowState, setWindowState] = useState<{
    maximized: boolean
    fullscreen: boolean
    version: string
  }>({
    maximized: false,
    fullscreen: false,
    version: '1.0.0',
  })

  useEffect(() => {
    const desktop = window.desktopApp
    if (!desktop?.getWindowState) return

    let mounted = true
    const update = (state: any) => {
      if (mounted && state) {
        setWindowState(prev => ({
          ...prev,
          maximized: Boolean(state.maximized),
          fullscreen: Boolean(state.fullscreen),
          version: state.version || prev.version,
        }))
      }
    }

    const unsubscribe = desktop.onWindowStateChange?.(update)
    desktop.getWindowState().then(update).catch(() => {})

    return () => {
      mounted = false
      unsubscribe?.()
    }
  }, [])

  const controlWindow = async (action: string) => {
    if (window.desktopApp?.controlWindow) {
      try {
        const state = await window.desktopApp.controlWindow(action)
        if (state) {
          setWindowState(prev => ({
            ...prev,
            maximized: Boolean(state.maximized),
            fullscreen: Boolean(state.fullscreen),
            version: state.version || prev.version,
          }))
        }
        return
      } catch {}
    }

    // Web / browser fallback for fullscreen
    if (action === 'toggle-fullscreen') {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch(() => {})
        setWindowState(prev => ({ ...prev, fullscreen: true }))
      } else {
        document.exitFullscreen?.().catch(() => {})
        setWindowState(prev => ({ ...prev, fullscreen: false }))
      }
    } else if (action === 'toggle-maximize') {
      setWindowState(prev => ({ ...prev, maximized: !prev.maximized }))
    }
  }

  const toggleMaximize = () => controlWindow('toggle-maximize')
  const handleTitlebarDoubleClick = (event: React.MouseEvent) => {
    if ((event.target as HTMLElement).closest('.desktop-titlebar-actions')) return
    toggleMaximize()
  }

  const isExpanded = windowState.fullscreen || windowState.maximized

  return (
    <div className="desktop-shell">
      <header
        className={`desktop-titlebar${windowState.fullscreen ? ' desktop-titlebar-fullscreen' : ''}`}
        onDoubleClick={handleTitlebarDoubleClick}
      >
        <div className="desktop-titlebar-brand">
          <span className="desktop-brand-icon">
            <img src="/retail-logo-transparent.png" alt="" draggable="false" />
          </span>
          <span className="desktop-brand-name">
            Vertexia <span>POS</span>
          </span>
          <span className="desktop-titlebar-caption">Retail Management</span>
        </div>

        <div className="desktop-titlebar-dragspace" />

        <div className="desktop-titlebar-actions">
          <button
            type="button"
            className="desktop-fullscreen-button"
            aria-label={windowState.fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            title={windowState.fullscreen ? 'Exit fullscreen (F11)' : 'Enter fullscreen (F11)'}
            onClick={() => controlWindow('toggle-fullscreen')}
          >
            <Icon name={windowState.fullscreen ? 'minimize' : 'maximize'} size={13} />
            <span>{windowState.fullscreen ? 'Exit fullscreen' : 'Fullscreen'}</span>
          </button>

          <div className="desktop-window-controls">
            <button
              type="button"
              aria-label="Minimize window"
              title="Minimize"
              onClick={() => controlWindow('minimize')}
            >
              <Icon name="minus" size={13} />
            </button>
            <button
              type="button"
              aria-label={isExpanded ? 'Restore window' : 'Maximize window'}
              title={isExpanded ? 'Restore' : 'Maximize'}
              onClick={toggleMaximize}
            >
              <Icon name={isExpanded ? 'copy' : 'square'} size={12} />
            </button>
            <button
              type="button"
              className="desktop-window-close"
              aria-label="Close application"
              title="Close"
              onClick={() => controlWindow('close')}
            >
              <Icon name="close" size={13} />
            </button>
          </div>
        </div>
      </header>

      <div className="desktop-workspace">{children}</div>

      <footer className="desktop-footer">
        <span className="desktop-footer-product">
          <span className="desktop-footer-dot" />
          Vertexia Retail POS
        </span>
        <span className="desktop-footer-center">
          {windowState.version ? `Version ${windowState.version}` : 'Version 1.0.0'}
        </span>
        <span className="desktop-footer-agency">
          Powered by <strong>VERTEXIA</strong>
        </span>
      </footer>
    </div>
  )
}
