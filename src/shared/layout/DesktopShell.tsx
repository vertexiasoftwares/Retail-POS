import type { ReactNode } from 'react'
import './DesktopShell.css'

export type DesktopShellProps = {
  children: ReactNode
}

export function DesktopShell({ children }: DesktopShellProps) {
  return (
    <div className="desktop-shell">
      <div className="desktop-workspace">{children}</div>
    </div>
  )
}
