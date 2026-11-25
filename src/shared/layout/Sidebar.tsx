import { Icon, type IconName } from '../ui/Icon'
import { useAuth } from '../../app/auth/useAuth'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { useEffect, useState, type MouseEvent } from 'react'
import {
  buildWhatsAppSupportUrl,
  formatLicenseExpiry,
  getSupportTelHref,
  SUPPORT_CONFIG,
  VERTEXIA_BRAND_LOGO,
} from '../config/supportConfig'
import { useHelpTranslation } from '../i18n/helpDictionary'
import { useSystemLogo } from '../settings/posSettings'
import type { SupportInfo } from '../../types/desktop-api'

type NavItem = {
  icon: IconName
  label: string
}

type NavSection = {
  section: string
  items: NavItem[]
}

const NAV_SECTIONS: NavSection[] = [
  {
    section: 'MAIN MENU',
    items: [
      { icon: 'home', label: 'Dashboard' },
      { icon: 'store', label: 'POS' },
      { icon: 'sale', label: 'Sales' },
      { icon: 'history', label: 'Sales History' },
      { icon: 'returnOrder', label: 'Returns' },
      { icon: 'box', label: 'Products' },
      { icon: 'inventory', label: 'Inventory' },
      { icon: 'cart', label: 'Purchases' },
      { icon: 'users', label: 'Customers' },
      { icon: 'supplier', label: 'Suppliers' },
    ],
  },
  {
    section: 'GENERAL',
    items: [
      { icon: 'cash', label: 'Cash & Shifts' },
      { icon: 'expense', label: 'Expenses' },
      { icon: 'users', label: 'Staff' },
      { icon: 'report', label: 'Reports' },
    ],
  },
]

export type SidebarProps = {
  activePage: string
  onNavigate: (page: string) => void
  isHoveredExternally?: boolean
  onHoverChange?: (hovered: boolean) => void
  isLockedExternally?: boolean
  onLockChange?: (locked: boolean) => void
  // backward compatibility props
  collapsed?: boolean
  locked?: boolean
  onToggleLock?: () => void
}

