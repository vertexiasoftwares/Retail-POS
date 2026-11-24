import { useState } from 'react'
import { hashToPage, pages, pageToHash } from './app/routes'
import { RetailDataProvider } from './app/data/RetailDataProvider'
import type { PageName } from './types'
import './styles/index.css'
import { AuthProvider } from './app/auth/AuthContext'
import { useAuth } from './app/auth/useAuth'
import { GlobalZoom } from './shared/layout/GlobalZoom'
import { DesktopShell } from './shared/layout/DesktopShell'

function AuthenticatedApp() {
  const { session, canPage } = useAuth()
  const [activePage, setActivePage] = useState<PageName>(() => hashToPage[window.location.hash] ?? 'POS')

  const findFirstPermittedPage = (): PageName => {
    const allPageNames: PageName[] = [
      'Dashboard', 'POS', 'Sales', 'Products', 'Inventory',
      'Purchases', 'Customers', 'Suppliers', 'Cash & Shifts',
      'Expenses', 'Staff', 'Reports', 'Settings', 'My Account'
    ]
    return allPageNames.find(p => canPage(p)) ?? 'My Account'
  }

  const navigate = (requestedPage: string) => {
    const fallback = findFirstPermittedPage()
    const page = requestedPage in pages && canPage(requestedPage) ? (requestedPage as PageName) : fallback
    setActivePage(page)
    window.history.replaceState(null, '', pageToHash[page] ?? '')
    window.scrollTo(0, 0)
  }

  const fallback = findFirstPermittedPage()
  const permittedPage = canPage(activePage) ? activePage : fallback
  const ActivePage = pages[permittedPage]
  const props = { onNavigate: navigate }
  return (
    <RetailDataProvider key={session!.userId + ':' + session!.branchId}>
      <ActivePage {...props} />
    </RetailDataProvider>
  )
}

function App() {
  return (
    <DesktopShell>
      <GlobalZoom />
      <AuthProvider>
        <AuthenticatedApp />
      </AuthProvider>
    </DesktopShell>
  )
}

export default App
