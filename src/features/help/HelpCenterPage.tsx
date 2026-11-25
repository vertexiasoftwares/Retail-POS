import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../../app/auth/useAuth'
import { PageShell, type PageProps } from '../../shared/layout/PageShell'
import { TopNavHeader } from '../../shared/layout/TopNavHeader'
import { Icon } from '../../shared/ui/Icon'
import {
  buildSupportClipboardText,
  buildWhatsAppSupportUrl,
  formatDbSize,
  formatLicenseExpiry,
  getSupportTelHref,
  SUPPORT_CONFIG,
} from '../../shared/config/supportConfig'
import { useHelpTranslation } from '../../shared/i18n/helpDictionary'
import { useSystemLogo } from '../../shared/settings/posSettings'
import { triggerRefreshShimmer } from '../../services/retail-events'
import type { SupportInfo } from '../../types/desktop-api'

async function openSupportWhatsApp(url: string): Promise<void> {
  if (window.desktopApp && window.vertexia?.system?.openExternal) {
    try {
      await window.vertexia.system.openExternal(url)
      return
    } catch {
      // Fallback to browser open if IPC unavailable
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

export default function HelpCenterPage(props: PageProps) {
  const { session } = useAuth()
  const { lang, setLang, t } = useHelpTranslation()
  const systemLogo = useSystemLogo()

  const [supportInfo, setSupportInfo] = useState<SupportInfo>(() => ({
    appVersion: SUPPORT_CONFIG.fallbackVersion,
    os: typeof navigator !== 'undefined' ? navigator.platform || 'Desktop' : 'Desktop',
    databaseSizeBytes: null,
    licenseId: 'Unregistered',
    licenseStatus: 'Active',
    licenseExpiryDate: null,
    deviceId: 'Local',
    shopName: session?.businessName ?? '',
  }))
  const [copied, setCopied] = useState(false)
  const [issueText, setIssueText] = useState('')
  const [screenshotName, setScreenshotName] = useState('')
  const [formError, setFormError] = useState('')

  const loadInfo = async () => {
    try {
      if (window.vertexia?.system?.getSupportInfo) {
        const info = await window.vertexia.system.getSupportInfo()
        setSupportInfo(prev => ({
          ...prev,
          ...info,
          shopName: info.shopName || session?.businessName || prev.shopName,
        }))
        return
      }
      // Fallback via licensing status if older preload
      const lic = await window.vertexia?.cloudLicense?.status?.().catch(() => null)
      if (lic) {
        setSupportInfo(prev => ({
          ...prev,
          licenseId: lic.license_id || prev.licenseId,
          licenseStatus: lic.status || prev.licenseStatus,
          licenseExpiryDate: lic.expires_at ?? prev.licenseExpiryDate,
          deviceId: lic.deviceId || prev.deviceId,
          shopName: session?.businessName || prev.shopName,
        }))
      }
    } catch {
      // Offline / fallback keeps bundled safe metadata visible
    }
  }

  useEffect(() => {
    void loadInfo()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.businessName])

  const whatsappUrl = buildWhatsAppSupportUrl({
    shopName: supportInfo.shopName || session?.businessName || '',
    appVersion: supportInfo.appVersion,
    licenseId: supportInfo.licenseId,
  })

  const handleCopySupportInfo = async () => {
    const text = buildSupportClipboardText(supportInfo)
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        throw new Error('clipboard unavailable')
      }
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2500)
  }

  const handleProblemSubmit = (e: FormEvent) => {
    e.preventDefault()
    const trimmed = issueText.trim()
    if (!trimmed) {
      setFormError(t.reportRequiredError)
      return
    }
    setFormError('')
    const issueWithNote = screenshotName ? `${trimmed} (Screenshot selected: ${screenshotName})` : trimmed
    const url = buildWhatsAppSupportUrl({
      shopName: supportInfo.shopName || session?.businessName || '',
      appVersion: supportInfo.appVersion,
      licenseId: supportInfo.licenseId,
      issue: issueWithNote,
    })
    void openSupportWhatsApp(url)
  }

  const cardStyle: React.CSSProperties = {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 14,
    padding: '20px 22px',
  }

  return (
    <PageShell
      {...props}
      activePage="Help Center"
      header={() => (
        <TopNavHeader
          title={t.pageTitle}
          subtitle={t.pageSubtitle}
          onNavigate={props.onNavigate}
          extraRight={
            <button
              type="button"
              onClick={() => {
                triggerRefreshShimmer()
                void loadInfo()
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
      <div
        dir={t.dir}
        style={{
          padding: '24px 28px',
          maxWidth: 1320,
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
          fontSize: 14,
          color: '#0f172a',
        }}
      >
        {/* Top Company Support Banner (Horizontal layout) */}
        <section
          style={{
            ...cardStyle,
            background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)',
            color: '#ffffff',
            border: '1px solid #312e81',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 20,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 260, flex: '1 1 320px' }}>
            <img
              src={systemLogo}
              alt={SUPPORT_CONFIG.companyName}
              style={{ width: 48, height: 48, objectFit: 'contain', flexShrink: 0 }}
            />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#ffffff' }}>{t.cardTitle}</h1>
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    padding: '2px 10px',
                    borderRadius: 999,
                    background: 'rgba(16, 185, 129, 0.2)',
                    border: '1px solid rgba(52, 211, 153, 0.45)',
                    color: '#a7f3d0',
                  }}
                >
                  {t.offlineBadge}
                </span>
              </div>
              <p style={{ margin: '4px 0 0', fontSize: 14, color: '#cbd5e1' }}>{t.cardSubtitle}</p>
              <div style={{ marginTop: 6, fontSize: 14, color: '#e2e8f0' }}>
                <strong>{SUPPORT_CONFIG.companyName}</strong> · {t.supportHoursLabel}: {SUPPORT_CONFIG.supportHours}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => {
                if (window.desktopApp && window.vertexia?.system?.openExternal) {
                  e.preventDefault()
                  void openSupportWhatsApp(whatsappUrl)
                }
              }}
              style={{
                padding: '10px 16px',
                borderRadius: 10,
                background: '#16a34a',
                color: '#ffffff',
                fontSize: 14,
                fontWeight: 600,
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Icon name="phone" size={16} />
              <span>{t.whatsappSupport}</span>
            </a>

            <a
              href={getSupportTelHref()}
              style={{
                padding: '10px 16px',
                borderRadius: 10,
                background: 'rgba(255,255,255,0.12)',
                border: '1px solid rgba(255,255,255,0.25)',
                color: '#ffffff',
                fontSize: 14,
                fontWeight: 600,
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Icon name="phone" size={16} />
              <span>
                {t.callUs}: {SUPPORT_CONFIG.supportNumber}
              </span>
            </a>

            {/* Language Switcher (English / Urdu RTL) */}
            <div
              role="group"
              aria-label={t.languageLabel}
              style={{
                display: 'inline-flex',
                background: 'rgba(15, 23, 42, 0.55)',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: 10,
                padding: 3,
                gap: 2,
              }}
            >
              <button
                type="button"
                onClick={() => setLang('en')}
                style={{
                  padding: '6px 12px',
                  borderRadius: 7,
                  border: 0,
                  background: lang === 'en' ? '#7c3aed' : 'transparent',
                  color: '#ffffff',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                English
              </button>
              <button
                type="button"
                onClick={() => setLang('ur')}
                style={{
                  padding: '6px 12px',
                  borderRadius: 7,
                  border: 0,
                  background: lang === 'ur' ? '#7c3aed' : 'transparent',
                  color: '#ffffff',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                اردو
              </button>
            </div>
          </div>
        </section>

        {/* Main Grid: Shortcuts + Quick Fixes */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 20 }}>
          {/* Keyboard Shortcuts Table */}
          <section style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <Icon name="bolt" size={20} className="text-violet-700" />
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#0f172a' }}>{t.shortcutsTitle}</h2>
            </div>
            <p style={{ margin: '0 0 14px', fontSize: 14, color: '#475569' }}>{t.shortcutsSubtitle}</p>

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  <th style={{ padding: '10px 12px', textAlign: t.dir === 'rtl' ? 'right' : 'left', borderBottom: '1px solid #e2e8f0', color: '#334155', fontWeight: 700 }}>
                    {t.shortcutColKey}
                  </th>
                  <th style={{ padding: '10px 12px', textAlign: t.dir === 'rtl' ? 'right' : 'left', borderBottom: '1px solid #e2e8f0', color: '#334155', fontWeight: 700 }}>
                    {t.shortcutColAction}
                  </th>
                </tr>
              </thead>
              <tbody>
                {t.shortcuts.map(row => (
                  <tr key={row.keys}>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap' }}>
                      <kbd
                        style={{
                          padding: '4px 10px',
                          borderRadius: 6,
                          background: '#f1f5f9',
                          border: '1px solid #cbd5e1',
                          fontFamily: 'monospace',
                          fontSize: 14,
                          fontWeight: 700,
                          color: '#0f172a',
                        }}
                      >
                        {row.keys}
                      </kbd>
                    </td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid #f1f5f9', color: '#1e293b' }}>
                      {row.action}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Good Habits Card */}
          <section style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <Icon name="shieldCheck" size={20} className="text-emerald-700" />
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#0f172a' }}>{t.goodHabitsTitle}</h2>
            </div>
            <p style={{ margin: '0 0 14px', fontSize: 14, color: '#475569' }}>{t.goodHabitsSubtitle}</p>

            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {t.goodHabits.map((habit, idx) => (
                <li
                  key={idx}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    padding: '10px 12px',
                    background: '#f0fdf4',
                    border: '1px solid #bbf7d0',
                    borderRadius: 10,
                    color: '#14532d',
                    fontSize: 14,
                    lineHeight: 1.5,
                  }}
                >
                  <Icon name="check" size={18} className="text-emerald-700" />
                  <span>{habit}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* Quick Fixes Section */}
        <section style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <Icon name="info" size={20} className="text-indigo-700" />
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#0f172a' }}>{t.quickFixesTitle}</h2>
          </div>
          <p style={{ margin: '0 0 16px', fontSize: 14, color: '#475569' }}>{t.quickFixesSubtitle}</p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
            {t.quickFixes.map(fix => (
              <article
                key={fix.title}
                style={{
                  padding: '14px 16px',
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: 12,
                }}
              >
                <h3 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{fix.title}</h3>
                <p style={{ margin: 0, fontSize: 14, color: '#334155', lineHeight: 1.55 }}>{fix.answer}</p>
              </article>
            ))}
          </div>
        </section>

        {/* Bottom Row: Technical Support Info (Copy) + Report a Problem */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 20 }}>
          {/* Support Info Card */}
          <section style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 6 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#0f172a' }}>{t.supportInfoTitle}</h2>
                <p style={{ margin: '4px 0 0', fontSize: 14, color: '#475569' }}>{t.supportInfoSubtitle}</p>
              </div>
              <button
                type="button"
                onClick={() => void handleCopySupportInfo()}
                style={{
                  padding: '9px 16px',
                  borderRadius: 8,
                  border: '1px solid #5E0CF3',
                  background: copied ? '#5E0CF3' : '#ffffff',
                  color: copied ? '#ffffff' : '#5E0CF3',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <Icon name={copied ? 'check' : 'copy'} size={16} />
                <span>{copied ? t.copiedConfirmation : t.copySupportInfo}</span>
              </button>
            </div>

            <dl
              style={{
                margin: '14px 0 0',
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 10,
                padding: 14,
                background: '#f8fafc',
                borderRadius: 10,
                border: '1px solid #e2e8f0',
                fontSize: 14,
              }}
            >
              <div>
                <dt style={{ color: '#475569', fontWeight: 600 }}>{t.fieldAppVersion}</dt>
                <dd style={{ margin: '2px 0 0', fontWeight: 700, color: '#0f172a' }}>{supportInfo.appVersion}</dd>
              </div>
              <div>
                <dt style={{ color: '#475569', fontWeight: 600 }}>{t.fieldLicenseId}</dt>
                <dd style={{ margin: '2px 0 0', fontWeight: 700, color: '#0f172a', wordBreak: 'break-all' }}>{supportInfo.licenseId}</dd>
              </div>
              <div>
                <dt style={{ color: '#475569', fontWeight: 600 }}>{t.fieldDeviceId}</dt>
                <dd style={{ margin: '2px 0 0', fontWeight: 700, color: '#0f172a', wordBreak: 'break-all' }}>{supportInfo.deviceId}</dd>
              </div>
              <div>
                <dt style={{ color: '#475569', fontWeight: 600 }}>{t.fieldDbSize}</dt>
                <dd style={{ margin: '2px 0 0', fontWeight: 700, color: '#0f172a' }}>{formatDbSize(supportInfo.databaseSizeBytes)}</dd>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <dt style={{ color: '#475569', fontWeight: 600 }}>{t.fieldOs}</dt>
                <dd style={{ margin: '2px 0 0', fontWeight: 700, color: '#0f172a' }}>{supportInfo.os}</dd>
              </div>
            </dl>

            <div style={{ marginTop: 12, fontSize: 14, color: '#475569' }}>
              {t.versionPrefix} {supportInfo.appVersion} · {t.licensePrefix} {supportInfo.licenseStatus} {t.untilWord}{' '}
              {formatLicenseExpiry(supportInfo.licenseExpiryDate)}
            </div>
          </section>

          {/* Report a Problem Form */}
          <section style={cardStyle}>
            <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 700, color: '#0f172a' }}>{t.reportTitle}</h2>
            <p style={{ margin: '0 0 14px', fontSize: 14, color: '#475569' }}>{t.reportSubtitle}</p>

            <form onSubmit={handleProblemSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {formError && (
                <div role="alert" style={{ padding: '8px 12px', borderRadius: 8, background: '#fee2e2', color: '#991b1b', fontSize: 14 }}>
                  {formError}
                </div>
              )}

              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14, fontWeight: 600, color: '#1e293b' }}>
                {t.reportDescLabel}
                <textarea
                  rows={3}
                  value={issueText}
                  onChange={e => setIssueText(e.target.value)}
                  placeholder={t.reportDescPlaceholder}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    fontSize: 14,
                    color: '#0f172a',
                    resize: 'vertical',
                  }}
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14, fontWeight: 600, color: '#1e293b' }}>
                {t.reportScreenshotLabel}
                <input
                  type="file"
                  accept="image/*"
                  onChange={e => setScreenshotName(e.target.files?.[0]?.name ?? '')}
                  style={{ fontSize: 14, color: '#334155' }}
                />
              </label>

              <p style={{ margin: 0, fontSize: 14, color: '#475569', background: '#f8fafc', padding: '10px 12px', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                {t.reportScreenshotHint}
              </p>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                <button
                  type="submit"
                  style={{
                    padding: '10px 18px',
                    borderRadius: 8,
                    border: 0,
                    background: '#16a34a',
                    color: '#ffffff',
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <Icon name="phone" size={16} />
                  <span>{t.reportSubmitBtn}</span>
                </button>
                <span style={{ fontSize: 14, color: '#475569' }}>{t.reportOfflineNote}</span>
              </div>
            </form>
          </section>
        </div>
      </div>
    </PageShell>
  )
}
