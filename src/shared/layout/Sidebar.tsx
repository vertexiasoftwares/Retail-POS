import { Icon, type IconName } from '../ui/Icon'
import { useAuth } from '../../app/auth/useAuth'
import { useState, type MouseEvent } from 'react'

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
      { icon: 'settings', label: 'Settings' },
      { icon: 'user', label: 'My Account' },
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
  const { session, canPage, logout } = useAuth()
  const [internalHover, setInternalHover] = useState(false)
  const [error, setError] = useState('')

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
              src="/retail-logo-transparent.png"
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

      {/* Sidebar Footer: Owner and Branch cards removed per user request */}
      <div className="sidebar-bottom-area p-3 border-t border-white/10 bg-[#001026] flex flex-col gap-2 flex-shrink-0">
        {error && (
          <div className="text-[11px] text-rose-300 px-2 py-1 bg-rose-950/60 border border-rose-800/40 rounded">
            {error}
          </div>
        )}

        {/* Clean Sign out button */}
        <button
          type="button"
          onClick={() => void logout().catch(cause => setError(String(cause)))}
          className="flex items-center gap-3.5 px-3 py-2.5 text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 w-full rounded-xl transition-all duration-200 group relative overflow-hidden cursor-pointer"
          title="Sign out"
        >
          <span className="flex-shrink-0 flex items-center justify-center w-6 h-6">
            <Icon name="logout" size={20} className="group-hover:rotate-12 transition-transform duration-200" />
          </span>
          <span
            className={`font-semibold whitespace-nowrap text-xs tracking-wider uppercase transition-all duration-300 origin-left ${
              isHovered ? 'opacity-100 translate-x-0 w-auto' : 'opacity-0 -translate-x-2 w-0 overflow-hidden'
            }`}
          >
            Sign out
          </span>
          {!isHovered && (
            <div className="absolute left-16 bg-rose-600 text-white px-2.5 py-1 rounded text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 font-bold shadow-xl">
              Sign out
            </div>
          )}
        </button>

        {/* Subtle Store & Version tagline matching mockup footer */}
        {isHovered && session && (
          <div className="pt-1 px-1 flex items-center justify-between text-[11px] text-slate-500">
            <span className="truncate">{session.businessName}</span>
            <span className="text-[10px] font-mono">v1.0.0</span>
          </div>
        )}
      </div>
    </aside>
  )
}
