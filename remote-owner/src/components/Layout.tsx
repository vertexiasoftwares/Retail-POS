import { useState, type ReactNode } from 'react'
import type { CloudOwnerSession } from '../services/cloudApi'
import type { NavTarget } from '../screens/DashboardScreen'
import {
  AlertIcon,
  BarChartIcon,
  ClockIcon,
  CloudSyncIcon,
  DashboardIcon,
  DatabaseIcon,
  KeyIcon,
  LayersIcon,
  LogOutIcon,
  MenuIcon,
  MonitorIcon,
  PackageIcon,
  ReceiptIcon,
  ShieldIcon,
  ShoppingBagIcon,
  TruckIcon,
  UsersIcon,
  WalletIcon,
} from './Icons'

interface NavItem {
  id: NavTarget
  label: string
  group: 'Operations' | 'Stock & Parties' | 'Finance & People' | 'Cloud & Security'
  icon: (props: { className?: string }) => ReactNode
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', group: 'Operations', icon: p => <DashboardIcon {...p} /> },
  { id: 'sales', label: 'Sales', group: 'Operations', icon: p => <ReceiptIcon {...p} /> },
  { id: 'reports', label: 'Reports', group: 'Operations', icon: p => <BarChartIcon {...p} /> },
  { id: 'cash-shifts', label: 'Cash Shifts', group: 'Operations', icon: p => <ClockIcon {...p} /> },
  { id: 'products', label: 'Products', group: 'Stock & Parties', icon: p => <PackageIcon {...p} /> },
  { id: 'inventory', label: 'Inventory', group: 'Stock & Parties', icon: p => <LayersIcon {...p} /> },
  { id: 'purchases', label: 'Purchases', group: 'Stock & Parties', icon: p => <ShoppingBagIcon {...p} /> },
  { id: 'customers', label: 'Customers', group: 'Stock & Parties', icon: p => <UsersIcon {...p} /> },
  { id: 'suppliers', label: 'Suppliers', group: 'Stock & Parties', icon: p => <TruckIcon {...p} /> },
  { id: 'expenses', label: 'Expenses', group: 'Finance & People', icon: p => <WalletIcon {...p} /> },
  { id: 'staff', label: 'Staff', group: 'Finance & People', icon: p => <ShieldIcon {...p} /> },
  { id: 'counters', label: 'Counters', group: 'Finance & People', icon: p => <MonitorIcon {...p} /> },
  { id: 'sync-status', label: 'Sync Status', group: 'Cloud & Security', icon: p => <CloudSyncIcon {...p} /> },
  { id: 'conflicts', label: 'Conflicts', group: 'Cloud & Security', icon: p => <AlertIcon {...p} /> },
  { id: 'backups', label: 'Backups', group: 'Cloud & Security', icon: p => <DatabaseIcon {...p} /> },
  { id: 'account', label: 'Account', group: 'Cloud & Security', icon: p => <KeyIcon {...p} /> },
]

const GROUPS: NavItem['group'][] = ['Operations', 'Stock & Parties', 'Finance & People', 'Cloud & Security']

