import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { VertexiaDatabase } from '../electron-dist/electron/database/database.mjs'

const readRepoFile = rel => readFileSync(join(process.cwd(), rel), 'utf8')

test('CustomSelect guards against infinite useLayoutEffect loop when DateRangeFilter opens', () => {
  const src = readRepoFile('src/shared/ui/CustomSelect.tsx')

  // Must carry explicit dependency arrays on both useLayoutEffect and useEffect
  assert.match(
    src,
    /useLayoutEffect\(\s*\(\)\s*=>\s*\{[\s\S]*?\},\s*\[open,\s*updatePosition\]\s*\)/,
    'CustomSelect useLayoutEffect must include [open, updatePosition] dependency array'
  )
  assert.match(
    src,
    /useEffect\(\s*\(\)\s*=>\s*\{[\s\S]*?\},\s*\[open,\s*updatePosition\]\s*\)/,
    'CustomSelect useEffect must include [open, updatePosition] dependency array'
  )

  // Must compare coords before updating state so identical position values bail out cleanly
  assert.match(
    src,
    /setCoords\(prev\s*=>[\s\S]*prev\.top === nextCoords\.top[\s\S]*prev\.left === nextCoords\.left[\s\S]*prev\.width === nextCoords\.width[\s\S]*prev\.openUp === nextCoords\.openUp[\s\S]*\?\s*prev\s*:\s*nextCoords/
  )
})

test('ReturnsPage displays recent bill numbers vertically in clean full-width rows and PurchasesPage wires DateRangeFilter', () => {
  const returnsSrc = readRepoFile('src/features/returns/ReturnsPage.tsx')
  // Vertical stacked list rather than horizontal wrapping pill strip
  assert.equal(returnsSrc.includes('text-[11px] font-semibold cursor-pointer transition-all'), false)
  assert.match(returnsSrc, /className="border border-slate-200 rounded-xl overflow-hidden bg-white divide-y divide-slate-100"/)
  assert.match(returnsSrc, /\{b\.invoiceNumber\}/)
  assert.match(returnsSrc, /Click any bill row below to load items/)

  const purchasesSrc = readRepoFile('src/features/purchases/PurchasesPage.tsx')
  assert.match(purchasesSrc, /<DateRangeFilter value=\{dateRange \?\? undefined\} onChange=\{setDateRange\} \/>/)
  assert.match(purchasesSrc, /p\.purchaseDate >= dateRange\.startDate && p\.purchaseDate <= dateRange\.endDate/)
})

test('getSalesSnapshot and getReturnsList support all DateRangeFilter presets without errors', () => {
  const now = new Date('2026-10-15T12:00:00+05:00')
  const db = new VertexiaDatabase(':memory:', () => now)
  try {
    const product = db.createPosProduct('branch-main', {
      name: 'Daal Chana 1kg',
      barcode: '8877665544331',
      category: 'Grocery',
      unit: 'Kg',
      purchasePricePaisa: 20_000,
      sellingPricePaisa: 25_000,
      openingStockMilli: 10_000,
    })
    db.openPosShift('branch-main', 50_000)

    const sale = db.completePosSale({
      branchId: 'branch-main',
      customerId: 'customer-walk-in',
      lines: [{ productId: product.id, quantityMilli: 2_000, discountBasisPoints: 0 }],
      paymentMethod: 'Cash',
      cashReceivedPaisa: 50_000,
    })
    const detail = db.getSalesDetail('branch-main', sale.saleId)
    db.createSalesReturn({
      branchId: 'branch-main',
      saleId: sale.saleId,
      reason: '',
      lines: [{ saleItemId: detail.lines[0].id, quantityMilli: 1_000 }],
    })

    for (const period of ['today', 'yesterday', 'this_week', 'this_month', 'last_month']) {
      const salesSnap = db.getSalesSnapshot({
        branchId: 'branch-main',
        period,
        search: '',
        paymentMethod: 'all',
        status: 'all',
        page: 1,
        pageSize: 10,
      })
      const returnsSnap = db.getReturnsList({
        branchId: 'branch-main',
        period,
        returnType: 'all',
        refundMethod: 'all',
      })
      assert.equal(typeof salesSnap.total, 'number')
      assert.equal(typeof returnsSnap.totalReturnsCount, 'number')
      if (period === 'today') {
        assert.equal(salesSnap.total, 1)
        assert.equal(returnsSnap.totalReturnsCount, 1)
      }
      if (period === 'yesterday' || period === 'last_month') {
        assert.equal(salesSnap.total, 0)
        assert.equal(returnsSnap.totalReturnsCount, 0)
      }
    }

    const customReturns = db.getReturnsList({
      branchId: 'branch-main',
      period: 'custom',
      dateFrom: '2026-10-01',
      dateTo: '2026-10-31',
      returnType: 'all',
      refundMethod: 'all',
    })
    assert.equal(customReturns.totalReturnsCount, 1)
  } finally {
    db.close()
  }
})

test('exportUtils generates real .xlsx OOXML workbook and direct binary PDF downloads without print preview', () => {
  const src = readRepoFile('src/shared/utils/exportUtils.ts')
  // Real OOXML Excel workbook (never HTML spoofed as .xls and never .csv)
  assert.equal(src.includes('<x:ExcelWorkbook>'), false)
  assert.equal(src.includes("type: 'text/csv;charset=utf-8;'"), false)
  assert.match(src, /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/)
  assert.match(src, /xl\/worksheets\/sheet1\.xml/)
  assert.match(src, /xl\/workbook\.xml/)
  assert.match(src, /xl\/sharedStrings\.xml/)
  assert.match(src, /\[Content_Types\]\.xml/)
  assert.match(src, /\+ '\.xlsx'/)
  // Direct binary PDF download (no window.open / window.print popup)
  assert.equal(src.includes('window.open('), false)
  assert.equal(src.includes('window.print('), false)
  assert.match(src, /%PDF-1\.4/)
  assert.match(src, /new Blob\(\[pdfBuffer\],\s*\{\s*type:\s*'application\/pdf'\s*\}\)/)
})

test('My Account is removed, Sidebar shows Settings and Help without Sign out, Shimmer runs large Loading text only on reload & Refresh', () => {
  const routesSrc = readRepoFile('src/app/routes.ts')
  const typesSrc = readRepoFile('src/types/index.ts')
  const policySrc = readRepoFile('src/shared/auth-policy.ts')
  const ownerSrc = readRepoFile('src/shared/layout/OwnerDropdown.tsx')
  const sidebarSrc = readRepoFile('src/shared/layout/Sidebar.tsx')
  const reportsSrc = readRepoFile('src/features/reports/ReportsPage.tsx')
  const appSrc = readRepoFile('src/App.tsx')
  const shimmerSrc = readRepoFile('src/shared/ui/TextShimmer.tsx')

  assert.equal(routesSrc.includes('My Account'), false)
  assert.equal(typesSrc.includes('My Account'), false)
  assert.equal(policySrc.includes('My Account'), false)
  assert.equal(ownerSrc.includes('My Account'), false)
  assert.match(ownerSrc, /Sign Out/)

  assert.equal(sidebarSrc.includes('My Account'), false)
  assert.equal(sidebarSrc.includes('Sign out'), false)
  assert.match(sidebarSrc, /onNavigate\('Settings'\)/)
  assert.match(sidebarSrc, /setShowHelp\(/)
  assert.match(sidebarSrc, /onNavigate\('Help Center'\)/)

  assert.match(reportsSrc, /<DateRangeFilter/)
  assert.equal(reportsSrc.includes('Select branch scope'), false)
  assert.match(reportsSrc, /triggerRefreshShimmer\(\)/)

  assert.match(appSrc, /PageTransitionShimmer/)
  assert.equal(appSrc.includes('key={pageKey}'), false)
  assert.match(shimmerSrc, /<LoaderOne \/>/)
  assert.match(readRepoFile('src/shared/ui/LoaderOne.tsx'), /bg-blue-500/)
  assert.match(readRepoFile('src/shared/ui/ShimmerLoading.tsx'), /<LoaderOne \/>/)
})

test('Settings is full-width with password-protected Save/Reset, custom system logo only inside POS, unclipped Reports donut, and real support number', () => {
  const settingsSrc = readRepoFile('src/features/settings/SettingsPage.tsx')
  const headerSrc = readRepoFile('src/shared/layout/TopNavHeader.tsx')
  const posDialogsSrc = readRepoFile('src/features/pos/PosDialogs.tsx')
  const posCssSrc = readRepoFile('src/features/pos/pos.css')
  const reportsSrc = readRepoFile('src/features/reports/ReportsPage.tsx')
  const loginSrc = readRepoFile('src/app/auth/LoginPage.tsx')
  const registerSrc = readRepoFile('src/app/auth/RegisterPage.tsx')

  // Full width layout (no 1220 cap) + horizontal top tabs + no Display tab
  assert.equal(settingsSrc.includes('maxWidth: 1220'), false)
  assert.equal(settingsSrc.includes("'Display'"), false)
  assert.equal(settingsSrc.includes('Display &amp; App'), false)
  assert.match(settingsSrc, /flexDirection:\s*'column'/)
  assert.match(settingsSrc, /flexWrap:\s*'wrap'/)

  // Password-protected Save Settings & Reset to Default + editable Store/Branch name + Custom Logo
  assert.match(settingsSrc, /window\.vertexia\.auth\.updateBusiness/)
  assert.match(settingsSrc, /window\.vertexia\.auth\.verifyPassword/)
  assert.match(settingsSrc, /Store \/ Business Name/)
  assert.match(settingsSrc, /customLogoDataUrl/)

  // Receipt textarea + Shift+Enter hint + overflow protection
  assert.match(settingsSrc, /Shift \+ Enter/)
  assert.match(settingsSrc, /overflowWrap:\s*'anywhere'/)
  assert.match(settingsSrc, /whiteSpace:\s*'pre-wrap'/)
  assert.match(posCssSrc, /overflow-wrap:\s*anywhere/)
  assert.match(posCssSrc, /white-space:\s*pre-wrap/)

  // System logo applies inside POS (Navbar, Sidebar, Receipt, Help), NEVER on Login/Register
  assert.match(headerSrc, /useSystemLogo\(\)/)
  assert.equal(headerSrc.includes('Retail_POS_Logo-removebg-preview.png'), false)
  assert.match(posDialogsSrc, /useSystemLogo\(\)/)
  assert.equal(loginSrc.includes('useSystemLogo'), false)
  assert.equal(registerSrc.includes('useSystemLogo'), false)

  // Reports Sales by Category donut viewBox padded to avoid clipping
  assert.match(reportsSrc, /viewBox="0 0 42 42"/)
  assert.match(reportsSrc, /cx="21"/)
  assert.match(reportsSrc, /cy="21"/)
})

test('Help Card & Help Center use single support config with 92 317 2981931, proper WhatsApp URL encoding, safe clipboard fields, offline bundle, and Cashier access', () => {
  const configSrc = readRepoFile('src/shared/config/supportConfig.ts')
  const dictSrc = readRepoFile('src/shared/i18n/helpDictionary.ts')
  const sidebarSrc = readRepoFile('src/shared/layout/Sidebar.tsx')
  const helpPageSrc = readRepoFile('src/features/help/HelpCenterPage.tsx')
  const policySrc = readRepoFile('src/shared/auth-policy.ts')
  const routesSrc = readRepoFile('src/app/routes.ts')

  // Single config file holds phone/WhatsApp/hours — components reference SUPPORT_CONFIG, never hardcoded numbers
  assert.match(configSrc, /supportNumber:\s*'\+92 317 2981931'/)
  assert.match(configSrc, /whatsappNumber:\s*'\+92 317 2981931'/)
  assert.match(configSrc, /Mon to Sat, 10:00 AM to 8:00 PM/)
  assert.equal(sidebarSrc.includes('+92 317 2981931'), false)
  assert.equal(helpPageSrc.includes('+92 317 2981931'), false)
  assert.match(sidebarSrc, /SUPPORT_CONFIG/)
  assert.match(helpPageSrc, /SUPPORT_CONFIG/)

  // WhatsApp URL format & URL encoding
  assert.match(configSrc, /https:\/\/wa\.me\/\$\{phone\}\?text=\$\{encodeURIComponent\(message\)\}/)
  assert.match(configSrc, /Hello Vertexia Support, I need help with my POS\.\\n/)

  // Safe clipboard support info contains ONLY the 5 technical fields
  const clipBlock = configSrc.match(/buildSupportClipboardText[\s\S]*?\.join\('\\n'\)/)?.[0] ?? ''
  assert.match(clipBlock, /App Version/)
  assert.match(clipBlock, /License ID/)
  assert.match(clipBlock, /Device ID/)
  assert.match(clipBlock, /Database Size/)
  assert.match(clipBlock, /OS/)
  assert.equal(/password|customer|sales/i.test(clipBlock), false)

  // Language dictionary has English (ltr) + Urdu (rtl)
  assert.match(dictSrc, /dir:\s*'ltr'/)
  assert.match(dictSrc, /dir:\s*'rtl'/)
  assert.match(dictSrc, /Need Help\?/)
  assert.match(dictSrc, /مدد درکار ہے؟/)

  // Accessible without special permissions (Cashier included) & routed cleanly
  assert.match(policySrc, /page === 'Help Center'\) return true/)
  assert.match(routesSrc, /'#help-center': 'Help Center'/)

  // Offline bundled content & Report a Problem opens WhatsApp
  assert.match(helpPageSrc, /HelpCenterPage/)
  assert.match(helpPageSrc, /buildWhatsAppSupportUrl/)
})

test('Vertexia brand logo, Powered by Vertexia footer, LOADING shimmer, cash transaction actions & delete supplier UI', () => {
  const sidebarSrc = readRepoFile('src/shared/layout/Sidebar.tsx')
  const helpPageSrc = readRepoFile('src/features/help/HelpCenterPage.tsx')
  const configSrc = readRepoFile('src/shared/config/supportConfig.ts')
  const baseCss = readRepoFile('src/styles/base.css')
  const shimmerSrc = readRepoFile('src/shared/ui/TextShimmer.tsx')
  const cashPageSrc = readRepoFile('src/features/cash-shifts/CashShiftsPage.tsx')
  const suppliersSrc = readRepoFile('src/features/suppliers/SuppliersPage.tsx')

  // Fixed transparent Vertexia logo (never overridden by store settings)
  assert.equal(existsSync(join(process.cwd(), 'public/vertexia-logo-transparent.png')), true)
  assert.match(configSrc, /VERTEXIA_BRAND_LOGO\s*=\s*'\/vertexia-logo-transparent\.png'/)
  assert.match(sidebarSrc, /src=\{VERTEXIA_BRAND_LOGO\}/)
  assert.match(sidebarSrc, /Powered by Vertexia/)
  assert.match(helpPageSrc, /src=\{VERTEXIA_BRAND_LOGO\}/)
  assert.equal(/useSystemLogo/.test(helpPageSrc), false)

  // LoaderOne bouncing dots animation in loading overlay & ShimmerLoading
  const loaderSrc = readRepoFile('src/shared/ui/LoaderOne.tsx')
  assert.match(loaderSrc, /framer-motion/)
  assert.match(loaderSrc, /repeat:\s*Infinity/)
  assert.match(shimmerSrc, /import LoaderOne from '\.\/LoaderOne'/)

  // Cash Shifts human-readable descriptions + 3-dots actions dropdown & modal
  assert.match(cashPageSrc, /formatMovementDescription/)
  assert.match(cashPageSrc, /View Details/)
  assert.match(cashPageSrc, /Copy Reference/)
  assert.match(cashPageSrc, /Cash Transaction Details/)

  // Suppliers 3-dots Delete Supplier menu & confirm modal
  assert.match(suppliersSrc, /Delete Supplier/)
  assert.match(suppliersSrc, /DeleteSupplierModal/)
  assert.match(suppliersSrc, /Deactivate Supplier/)
})