export function Sidebar({
  activePage,
  onNavigate,
  isHoveredExternally,
  onHoverChange,
  isLockedExternally,
  onLockChange,
  collapsed: _collapsed,
  locked,
  onToggleLock,
}: SidebarProps) {
  const { session, canPage } = useAuth()
  const { t } = useHelpTranslation()
  const systemLogo = useSystemLogo()
  const [internalHover, setInternalHover] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [supportInfo, setSupportInfo] = useState<SupportInfo | null>(null)

  useEscapeKey(() => setShowHelp(false), showHelp)

  useEffect(() => {
    if (!showHelp) return
    let alive = true
    const fetchInfo = async () => {
      try {
        if (window.vertexia?.system?.getSupportInfo) {
          const info = await window.vertexia.system.getSupportInfo()
          if (alive) setSupportInfo(info)
          return
        }
        const lic = await window.vertexia?.cloudLicense?.status?.().catch(() => null)
        if (alive && lic) {
          setSupportInfo({
            appVersion: SUPPORT_CONFIG.fallbackVersion,
            os: 'Desktop',
            databaseSizeBytes: null,
            licenseId: lic.license_id || 'Unregistered',
            licenseStatus: lic.status || 'Active',
            licenseExpiryDate: lic.expires_at ?? null,
            deviceId: lic.deviceId || 'Local',
            shopName: session?.businessName ?? '',
          })
        }
      } catch {
        // Offline-safe fallback uses bundled defaults below
      }
    }
    void fetchInfo()
    return () => {
      alive = false
    }
  }, [showHelp, session?.businessName])

  const appVersion = supportInfo?.appVersion || SUPPORT_CONFIG.fallbackVersion
  const licenseStatus = supportInfo?.licenseStatus || 'Active'
  const licenseExpiry = formatLicenseExpiry(supportInfo?.licenseExpiryDate)
  const whatsappUrl = buildWhatsAppSupportUrl({
    shopName: supportInfo?.shopName || session?.businessName || '',
    appVersion,
    licenseId: supportInfo?.licenseId || 'Unregistered',
  })

  const isLocked = isLockedExternally ?? locked ?? true
  const isHovered = isLocked || (isHoveredExternally !== undefined ? isHoveredExternally : internalHover)

  const handleMouseEnter = () => {
    if (isLocked) return
    if (onHoverChange) {
      onHoverChange(true)
    } else {
      setInternalHover(true)
    }
  }

  const handleMouseLeave = () => {
    if (isLocked) return
    if (onHoverChange) {
      onHoverChange(false)
    } else {
      setInternalHover(false)
    }
  }

  const handleToggleLock = (e: MouseEvent) => {
    e.stopPropagation()
    const next = !isLocked
    if (onLockChange) {
      onLockChange(next)
    } else {
      onToggleLock?.()
    }
  }

  return (
    <>
    <aside
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`sidebar medkit-sidebar ${isHovered ? 'expanded' : 'collapsed'}`}
      style={{ willChange: 'width' }}
      aria-label="Main navigation"
    >
      {/* Brand & Lock Header */}
      <div className="sidebar-header-row flex items-center gap-3 px-3.5 py-4 overflow-hidden flex-shrink-0">
        <button
          type="button"
          className="flex items-center gap-3 bg-transparent border-0 p-0 text-left cursor-pointer flex-1 min-w-0"
          onClick={() => onNavigate(canPage('Dashboard') ? 'Dashboard' : canPage('POS') ? 'POS' : 'Products')}
          aria-label="Vertexia Retail POS home"
        >
          {/* Logo with NO background box */}
          <div className="flex-shrink-0 w-9 h-9 flex items-center justify-center">
            <img
              src={systemLogo}
              alt="Vertexia logo"
              className="w-full h-full object-contain"
            />
          </div>
          <div
            className={`flex flex-col whitespace-nowrap transition-all duration-300 origin-left ${
              isHovered ? 'opacity-100 translate-x-0 w-auto' : 'opacity-0 -translate-x-4 w-0 overflow-hidden'
            }`}
          >
            <span className="text-lg font-bold text-white tracking-tight leading-tight font-heading">
              Vertexia <span className="text-[#a875ff]">POS</span>
            </span>
            <span className="text-xs font-medium text-slate-400 leading-none mt-1">
              Retail Management
            </span>
          </div>
        </button>

        {/* Lock/Unlock Toggle Icon Button */}
        <button
          type="button"
          onClick={handleToggleLock}
          title={isLocked ? 'Unlock sidebar (Auto-collapse)' : 'Lock sidebar open'}
          className={`ml-auto flex-shrink-0 p-2 rounded-lg text-slate-400 hover:bg-white/10 hover:text-white transition-all cursor-pointer ${
            isHovered ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
          aria-pressed={isLocked}
        >
          <Icon name={isLocked ? 'lock' : 'unlock'} size={16} />
        </button>
      </div>

      {/* Navigation Sections */}
      <nav
        className="flex-1 px-3 py-2 overflow-y-auto overflow-x-hidden scrollbar-none space-y-6"
        aria-label="Main navigation items"
      >
        {NAV_SECTIONS.map((sec, idx) => {
          const visibleItems = sec.items.filter(item => canPage(item.label))
          if (visibleItems.length === 0) return null
          return (
            <div key={idx} className="space-y-1">
              <h2
                className={`text-xs font-bold text-slate-400/70 mb-2 px-3 uppercase tracking-wider whitespace-nowrap transition-all duration-300 font-heading ${
                  isHovered ? 'opacity-100' : 'opacity-0 h-0 my-0 overflow-hidden'
                }`}
              >
                {sec.section}
              </h2>
              <div className="space-y-1">
                {visibleItems.map(item => {
                  const isActive = item.label === activePage
                  return (
                    <button
                      key={item.label}
                      type="button"
                      className={`w-full flex items-center gap-3.5 px-3.5 py-2.5 rounded-xl transition-all duration-200 group relative overflow-hidden cursor-pointer ${
                        isActive
                          ? 'bg-gradient-to-r from-[#7A35F6] to-[#5E0CF3] text-white shadow-md shadow-[#5E0CF3]/30 font-semibold'
                          : 'text-slate-300 hover:bg-white/5 hover:text-white font-medium'
                      }`}
                      onClick={() => onNavigate(item.label)}
                      aria-current={isActive ? 'page' : undefined}
                      title={item.label}
                    >
                      <span className="flex-shrink-0 flex items-center justify-center w-6 h-6">
                        <Icon
                          name={item.icon}
                          size={21}
                          className={`transition-transform duration-200 ${
                            isHovered ? '' : 'group-hover:scale-110'
                          } ${isActive ? 'text-white' : 'text-slate-400 group-hover:text-white'}`}
                        />
                      </span>

                      <span
                        className={`text-[15px] whitespace-nowrap transition-all duration-300 origin-left ${
                          isHovered ? 'opacity-100 translate-x-0 w-auto' : 'opacity-0 -translate-x-2 w-0 overflow-hidden'
                        }`}
                      >
                        {item.label}
                      </span>

                      {/* Tooltip for collapsed state */}
                      {!isHovered && (
                        <div className="absolute left-16 bg-[#01152D] text-white px-2.5 py-1.5 rounded-lg text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-200 z-50 font-semibold shadow-xl border border-white/10">
                          {item.label}
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </nav>

      {/* Sidebar Footer */}
      <div className="sidebar-bottom-area p-3 border-t border-white/10 bg-[#001026] flex flex-col gap-1 flex-shrink-0">
        {/* Settings button */}
        {canPage('Settings') && (
          <button
            type="button"
            onClick={() => onNavigate('Settings')}
            className={`flex items-center gap-3.5 px-3 py-2.5 w-full rounded-xl transition-all duration-200 group relative overflow-hidden cursor-pointer ${
              activePage === 'Settings'
                ? 'bg-gradient-to-r from-[#7A35F6] to-[#5E0CF3] text-white shadow-md shadow-[#5E0CF3]/30 font-semibold'
                : 'text-slate-300 hover:bg-white/5 hover:text-white font-medium'
            }`}
            title="Settings"
          >
            <span className="flex-shrink-0 flex items-center justify-center w-6 h-6">
              <Icon name="settings" size={20} className={`transition-transform duration-200 ${activePage === 'Settings' ? 'text-white' : 'text-slate-400 group-hover:text-white'}`} />
            </span>
            <span
              className={`text-[15px] whitespace-nowrap transition-all duration-300 origin-left ${
                isHovered ? 'opacity-100 translate-x-0 w-auto' : 'opacity-0 -translate-x-2 w-0 overflow-hidden'
              }`}
            >
              Settings
            </span>
            {!isHovered && (
              <div className="absolute left-16 bg-[#01152D] text-white px-2.5 py-1.5 rounded-lg text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-200 z-50 font-semibold shadow-xl border border-white/10">
                Settings
              </div>
            )}
          </button>
        )}

        {/* Help button */}
        <button
          type="button"
          onClick={() => setShowHelp(prev => !prev)}
          aria-expanded={showHelp}
          className={`flex items-center gap-3.5 px-3 py-2.5 w-full rounded-xl transition-all duration-200 group relative overflow-hidden cursor-pointer ${
            activePage === 'Help Center' || showHelp
              ? 'bg-gradient-to-r from-[#7A35F6] to-[#5E0CF3] text-white shadow-md shadow-[#5E0CF3]/30 font-semibold'
              : 'text-slate-300 hover:bg-white/5 hover:text-white font-medium'
          }`}
          title={t.helpButton}
        >
          <span className="flex-shrink-0 flex items-center justify-center w-6 h-6">
            <Icon name="info" size={20} className={`transition-transform duration-200 ${activePage === 'Help Center' || showHelp ? 'text-white' : 'text-slate-400 group-hover:text-white'}`} />
          </span>
          <span
            className={`text-[15px] whitespace-nowrap transition-all duration-300 origin-left ${
              isHovered ? 'opacity-100 translate-x-0 w-auto' : 'opacity-0 -translate-x-2 w-0 overflow-hidden'
            }`}
          >
            {t.helpButton}
          </span>
          {!isHovered && (
            <div className="absolute left-16 bg-[#01152D] text-white px-2.5 py-1.5 rounded-lg text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-200 z-50 font-semibold shadow-xl border border-white/10">
              {t.helpButton}
            </div>
          )}
        </button>

        {/* Subtle Powered by & Version tagline matching footer */}
        {isHovered && session && (
          <div className="pt-1 px-1 flex items-center justify-between text-[11px] text-slate-400">
            <span className="truncate">Powered by Vertexia</span>
            <span className="text-[10px] font-mono">v{appVersion}</span>
          </div>
        )}
      </div>
    </aside>

    {/* Horizontal Help Card Popover */}
    {showHelp && (
      <div
        role="presentation"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 99998,
          background: 'rgba(15, 23, 42, 0.25)',
        }}
        onClick={() => setShowHelp(false)}
      >
        <section
          role="dialog"
          aria-modal="true"
          aria-label={t.cardTitle}
          dir={t.dir}
          onClick={e => e.stopPropagation()}
          style={{
            position: 'fixed',
            left: isHovered ? 248 : 88,
            bottom: 18,
            width: 'min(740px, calc(100vw - 110px))',
            background: '#ffffff',
            borderRadius: 16,
            border: '1px solid #cbd5e1',
            boxShadow: '0 24px 60px rgba(15, 23, 42, 0.28)',
            overflow: 'hidden',
            zIndex: 99999,
          }}
        >
          {/* Top Company & Title Bar */}
          <div
            style={{
              background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)',
              padding: '16px 20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 14,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <img
                src={VERTEXIA_BRAND_LOGO}
                alt={SUPPORT_CONFIG.companyName}
                style={{ width: 40, height: 40, objectFit: 'contain', flexShrink: 0 }}
              />
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#ffffff' }}>{t.cardTitle}</h2>
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#c4b5fd' }}>· {SUPPORT_CONFIG.companyName}</span>
                </div>
                <p style={{ margin: '2px 0 0', fontSize: 14, color: '#cbd5e1' }}>{t.cardSubtitle}</p>
              </div>
            </div>
            <button
              type="button"
              aria-label={t.closeLabel}
              onClick={() => setShowHelp(false)}
              style={{
                background: 'rgba(255,255,255,0.1)',
                border: 0,
                borderRadius: 8,
                color: '#e2e8f0',
                cursor: 'pointer',
                padding: 7,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="close" size={18} />
            </button>
          </div>

          {/* Horizontal 3-Column Action Row */}
          <div
            style={{
              padding: '16px 20px',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(185px, 1fr))',
              gap: 12,
              background: '#f8fafc',
            }}
          >
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => {
                if (window.desktopApp && window.vertexia?.system?.openExternal) {
                  e.preventDefault()
                  void window.vertexia.system.openExternal(whatsappUrl)
                }
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '13px 15px',
                borderRadius: 12,
                background: '#ffffff',
                border: '1px solid #bbf7d0',
                textDecoration: 'none',
                color: '#14532d',
                fontSize: 14,
                fontWeight: 700,
              }}
            >
              <span style={{ width: 38, height: 38, borderRadius: 10, background: '#dcfce7', color: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon name="phone" size={19} />
              </span>
              <span>{t.whatsappSupport}</span>
            </a>

            <a
              href={getSupportTelHref()}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '13px 15px',
                borderRadius: 12,
                background: '#ffffff',
                border: '1px solid #bfdbfe',
                textDecoration: 'none',
                color: '#1e3a8a',
                fontSize: 14,
                fontWeight: 700,
              }}
            >
              <span style={{ width: 38, height: 38, borderRadius: 10, background: '#dbeafe', color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon name="phone" size={19} />
              </span>
              <div>
                <div>{t.callUs}</div>
                <div style={{ fontSize: 14, fontWeight: 500, color: '#334155' }}>{SUPPORT_CONFIG.supportNumber}</div>
              </div>
            </a>

            <button
              type="button"
              onClick={() => {
                setShowHelp(false)
                onNavigate('Help Center')
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '13px 15px',
                borderRadius: 12,
                background: '#ffffff',
                border: '1px solid #ddd6fe',
                color: '#4c1d95',
                fontSize: 14,
                fontWeight: 700,
                cursor: 'pointer',
                textAlign: t.dir === 'rtl' ? 'right' : 'left',
              }}
            >
              <span style={{ width: 38, height: 38, borderRadius: 10, background: '#ede9fe', color: '#5E0CF3', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon name="info" size={19} />
              </span>
              <span>{t.helpGuide}</span>
            </button>
          </div>

          {/* Horizontal Footer Row: Support Hours + Version & License */}
          <div
            style={{
              padding: '12px 20px',
              background: '#ffffff',
              borderTop: '1px solid #e2e8f0',
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              fontSize: 14,
              color: '#334155',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Icon name="clock" size={16} className="text-slate-500" />
              <span>{SUPPORT_CONFIG.supportHours}</span>
            </span>
            <span style={{ color: '#475569', fontWeight: 500 }}>
              {t.versionPrefix} {appVersion} · {t.licensePrefix} {licenseStatus} {t.untilWord} {licenseExpiry}
            </span>
          </div>
        </section>
      </div>
    )}
    </>
  )
}
