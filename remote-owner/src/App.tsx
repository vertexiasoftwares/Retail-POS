import { useCallback, useEffect, useRef, useState } from 'react'
import {
  buildWebSocketUrl,
  clearStoredSession,
  cloudApi,
  getSavedSessionMeta,
  getSessionToken,
  setUnauthorizedHandler,
  type CloudOwnerSession,
} from './services/cloudApi'
import { Layout } from './components/Layout'
import { LoginScreen } from './screens/LoginScreen'
import { DashboardScreen, type NavTarget } from './screens/DashboardScreen'
import { SaleDetailScreen, SalesScreen } from './screens/SalesScreens'
import { InventoryScreen, ProductsScreen } from './screens/CatalogScreens'
import { CustomersScreen, ExpensesScreen, PurchasesScreen, SuppliersScreen } from './screens/PeopleLedgerScreens'
import { CashShiftsScreen, CountersScreen, ReportsScreen, StaffScreen } from './screens/OperationsAdminScreens'
import { AccountSettingsScreen, BackupsScreen, ConflictsScreen, SyncStatusScreen } from './screens/CloudSystemScreens'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function App() {
  const [session, setSession] = useState<CloudOwnerSession | null>(() => getSavedSessionMeta())
  const [verifying, setVerifying] = useState(() => Boolean(getSessionToken()))
  const [sessionNotice, setSessionNotice] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<NavTarget>('dashboard')
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null)
  const [wsState, setWsState] = useState<'connected' | 'reconnecting' | 'polling'>('polling')
  const [refreshTick, setRefreshTick] = useState(0)
  const [liveToast, setLiveToast] = useState<string | null>(null)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const reconnectTimerRef = useRef<number | null>(null)

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setSession(null)
      setSelectedSaleId(null)
      setSessionNotice('Your cloud session expired or was signed out because credentials changed. Sign in again.')
    })
    return () => setUnauthorizedHandler(null)
  }, [])

  // Validate stored bearer token on startup
  useEffect(() => {
    const tok = getSessionToken()
    if (!tok) {
      setSession(null)
      setVerifying(false)
      return
    }
    let cancelled = false
    cloudApi
      .me()
      .then(res => {
        if (!cancelled) {
          setSession(res.session)
        }
      })
      .catch(() => {
        if (!cancelled) {
          clearStoredSession()
          setSession(null)
        }
      })
      .finally(() => {
        if (!cancelled) setVerifying(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // PWA install prompt listener (Android Chrome / Desktop Edge/Chrome)
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault()
      setInstallPrompt(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  // Prefer ordinary HTTPS polling for maximum compatibility with free serverless/spinning hosts;
  // enable optional WebSocket channel only when VITE_CLOUD_REALTIME_WS=true
  useEffect(() => {
    if (!session) {
      setWsState('polling')
      return
    }
    if (import.meta.env.VITE_CLOUD_REALTIME_WS !== 'true') {
      setWsState('polling')
      return
    }
    const token = getSessionToken()
    const wsUrl = token ? buildWebSocketUrl(token) : null
    if (!wsUrl) return

    let disposed = false
    let ws: WebSocket | null = null
    let attempt = 0

    const connect = () => {
      if (disposed) return
      setWsState(attempt === 0 ? 'polling' : 'reconnecting')
      ws = new WebSocket(wsUrl)
      ws.onopen = () => {
        if (disposed) return
        attempt = 0
        setWsState('connected')
      }
      ws.onmessage = evt => {
        if (disposed) return
        try {
          const msg = JSON.parse(String(evt.data || '{}')) as { type?: string }
          if (msg.type === 'cloud:sync_updated' || msg.type === 'product:updated' || msg.type === 'inventory:changed') {
            setRefreshTick(t => t + 1)
            setLiveToast(
              msg.type === 'cloud:sync_updated'
                ? 'Main PC synced new shop activity'
                : msg.type === 'product:updated'
                  ? 'Catalog updated in cloud'
                  : 'Inventory balance updated',
            )
          }
        } catch {}
      }
      ws.onclose = () => {
        if (disposed) return
        attempt += 1
        if (attempt > 2) {
          setWsState('polling')
          return
        }
        setWsState('reconnecting')
        const delayMs = Math.min(15_000, 2_000 * attempt)
        reconnectTimerRef.current = window.setTimeout(connect, delayMs)
      }
      ws.onerror = () => {
        ws?.close()
      }
    }

    connect()
    return () => {
      disposed = true
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      ws?.close()
    }
  }, [session])

  // Polling fallback whenever WS is not connected
  useEffect(() => {
    if (!session || wsState === 'connected') return
    const timer = window.setInterval(() => {
      setRefreshTick(t => t + 1)
    }, 30_000)
    return () => clearInterval(timer)
  }, [session, wsState])

  useEffect(() => {
    if (!liveToast) return
    const t = window.setTimeout(() => setLiveToast(null), 4000)
    return () => clearTimeout(t)
  }, [liveToast])

  const handleLogout = useCallback(async () => {
    await cloudApi.logout()
    setSession(null)
    setSelectedSaleId(null)
    setActiveTab('dashboard')
  }, [])

  const handleInstallApp = useCallback(async () => {
    if (!installPrompt) return
    await installPrompt.prompt()
    await installPrompt.userChoice.catch(() => undefined)
    setInstallPrompt(null)
  }, [installPrompt])

  if (verifying) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#17082b] text-white">
        <div className="text-center">
          <img src="/retail-pos-icon.png" alt="Vertexia" className="mx-auto mb-3 h-12 w-12 animate-pulse rounded-2xl" />
          <p className="font-display text-sm font-semibold">Connecting to Vertexia Cloud Gateway...</p>
        </div>
      </div>
    )
  }

  if (!session) {
    return (
      <LoginScreen
        sessionNotice={sessionNotice}
        onAuthenticated={next => {
          setSessionNotice(null)
          setSession(next)
          setActiveTab('dashboard')
        }}
      />
    )
  }

  const renderScreen = () => {
    if (selectedSaleId && activeTab === 'sales') {
      return <SaleDetailScreen saleId={selectedSaleId} onBack={() => setSelectedSaleId(null)} />
    }
    switch (activeTab) {
      case 'dashboard':
        return (
          <DashboardScreen
            refreshTick={refreshTick}
            onNavigate={tab => {
              setSelectedSaleId(null)
              setActiveTab(tab)
            }}
            onOpenSale={saleId => {
              setSelectedSaleId(saleId)
              setActiveTab('sales')
            }}
          />
        )
      case 'sales':
        return <SalesScreen refreshTick={refreshTick} onSelectSale={saleId => setSelectedSaleId(saleId)} />
      case 'products':
        return <ProductsScreen refreshTick={refreshTick} />
      case 'inventory':
        return <InventoryScreen refreshTick={refreshTick} />
      case 'customers':
        return <CustomersScreen refreshTick={refreshTick} />
      case 'suppliers':
        return <SuppliersScreen refreshTick={refreshTick} />
      case 'purchases':
        return <PurchasesScreen refreshTick={refreshTick} />
      case 'expenses':
        return <ExpensesScreen refreshTick={refreshTick} />
      case 'cash-shifts':
        return <CashShiftsScreen refreshTick={refreshTick} />
      case 'staff':
        return <StaffScreen refreshTick={refreshTick} />
      case 'counters':
        return <CountersScreen refreshTick={refreshTick} />
      case 'reports':
        return <ReportsScreen refreshTick={refreshTick} />
      case 'sync-status':
        return <SyncStatusScreen refreshTick={refreshTick} wsState={wsState} />
      case 'conflicts':
        return <ConflictsScreen refreshTick={refreshTick} />
      case 'backups':
        return <BackupsScreen refreshTick={refreshTick} />
      case 'account':
        return <AccountSettingsScreen session={session} onLogout={handleLogout} />
    }
  }

  return (
    <Layout
      session={session}
      activeTab={activeTab}
      wsState={wsState}
      installReady={Boolean(installPrompt)}
      onInstallApp={() => void handleInstallApp()}
      onSelectTab={tab => {
        setSelectedSaleId(null)
        setActiveTab(tab)
      }}
      onLogout={handleLogout}
    >
      {liveToast && (
        <div className="mb-3 rounded-xl border border-[#6d4aff]/30 bg-[#6d4aff]/10 px-4 py-2 text-xs font-semibold text-[#5835eb]">
          Live Cloud Update: {liveToast}
        </div>
      )}
      {renderScreen()}
    </Layout>
  )
}

export default App