export function Layout({
  session,
  activeTab,
  wsState,
  installReady,
  onInstallApp,
  onSelectTab,
  onLogout,
  children,
}: {
  session: CloudOwnerSession
  activeTab: NavTarget
  wsState: 'connected' | 'reconnecting' | 'polling'
  installReady: boolean
  onInstallApp: () => void
  onSelectTab: (tab: NavTarget) => void
  onLogout: () => Promise<void>
  children: ReactNode
}) {
  const [drawerOpen, setDrawerOpen] = useState(false)

  const wsBadge =
    wsState === 'connected'
      ? { dot: 'bg-emerald-400', text: 'Live WS' }
      : wsState === 'reconnecting'
        ? { dot: 'bg-amber-400', text: 'Reconnecting' }
        : { dot: 'bg-sky-400', text: 'Auto-Poll' }

  const navContent = (
    <div className="flex h-full flex-col bg-[#17082b] text-white">
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-4">
        <img src="/retail-pos-icon.png" alt="Vertexia" className="h-9 w-9 rounded-xl object-contain" />
        <div className="min-w-0 flex-1">
          <p className="font-display truncate text-sm font-bold text-white">{session.shopName || 'Vertexia Shop'}</p>
          <p className="truncate text-[11px] text-white/65">
            {session.name} ({session.role})
          </p>
        </div>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {GROUPS.map(group => (
          <div key={group}>
            <p className="mb-1.5 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-white/45">{group}</p>
            <div className="space-y-0.5">
              {NAV_ITEMS.filter(i => i.group === group).map(item => {
                const active = activeTab === item.id
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onSelectTab(item.id)
                      setDrawerOpen(false)
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-medium transition ${
                      active ? 'bg-[#6d4aff] text-white shadow-sm' : 'text-white/75 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    {item.icon({ className: 'h-4 w-4 shrink-0' })}
                    <span>{item.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-2 border-t border-white/10 p-3">
        <div className="flex items-center justify-between rounded-xl bg-white/8 px-3 py-2 text-[11px]">
          <span className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${wsBadge.dot}`} />
            <span>{wsBadge.text}</span>
          </span>
          <span className="text-white/60">Cloud Mode</span>
        </div>
        {installReady && (
          <button
            type="button"
            onClick={onInstallApp}
            className="w-full rounded-xl bg-white/15 py-2 text-xs font-semibold text-white hover:bg-white/25"
          >
            Install Mobile / Desktop App
          </button>
        )}
        <button
          type="button"
          onClick={() => void onLogout()}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 py-2 text-xs font-semibold text-white/85 hover:bg-white/10"
        >
          <LogOutIcon className="h-3.5 w-3.5" /> Sign Out
        </button>
      </div>
    </div>
  )

  return (
    <div className="flex min-h-screen bg-[#f2f7fd]">
      {/* Desktop persistent rail */}
      <aside className="hidden w-64 shrink-0 lg:block">
        <div className="sticky top-0 h-screen">{navContent}</div>
      </aside>

      {/* Mobile slide-over drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="fixed inset-0 bg-black/50" onClick={() => setDrawerOpen(false)} />
          <div className="relative z-10 h-full w-72 max-w-[85vw]">{navContent}</div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile Header */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-[#dce6f4] bg-[#17082b] px-4 py-3 text-white lg:hidden">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation menu"
              className="rounded-xl bg-white/10 p-2 text-white"
            >
              <MenuIcon className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <p className="font-display truncate text-sm font-bold">{session.shopName || 'Vertexia Owner'}</p>
              <p className="flex items-center gap-1.5 text-[11px] text-white/75">
                <span className={`h-1.5 w-1.5 rounded-full ${wsBadge.dot}`} />
                {wsBadge.text}
              </p>
            </div>
          </div>
          {installReady && (
            <button
              type="button"
              onClick={onInstallApp}
              className="rounded-lg bg-[#6d4aff] px-2.5 py-1.5 text-[11px] font-semibold text-white"
            >
              Install App
            </button>
          )}
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 pb-24 sm:px-6 lg:pb-8">{children}</main>

        {/* Android Mobile Quick Bottom Bar */}
        <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t border-[#dce6f4] bg-white px-2 pt-2 shadow-lg lg:hidden">
          {(
            [
              { id: 'dashboard', label: 'Home', icon: DashboardIcon },
              { id: 'sales', label: 'Sales', icon: ReceiptIcon },
              { id: 'inventory', label: 'Stock', icon: LayersIcon },
              { id: 'reports', label: 'Reports', icon: BarChartIcon },
            ] as const
          ).map(item => {
            const active = activeTab === item.id
            const Icon = item.icon
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`flex flex-col items-center gap-0.5 rounded-xl px-3 py-1 text-[11px] font-semibold ${
                  active ? 'text-[#6d4aff]' : 'text-[#55667d]'
                }`}
              >
                <Icon className="h-5 w-5" />
                <span>{item.label}</span>
              </button>
            )
          })}
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="flex flex-col items-center gap-0.5 rounded-xl px-3 py-1 text-[11px] font-semibold text-[#55667d]"
          >
            <MenuIcon className="h-5 w-5" />
            <span>More</span>
          </button>
        </nav>
      </div>
    </div>
  )
}
