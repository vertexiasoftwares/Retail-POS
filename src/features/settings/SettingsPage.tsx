import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { PageShell, type PageProps } from '../../shared/layout/PageShell'
import { TopNavHeader } from '../../shared/layout/TopNavHeader'
import { Icon, type IconName } from '../../shared/ui/Icon'
import { useAuth } from '../../app/auth/useAuth'
import { localBusinessDate } from '../../shared/account-format'
import {
  savePosSettings,
  usePosSettings,
  type PosSettings,
} from '../../shared/settings/posSettings'
import { exportToExcel, exportToPdf } from '../../shared/utils/exportUtils'
import { triggerRefreshShimmer } from '../../services/retail-events'
import type { BackupStatus, BackupSummary } from '../../types/recovery'
import type { PosPaymentMethod } from '../../types/desktop-api'
import '../../styles/recovery.css'

type SettingsTab =
  | 'Business'
  | 'Receipt'
  | 'POS & Billing'
  | 'Inventory'
  | 'Cash & Shifts'
  | 'Security'
  | 'Backup'
  | 'Data Export'

const TABS: { id: SettingsTab; icon: IconName; label: string }[] = [
  { id: 'Business', icon: 'store', label: 'Business Info' },
  { id: 'Receipt', icon: 'receipt', label: 'Receipt' },
  { id: 'POS & Billing', icon: 'sale', label: 'POS & Billing' },
  { id: 'Inventory', icon: 'inventory', label: 'Inventory' },
  { id: 'Cash & Shifts', icon: 'cash', label: 'Cash & Shifts' },
  { id: 'Security', icon: 'lock', label: 'Security' },
  { id: 'Backup', icon: 'shieldCheck', label: 'Backup & Restore' },
  { id: 'Data Export', icon: 'download', label: 'Data Export' },
]

