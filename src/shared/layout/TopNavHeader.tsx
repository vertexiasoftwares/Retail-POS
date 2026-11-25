import type { ReactNode } from 'react'
import { BusinessName, BranchName } from './SessionIdentity'
import { OwnerDropdown } from './OwnerDropdown'
import { NotificationCenter } from './NotificationCenter'
import { Icon } from '../ui/Icon'

export type TopNavHeaderProps = {
  title?: string
  subtitle?: string
  onNavigate?: (page: string) => void
  extraLeft?: ReactNode
  extraRight?: ReactNode
  className?: string
}

export function TopNavHeader({
  title = 'Vertexia Retail POS',
  subtitle = 'Retail Management',
  onNavigate,
  extraLeft,
  extraRight,
  className = '',
}: TopNavHeaderProps) {
  return (
    <header className={`topbar ${className}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 22px', height: '64px', background: '#ffffff', borderBottom: '1px solid #e2e8f0' }}>
      {/* Left: Clean Store Title / Branding (No 3-line menu, No global search) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <img
            src="/retail-logo-transparent.png"
            alt="Vertexia Retail POS"
            style={{
              height: '38px',
              width: 'auto',
              maxWidth: '120px',
              objectFit: 'contain',
              display: 'block',
            }}
          />
          <div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a', lineHeight: 1.15 }}>
              {title}
            </div>
            <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 500 }}>
              {subtitle}
            </div>
          </div>
        </div>
        {extraLeft}
      </div>

      {/* Right: Notifications, Store Switcher, and Owner Profile Dropdown */}
      <div className="topbar-right" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {extraRight}

        <NotificationCenter onNavigate={onNavigate} />

        <div className="store-switcher" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '4px 10px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
          <span className="store-avatar">
            <Icon name="store" size={20} />
          </span>
          <span>
            <strong style={{ fontSize: '12.5px', color: '#1e293b' }}>
              <BusinessName />
            </strong>
            <small style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>
              <BranchName />
            </small>
          </span>
        </div>

        <OwnerDropdown onNavigate={onNavigate} />
      </div>
    </header>
  )
}