export default function SettingsPage(props: PageProps) {
  const { session, canPage, acceptSession } = useAuth()
  const settings = usePosSettings()
  const [activeTab, setActiveTab] = useState<SettingsTab>('Business')

  // Change password inside Security tab
  const [pwCurrent, setPwCurrent] = useState('')
  const [pwNew, setPwNew] = useState('')
  const [pwConfirm, setPwConfirm] = useState('')
  const [pwBusy, setPwBusy] = useState(false)

  // Backup state
  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [preview, setPreview] = useState<BackupSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [backupOwnerUsername, setBackupOwnerUsername] = useState('')
  const [backupOwnerPassword, setBackupOwnerPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [allowDifferentInstallation, setAllowDifferentInstallation] = useState(false)

  const isWebClient = Boolean(
    status?.remoteClient || status?.canRestore === false || typeof window === 'undefined' || !window.desktopApp
  )

  const refreshBackup = useCallback(async () => {
    if (window.vertexia?.backup?.getStatus) {
      setStatus(await window.vertexia.backup.getStatus())
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(
      () => void refreshBackup().catch(cause => setError(String((cause as Error).message ?? cause))),
      0
    )
    return () => window.clearTimeout(timer)
  }, [refreshBackup])

  useEffect(() => {
    if (!notice) return
    const t = window.setTimeout(() => setNotice(''), 3500)
    return () => window.clearTimeout(t)
  }, [notice])

  const updateSetting = <K extends keyof PosSettings>(key: K, value: PosSettings[K], feedback?: string) => {
    savePosSettings({ [key]: value })
    if (feedback) setNotice(feedback)
  }

  const run = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
      await refreshBackup()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Operation failed.')
    } finally {
      setBusy(false)
    }
  }

  const handlePasswordChange = async (e: FormEvent) => {
    e.preventDefault()
    if (pwBusy) return
    setError('')
    setNotice('')
    if (pwNew.length < 8) {
      setError('New password must be at least 8 characters.')
      return
    }
    if (pwNew !== pwConfirm) {
      setError('New password and confirmation do not match.')
      return
    }
    if (!window.vertexia?.auth?.changePassword) {
      setError('Password service unavailable.')
      return
    }
    setPwBusy(true)
    try {
      const updated = await window.vertexia.auth.changePassword(pwCurrent, pwNew)
      acceptSession(updated)
      setPwCurrent('')
      setPwNew('')
      setPwConfirm('')
      setNotice('Password updated successfully.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not change password.')
    } finally {
      setPwBusy(false)
    }
  }

  const cardStyle: React.CSSProperties = {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    padding: '20px 22px',
    marginBottom: 16,
  }

  const labelStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    fontSize: 14,
    fontWeight: 600,
    color: '#1e293b',
    marginBottom: 14,
  }

  const inputStyle: React.CSSProperties = {
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid #cbd5e1',
    fontSize: 14,
    color: '#0f172a',
    background: '#ffffff',
    width: '100%',
    boxSizing: 'border-box',
  }

  const checkLabelStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 500,
    color: '#1e293b',
    padding: '6px 0',
  }

  const runDataExport = async (kind: 'products' | 'customers' | 'suppliers', format: 'xlsx' | 'pdf') => {
    if (!session) return
    setError('')
    try {
      let title = ''
      let headers: string[] = []
      let rows: (string | number)[][] = []
      const branchId = session.branchId

      if (kind === 'products') {
        const res = await window.vertexia!.products.list({
          branchId,
          search: '',
          category: 'all',
          brand: 'all',
          status: 'all',
          page: 1,
          pageSize: 10000,
        })
        title = 'Products Catalog Export'
        headers = ['Name', 'Barcode', 'SKU', 'Category', 'Brand', 'Unit', 'Purchase Price (Rs)', 'Sale Price (Rs)', 'Stock', 'Min Stock', 'Status']
        rows = res.products.map(p => [
          p.name,
          p.barcode || '',
          p.sku || '',
          p.category || '',
          p.brand || '',
          p.unit || '',
          (p.purchasePricePaisa / 100).toFixed(2),
          (p.sellingPricePaisa / 100).toFixed(2),
          (p.stockMilli / 1000).toFixed(3),
          (p.minimumStockMilli / 1000).toFixed(3),
          p.status,
        ])
      } else if (kind === 'customers') {
        const res = await window.vertexia!.customers.list({
          branchId,
          search: '',
          filter: 'all',
          page: 1,
          pageSize: 10000,
        })
        title = 'Customers & Udhaar Export'
        headers = ['Name', 'Phone', 'Balance (Rs)', 'Credit Sales (Rs)', 'Collected (Rs)', 'Returns (Rs)', 'Status']
        rows = res.customers.map(c => [
          c.name,
          c.phone || '',
          (c.balancePaisa / 100).toFixed(2),
          (c.creditSalesPaisa / 100).toFixed(2),
          (c.collectedPaisa / 100).toFixed(2),
          (c.returnsPaisa / 100).toFixed(2),
          c.isActive ? 'Active' : 'Inactive',
        ])
      } else {
        const snap = await window.vertexia!.retail.getSnapshot(branchId)
        title = 'Suppliers Export'
        headers = ['Name', 'Phone', 'City', 'Total Purchases (Rs)', 'Total Paid (Rs)', 'Outstanding Due (Rs)', 'Status']
        rows = snap.suppliers.map(s => [
          s.name,
          s.phone || '',
          s.city || '',
          (s.totalPurchasesPaisa / 100).toFixed(2),
          (s.totalPaidPaisa / 100).toFixed(2),
          (s.outstandingPaisa / 100).toFixed(2),
          s.isActive ? 'Active' : 'Inactive',
        ])
      }

      const payload = {
        filename: `${kind}-export-${localBusinessDate()}`,
        title,
        subtitle: `${session.businessName} | ${session.branches.find(b => b.id === branchId)?.name ?? 'Branch'}`,
        headers,
        rows,
      }

      if (format === 'xlsx') exportToExcel(payload)
      else exportToPdf(payload)
      setNotice(`${title} downloaded (${format.toUpperCase()}).`)
    } catch (cause) {
      setError('Export failed: ' + (cause instanceof Error ? cause.message : String(cause)))
    }
  }

  const activeBranch = session?.branches.find(b => b.id === session.branchId)
  const addressPreview = [settings.businessAddress, settings.businessCity].filter(Boolean).join(', ')

  return (
    <PageShell
      {...props}
      activePage="Settings"
      header={() => (
        <TopNavHeader
          title="Settings"
          subtitle="Configure store receipts, POS behavior, security and backups"
          onNavigate={props.onNavigate}
          extraRight={
            <button
              type="button"
              onClick={() => {
                triggerRefreshShimmer()
                void refreshBackup()
              }}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                border: '1px solid #cbd5e1',
                background: '#f8fafc',
                fontSize: 14,
                fontWeight: 600,
                color: '#334155',
                cursor: 'pointer',
              }}
            >
              Refresh
            </button>
          }
        />
      )}
    >
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 110px)' }}>
        {/* Horizontal Top Tabs Bar */}
        <nav
          aria-label="Settings sections"
          style={{
            background: '#ffffff',
            borderBottom: '1px solid #e2e8f0',
            padding: '12px 24px',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {TABS.map(tab => {
            const active = activeTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                aria-current={active ? 'page' : undefined}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '9px 15px',
                  borderRadius: 10,
                  border: active ? '1px solid #7c3aed' : '1px solid #e2e8f0',
                  background: active ? 'linear-gradient(135deg, #7A35F6, #5E0CF3)' : '#f8fafc',
                  color: active ? '#ffffff' : '#334155',
                  fontWeight: active ? 700 : 600,
                  fontSize: 14,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  boxShadow: active ? '0 3px 10px rgba(94, 12, 243, 0.22)' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                <Icon name={tab.icon} size={17} />
                <span>{tab.label}</span>
              </button>
            )
          })}
        </nav>

        {/* Main Content Area */}
        <div style={{ flex: 1, padding: '24px 28px', maxWidth: 1220, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
          {error && (
            <div role="alert" style={{ color: '#991b1b', background: '#fee2e2', border: '1px solid #fecaca', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 14, fontWeight: 500 }}>
              {error}
            </div>
          )}
          {notice && (
            <div role="status" style={{ color: '#166534', background: '#dcfce7', border: '1px solid #bbf7d0', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 14, fontWeight: 500 }}>
              {notice}
            </div>
          )}

          {/* ── Business Info ── */}
          {activeTab === 'Business' && (
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>Business Information</h2>
              <p style={{ fontSize: 14, color: '#475569', marginBottom: 20 }}>
                Shop contact details saved here are automatically printed on your POS receipts and exported reports.
              </p>
              <div style={cardStyle}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
                  <label style={labelStyle}>
                    Business Name
                    <input style={{ ...inputStyle, background: '#f8fafc', color: '#475569' }} value={session?.businessName ?? ''} readOnly />
                  </label>
                  <label style={labelStyle}>
                    Active Branch
                    <input style={{ ...inputStyle, background: '#f8fafc', color: '#475569' }} value={activeBranch ? `${activeBranch.name} (${activeBranch.code})` : 'Main Branch'} readOnly />
                  </label>
                  <label style={labelStyle}>
                    Shop Phone Number
                    <input
                      style={inputStyle}
                      value={settings.businessPhone}
                      placeholder="+92 300 1234567"
                      onChange={e => updateSetting('businessPhone', e.target.value)}
                    />
                  </label>
                  <label style={labelStyle}>
                    City / Area
                    <input
                      style={inputStyle}
                      value={settings.businessCity}
                      placeholder="Lahore"
                      onChange={e => updateSetting('businessCity', e.target.value)}
                    />
                  </label>
                </div>
                <label style={labelStyle}>
                  Shop Address (shown on receipts)
                  <textarea
                    style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }}
                    value={settings.businessAddress}
                    placeholder="Shop #1, Main Bazaar, Lahore"
                    onChange={e => updateSetting('businessAddress', e.target.value)}
                  />
                </label>
                <label style={labelStyle}>
                  NTN / Tax Registration Number
                  <input
                    style={inputStyle}
                    value={settings.taxNumber}
                    placeholder="Optional — printed on bills if filled"
                    onChange={e => updateSetting('taxNumber', e.target.value)}
                  />
                </label>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
                  <button
                    type="button"
                    onClick={() => setNotice('Business details saved and applied to receipts.')}
                    style={{ padding: '10px 18px', borderRadius: 8, border: 0, background: '#5E0CF3', color: '#ffffff', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}
                  >
                    <Icon name="check" size={16} /> Save Store Info
                  </button>
                  {canPage('Branches') && (
                    <button
                      type="button"
                      onClick={() => props.onNavigate('Branches')}
                      style={{ padding: '10px 16px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#ffffff', color: '#1e293b', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}
                    >
                      <Icon name="store" size={16} /> Manage Branches
                    </button>
                  )}
                  {canPage('License') && (
                    <button
                      type="button"
                      onClick={() => props.onNavigate('License')}
                      style={{ padding: '10px 16px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#ffffff', color: '#1e293b', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}
                    >
                      <Icon name="key" size={16} /> License Status
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Receipt ── */}
          {activeTab === 'Receipt' && (
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>Receipt Settings</h2>
              <p style={{ fontSize: 14, color: '#475569', marginBottom: 20 }}>
                Customize POS bill layout, store details, and footer message. Changes apply immediately to POS receipts.
              </p>
              <div style={cardStyle}>
                <label style={labelStyle}>
                  Receipt Header Tagline
                  <textarea
                    rows={2}
                    style={{ ...inputStyle, minHeight: 62, resize: 'vertical', lineHeight: 1.5 }}
                    value={settings.receiptHeader}
                    placeholder="e.g. Fresh Grocery & Daily Needs"
                    onChange={e => updateSetting('receiptHeader', e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        // Allow normal Enter and Shift+Enter both to add newline cleanly without form submit
                        e.stopPropagation()
                      }
                    }}
                  />
                  <span style={{ fontSize: 14, fontWeight: 400, color: '#475569' }}>
                    Press <strong>Shift + Enter</strong> (or Enter) to move text to the next line.
                  </span>
                </label>
                <label style={labelStyle}>
                  Receipt Footer / Thank You Note
                  <textarea
                    rows={3}
                    style={{ ...inputStyle, minHeight: 78, resize: 'vertical', lineHeight: 1.5 }}
                    value={settings.receiptFooter}
                    placeholder="Thank you for shopping with us."
                    onChange={e => updateSetting('receiptFooter', e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.stopPropagation()
                      }
                    }}
                  />
                  <span style={{ fontSize: 14, fontWeight: 400, color: '#475569' }}>
                    Press <strong>Shift + Enter</strong> to add a new line on the printed receipt.
                  </span>
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
                  <label style={checkLabelStyle}>
                    <input
                      type="checkbox"
                      checked={settings.showLogoOnReceipt}
                      onChange={e => updateSetting('showLogoOnReceipt', e.target.checked, 'Receipt preference saved.')}
                      style={{ width: 17, height: 17 }}
                    />
                    Show store logo on receipt
                  </label>
                  <label style={checkLabelStyle}>
                    <input
                      type="checkbox"
                      checked={settings.showBusinessDetailsOnReceipt}
                      onChange={e => updateSetting('showBusinessDetailsOnReceipt', e.target.checked, 'Receipt preference saved.')}
                      style={{ width: 17, height: 17 }}
                    />
                    Show phone, address, and NTN on receipt
                  </label>
                  <label style={checkLabelStyle}>
                    <input
                      type="checkbox"
                      checked={settings.showCashierOnReceipt}
                      onChange={e => updateSetting('showCashierOnReceipt', e.target.checked, 'Receipt preference saved.')}
                      style={{ width: 17, height: 17 }}
                    />
                    Show cashier name on receipt
                  </label>
                </div>
              </div>

              <div style={{ ...cardStyle, background: '#f8fafc' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <span style={{ fontSize: 14, color: '#334155', fontWeight: 700 }}>Live Receipt Preview</span>
                  <button
                    type="button"
                    onClick={() => window.print()}
                    style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#ffffff', color: '#1e293b', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  >
                    <Icon name="receipt" size={16} /> Print Test
                  </button>
                </div>
                <div
                  style={{
                    background: '#ffffff',
                    border: '1px dashed #cbd5e1',
                    borderRadius: 8,
                    padding: 18,
                    fontFamily: 'monospace',
                    fontSize: 14,
                    color: '#0f172a',
                    lineHeight: 1.65,
                    maxWidth: 360,
                    width: '100%',
                    boxSizing: 'border-box',
                    margin: '0 auto',
                    overflow: 'hidden',
                    overflowWrap: 'anywhere',
                    wordBreak: 'break-word',
                  }}
                >
                  {settings.showLogoOnReceipt && (
                    <img
                      src="/retail-logo-transparent.png"
                      alt="Store logo"
                      style={{ height: 32, width: 'auto', display: 'block', margin: '0 auto 6px' }}
                    />
                  )}
                  <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 16, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                    {session?.businessName ?? 'Your Store'}
                  </div>
                  <div style={{ textAlign: 'center', color: '#475569', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                    {activeBranch?.name ?? 'Main Branch'}
                  </div>
                  {settings.showBusinessDetailsOnReceipt && (
                    <>
                      {addressPreview && <div style={{ textAlign: 'center', color: '#475569', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{addressPreview}</div>}
                      {settings.businessPhone && <div style={{ textAlign: 'center', color: '#475569', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>Tel: {settings.businessPhone}</div>}
                      {settings.taxNumber && <div style={{ textAlign: 'center', color: '#475569', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>NTN: {settings.taxNumber}</div>}
                    </>
                  )}
                  {settings.receiptHeader && (
                    <div style={{ textAlign: 'center', fontWeight: 700, marginTop: 4, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                      {settings.receiptHeader}
                    </div>
                  )}
                  <div style={{ borderTop: '1px dashed #cbd5e1', margin: '10px 0' }} />
                  <div>Bill #: BILL-001</div>
                  <div>Date: {localBusinessDate()}</div>
                  {settings.showCashierOnReceipt && <div>Cashier: {session?.name ?? 'Owner'}</div>}
                  <div style={{ borderTop: '1px dashed #cbd5e1', margin: '10px 0' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span>Basmati Rice 1kg</span><span>Rs 320</span></div>
                  <div style={{ borderTop: '1px dashed #cbd5e1', margin: '10px 0' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, gap: 8 }}><span>Total</span><span>Rs 320</span></div>
                  {settings.receiptFooter && (
                    <div style={{ textAlign: 'center', color: '#475569', marginTop: 10, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                      {settings.receiptFooter}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── POS & Billing ── */}
          {activeTab === 'POS & Billing' && (
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>POS & Billing</h2>
              <p style={{ fontSize: 14, color: '#475569', marginBottom: 20 }}>
                Control default checkout method and discount rules on the POS screen.
              </p>
              <div style={cardStyle}>
                <label style={labelStyle}>
                  Default Payment Method
                  <select
                    style={{ ...inputStyle, maxWidth: 260 }}
                    value={settings.defaultPaymentMethod}
                    onChange={e =>
                      updateSetting(
                        'defaultPaymentMethod',
                        e.target.value as Exclude<PosPaymentMethod, 'Udhaar'>,
                        `Default payment method set to ${e.target.value}.`
                      )
                    }
                  >
                    <option value="Cash">Cash</option>
                    <option value="Card">Card</option>
                    <option value="JazzCash">JazzCash</option>
                    <option value="Easypaisa">Easypaisa</option>
                  </select>
                  <span style={{ fontSize: 14, fontWeight: 400, color: '#475569' }}>
                    Selected automatically when opening POS and after completing each bill.
                  </span>
                </label>

                <label style={checkLabelStyle}>
                  <input
                    type="checkbox"
                    checked={settings.allowLineDiscounts}
                    onChange={e => updateSetting('allowLineDiscounts', e.target.checked, 'POS discount rule updated.')}
                    style={{ width: 17, height: 17 }}
                  />
                  Allow item &amp; quick cart discounts in POS (for permitted staff)
                </label>
              </div>
            </div>
          )}

          {/* ── Inventory ── */}
          {activeTab === 'Inventory' && (
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>Inventory Settings</h2>
              <p style={{ fontSize: 14, color: '#475569', marginBottom: 20 }}>
                Set default alert levels for newly created products.
              </p>
              <div style={cardStyle}>
                <label style={labelStyle}>
                  Default Minimum Stock Alert Level
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input
                      type="number"
                      style={{ ...inputStyle, width: 140 }}
                      value={settings.defaultMinStock}
                      min={0}
                      onChange={e => updateSetting('defaultMinStock', Math.max(0, Number(e.target.value) || 0))}
                    />
                    <span style={{ fontSize: 14, fontWeight: 400, color: '#475569' }}>units / kg</span>
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 400, color: '#475569' }}>
                    Automatically pre-filled as Minimum Stock when adding a new product in the Products catalog.
                  </span>
                </label>
                <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                  <button
                    type="button"
                    onClick={() => setNotice(`Default low stock level saved (${settings.defaultMinStock}).`)}
                    style={{ padding: '10px 18px', borderRadius: 8, border: 0, background: '#5E0CF3', color: '#ffffff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                  >
                    Save Threshold
                  </button>
                  {canPage('Inventory') && (
                    <button
                      type="button"
                      onClick={() => props.onNavigate('Inventory')}
                      style={{ padding: '10px 16px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#ffffff', color: '#1e293b', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                    >
                      Open Inventory
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Cash & Shifts ── */}
          {activeTab === 'Cash & Shifts' && (
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>Cash &amp; Shifts</h2>
              <p style={{ fontSize: 14, color: '#475569', marginBottom: 20 }}>
                Pre-configure shift opening cash float defaults.
              </p>
              <div style={cardStyle}>
                <label style={labelStyle}>
                  Default Opening Cash Float (Rs)
                  <input
                    type="number"
                    style={{ ...inputStyle, width: 180 }}
                    value={settings.defaultOpeningCashRupees}
                    min={0}
                    onChange={e => updateSetting('defaultOpeningCashRupees', Math.max(0, Number(e.target.value) || 0))}
                  />
                  <span style={{ fontSize: 14, fontWeight: 400, color: '#475569' }}>
                    Automatically pre-fills the Opening Cash input in both POS and Cash &amp; Shifts modals.
                  </span>
                </label>
                <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                  <button
                    type="button"
                    onClick={() => setNotice(`Default opening cash saved (Rs ${settings.defaultOpeningCashRupees}).`)}
                    style={{ padding: '10px 18px', borderRadius: 8, border: 0, background: '#5E0CF3', color: '#ffffff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                  >
                    Save Cash Default
                  </button>
                  {canPage('Cash & Shifts') && (
                    <button
                      type="button"
                      onClick={() => props.onNavigate('Cash & Shifts')}
                      style={{ padding: '10px 16px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#ffffff', color: '#1e293b', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                    >
                      Open Cash &amp; Shifts
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Security ── */}
          {activeTab === 'Security' && (
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>Security &amp; Account</h2>
              <p style={{ fontSize: 14, color: '#475569', marginBottom: 20 }}>
                Update your login password and review staff role access.
              </p>

              <div style={cardStyle}>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', marginBottom: 12 }}>Change Password</h3>
                <form onSubmit={handlePasswordChange} style={{ maxWidth: 420 }}>
                  <label style={labelStyle}>
                    Current Password
                    <input
                      type="password"
                      required
                      autoComplete="current-password"
                      value={pwCurrent}
                      onChange={e => setPwCurrent(e.target.value)}
                      style={inputStyle}
                    />
                  </label>
                  <label style={labelStyle}>
                    New Password (8–128 characters)
                    <input
                      type="password"
                      required
                      minLength={8}
                      maxLength={128}
                      autoComplete="new-password"
                      value={pwNew}
                      onChange={e => setPwNew(e.target.value)}
                      style={inputStyle}
                    />
                  </label>
                  <label style={labelStyle}>
                    Confirm New Password
                    <input
                      type="password"
                      required
                      minLength={8}
                      autoComplete="new-password"
                      value={pwConfirm}
                      onChange={e => setPwConfirm(e.target.value)}
                      style={inputStyle}
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={pwBusy}
                    style={{ padding: '10px 18px', borderRadius: 8, border: 0, background: '#5E0CF3', color: '#ffffff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                  >
                    {pwBusy ? 'Updating…' : 'Update Password'}
                  </button>
                </form>
              </div>

              <div style={cardStyle}>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>Staff Permissions</h3>
                <p style={{ fontSize: 14, color: '#475569', marginBottom: 12 }}>
                  Signed in as <strong>{session?.name}</strong> ({session?.role}). Manage cashier/manager accounts and tab access in Staff.
                </p>
                {canPage('Staff') && (
                  <button
                    type="button"
                    onClick={() => props.onNavigate('Staff')}
                    style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#ffffff', color: '#1e293b', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}
                  >
                    <Icon name="users" size={16} /> Open Staff &amp; Permissions
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── Backup & Restore ── */}
          {activeTab === 'Backup' && (
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>Backup &amp; Restore</h2>
              <p style={{ fontSize: 14, color: '#475569', marginBottom: 20 }}>
                Owner access only. Backups include all branches, stock, sales, purchases, cash shifts and user accounts.
              </p>
              {isWebClient && (
                <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, padding: '10px 14px', fontSize: 14, color: '#78350f', marginBottom: 16 }}>
                  Take backups from the main PC. You can trigger server backups here, while database restore is locked on web browsers.
                </div>
              )}
              <div style={cardStyle}>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>Protect Your Data</h3>
                <p style={{ fontSize: 14, color: '#475569', marginBottom: 14 }}>
                  A local automatic backup is created once a day while the desktop app runs. Store backup files in a safe private drive.
                </p>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    style={{ padding: '10px 18px', borderRadius: 8, border: 0, background: '#5E0CF3', color: '#ffffff', fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: busy || status?.busy ? 0.6 : 1, display: 'inline-flex', alignItems: 'center', gap: 8 }}
                    disabled={busy || status?.busy}
                    onClick={() =>
                      void run(async () => {
                        if (!window.vertexia?.backup?.create) return
                        const record = await window.vertexia.backup.create()
                        setNotice('Backup created: ' + record.fileName)
                      })
                    }
                  >
                    <Icon name="shieldCheck" size={16} /> Create Backup
                  </button>
                  <button
                    type="button"
                    style={{ padding: '10px 18px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#ffffff', color: '#1e293b', fontSize: 14, fontWeight: 600, cursor: isWebClient ? 'not-allowed' : 'pointer', opacity: isWebClient ? 0.5 : 1, display: 'inline-flex', alignItems: 'center', gap: 8 }}
                    disabled={busy || status?.busy || isWebClient}
                    title={isWebClient ? 'Restore from the main PC' : undefined}
                    onClick={() =>
                      void run(async () => {
                        if (isWebClient || !window.vertexia?.backup?.previewRestore) return
                        if (preview) await window.vertexia.backup.cancelRestore(preview.token)
                        setPreview(null)
                        const result = await window.vertexia.backup.previewRestore()
                        if (!result.canceled && result.summary) {
                          setPreview(result.summary)
                          setBackupOwnerUsername(result.summary.ownerUsernames[0] ?? '')
                          setBackupOwnerPassword('')
                          setCurrentPassword('')
                          setConfirmation('')
                          setAllowDifferentInstallation(false)
                        }
                      })
                    }
                  >
                    <Icon name="upload" size={16} /> Select Backup to Restore
                  </button>
                </div>
                <div style={{ marginTop: 12, fontSize: 14, color: '#475569', wordBreak: 'break-all' }}>
                  Local folder: {status?.directory || (isWebClient ? 'Managed on the main PC' : 'Loading…')}
                </div>
                {status?.lastAutomaticError && (
                  <div style={{ color: '#991b1b', background: '#fee2e2', padding: '8px 12px', borderRadius: 6, marginTop: 10, fontSize: 14 }}>
                    Automatic backup failed: {status.lastAutomaticError}
                  </div>
                )}
              </div>

              {preview && (
                <div style={{ ...cardStyle, border: '1px solid #fbbf24' }}>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>Review Restore</h3>
                  <p style={{ fontSize: 14, color: '#334155' }}>
                    <strong>{preview.businessName}</strong> · {new Date(preview.createdAt).toLocaleString()} · {preview.fileName}
                  </p>
                  <p style={{ fontSize: 14, color: '#475569' }}>
                    {preview.products} products, {preview.sales} sales, {preview.purchases} purchases, {preview.openShifts} open shifts.
                  </p>
                  <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, padding: '10px 14px', fontSize: 14, color: '#7c2d12', marginBottom: 14 }}>
                    Restore will replace all current records. Close open shifts first. Sign in with backup credentials after restore.
                  </div>
                  <form
                    onSubmit={e => {
                      e.preventDefault()
                      if (busy || !window.vertexia?.backup?.restore) return
                      setBusy(true)
                      setError('')
                      void window.vertexia.backup
                        .restore({ token: preview.token, currentPassword, backupOwnerUsername, backupOwnerPassword, confirmation, allowDifferentInstallation })
                        .then(() => window.dispatchEvent(new Event('vertexia:auth-refresh')))
                        .catch(cause => setError(String((cause as Error).message ?? cause)))
                        .finally(() => setBusy(false))
                    }}
                  >
                    <fieldset disabled={busy} style={{ border: 0, margin: 0, padding: 0 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 14 }}>
                        <label style={labelStyle}>
                          Current owner password
                          <input type="password" required value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} style={inputStyle} />
                        </label>
                        <label style={labelStyle}>
                          Owner username in backup
                          <input required value={backupOwnerUsername} onChange={e => setBackupOwnerUsername(e.target.value)} style={inputStyle} />
                        </label>
                        <label style={labelStyle}>
                          Owner password in backup
                          <input type="password" required value={backupOwnerPassword} onChange={e => setBackupOwnerPassword(e.target.value)} style={inputStyle} />
                        </label>
                      </div>
                      {!preview.sameInstallation && (
                        <label style={checkLabelStyle}>
                          <input type="checkbox" required checked={allowDifferentInstallation} onChange={e => setAllowDifferentInstallation(e.target.checked)} style={{ width: 17, height: 17 }} />
                          I intend to replace this installation with data from a different installation.
                        </label>
                      )}
                      <label style={labelStyle}>
                        Type RESTORE to confirm
                        <input required pattern="RESTORE" value={confirmation} onChange={e => setConfirmation(e.target.value)} style={inputStyle} />
                      </label>
                      <div style={{ display: 'flex', gap: 10 }}>
                        <button type="submit" style={{ padding: '10px 18px', borderRadius: 8, border: 0, background: '#dc2626', color: '#ffffff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                          Restore &amp; Sign Out
                        </button>
                        <button
                          type="button"
                          style={{ padding: '10px 18px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#ffffff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                          onClick={() =>
                            void run(async () => {
                              if (window.vertexia?.backup?.cancelRestore) await window.vertexia.backup.cancelRestore(preview.token)
                              setPreview(null)
                            })
                          }
                        >
                          Cancel
                        </button>
                      </div>
                      <div style={{ marginTop: 10, color: '#475569', fontSize: 14, wordBreak: 'break-all' }}>
                        SHA-256: {preview.checksum}
                      </div>
                    </fieldset>
                  </form>
                </div>
              )}

              <div style={cardStyle}>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>Backup History</h3>
                <p style={{ fontSize: 14, color: '#475569', marginBottom: 12 }}>Latest 100 backups stored locally.</p>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                    <thead>
                      <tr style={{ background: '#f8fafc' }}>
                        <th style={{ padding: '10px 12px', textAlign: 'left', color: '#334155', fontWeight: 600, borderBottom: '1px solid #e2e8f0' }}>Created</th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', color: '#334155', fontWeight: 600, borderBottom: '1px solid #e2e8f0' }}>Type</th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', color: '#334155', fontWeight: 600, borderBottom: '1px solid #e2e8f0' }}>File / Size</th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', color: '#334155', fontWeight: 600, borderBottom: '1px solid #e2e8f0' }}>Copy</th>
                      </tr>
                    </thead>
                    <tbody>
                      {status?.records.map(row => (
                        <tr key={row.id}>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid #f1f5f9' }}>{new Date(row.createdAt).toLocaleString()}</td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid #f1f5f9' }}>{row.kind.replaceAll('_', ' ')}</td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid #f1f5f9' }}>
                            <div>{row.fileName}</div>
                            <span style={{ color: '#475569', fontSize: 14 }}>{(row.sizeBytes / 1024 / 1024).toFixed(2)} MB</span>
                          </td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid #f1f5f9' }}>
                            <button
                              type="button"
                              disabled={busy || status.busy}
                              style={{ padding: '7px 14px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#ffffff', fontSize: 14, fontWeight: 600, color: '#1e293b', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                              onClick={() =>
                                void run(async () => {
                                  if (!window.vertexia?.backup?.export) return
                                  const result = await window.vertexia.backup.export(row.id)
                                  if (!result.canceled) setNotice('Backup copy saved: ' + result.path)
                                })
                              }
                            >
                              <Icon name="download" size={14} /> Save Copy
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {status && !status.records.length && (
                    <div style={{ textAlign: 'center', padding: 24, color: '#475569', fontSize: 14 }}>
                      No backups yet. Create your first backup above.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Data Export ── */}
          {activeTab === 'Data Export' && (
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>Data Export</h2>
              <p style={{ fontSize: 14, color: '#475569', marginBottom: 20 }}>
                Download clean Microsoft Excel workbooks (.xlsx) or formatted PDF files directly to your device.
              </p>
              <div style={cardStyle}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {(
                    [
                      { key: 'products', label: 'Export All Products', desc: 'Names, barcodes, SKUs, categories, brands, purchase/sale prices, and stock' },
                      { key: 'customers', label: 'Export All Customers', desc: 'Customer names, phone numbers, udhaar balances, and total collections' },
                      { key: 'suppliers', label: 'Export All Suppliers', desc: 'Supplier names, phone numbers, purchase totals, and balance due' },
                    ] as const
                  ).map(({ key, label, desc }) => (
                    <div
                      key={key}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: 12,
                        padding: '14px 16px',
                        background: '#f8fafc',
                        borderRadius: 10,
                        border: '1px solid #e2e8f0',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>{label}</div>
                        <div style={{ fontSize: 14, color: '#475569', marginTop: 2 }}>{desc}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          type="button"
                          onClick={() => void runDataExport(key, 'xlsx')}
                          style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #16a34a', background: '#ffffff', color: '#15803d', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                        >
                          <Icon name="download" size={15} /> Excel (.xlsx)
                        </button>
                        <button
                          type="button"
                          onClick={() => void runDataExport(key, 'pdf')}
                          style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #dc2626', background: '#ffffff', color: '#b91c1c', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                        >
                          <Icon name="report" size={15} /> PDF
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                {canPage('Reports') && (
                  <div style={{ marginTop: 16, background: '#eff6ff', borderRadius: 8, padding: '12px 14px', fontSize: 14, color: '#1e40af', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                    <span>For date-filtered Sales, Profit &amp; Loss, Expenses, and Staff reports, use Reports.</span>
                    <button
                      type="button"
                      onClick={() => props.onNavigate('Reports')}
                      style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #2563eb', background: '#ffffff', color: '#1d4ed8', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                    >
                      Open Reports
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </PageShell>
  )
}
