import { useEffect, useState, type FormEvent } from 'react'
import { Icon } from '../../shared/ui/Icon'
import { RETAIL_POS_LOGO } from '../../shared/assets/logoDataUrl'
import {
  activateRetailLicense,
  fetchCloudLicenseStatus,
  refreshRetailLicense,
  getRegistrationIdentity,
  getStoredRegistration,
  type CloudLicenseStatusOutput,
} from '../../services/cloudLicensing'

type LicenseActivationProps = {
  onSuccess: () => void
  onNavigateToLogin: () => void
  onNavigateToRegister: () => void
}

export function LicenseActivation({ onSuccess, onNavigateToLogin, onNavigateToRegister }: LicenseActivationProps) {
  const [license, setLicense] = useState<CloudLicenseStatusOutput | null>(null)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [copied, setCopied] = useState(false)

  const identity = getRegistrationIdentity()
  const registration = license?.registration || getStoredRegistration()
  const displayBizId = license?.businessId || registration?.businessId || identity.businessId

  const contact = license?.contact || {
    companyName: 'Vertexia',
    phone: '03172981931',
    whatsapp: '923172981931',
    email: 'support@vertexiaagency.com',
    instructions: 'Contact Vertexia with your Registration ID to purchase or renew your Retail POS license.',
  }

  useEffect(() => {
    let active = true
    void fetchCloudLicenseStatus().then(res => {
      if (active) setLicense(res)
    })
    const handleLicenseChange = () => {
      void fetchCloudLicenseStatus().then(res => {
        if (active) setLicense(res)
      })
    }
    window.addEventListener('vertexia:license-changed', handleLicenseChange)
    return () => {
      active = false
      window.removeEventListener('vertexia:license-changed', handleLicenseChange)
    }
  }, [])

  const handleKeyChange = (val: string) => {
    let raw = val.trim().toUpperCase()
    if (raw.startsWith('MK-')) {
      raw = raw.slice(3)
    } else if (raw.startsWith('MK')) {
      raw = raw.slice(2)
    }
    const hex = raw.replace(/[^A-F0-9]/g, '').slice(0, 32)
    const chunks = hex.match(/.{1,8}/g) || []
    const formatted = chunks.length ? `MK-${chunks.join('-')}` : hex ? `MK-${hex}` : ''
    setKey(formatted)
  }

  const handleActivate = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !key.trim()) return
    setBusy(true)
    setError('')
    setSuccessMsg('')

    try {
      const res = await activateRetailLicense(key.trim(), displayBizId)
      setLicense(res)
      setSuccessMsg('License activated successfully! Redirecting to Sign In...')
      setTimeout(() => {
        onSuccess()
      }, 1000)
    } catch (err: any) {
      setError(err?.message || 'Activation failed. Please check the license key.')
    } finally {
      setBusy(false)
    }
  }

  const handleVerify = async () => {
    setBusy(true)
    setError('')
    setSuccessMsg('')
    try {
      const res = await refreshRetailLicense()
      setLicense(res)
      if (res.accessAllowed) {
        setSuccessMsg('License verified online.')
      } else {
        setError(res.message || 'License verification pending.')
      }
    } catch (err: any) {
      setError(err?.message || 'Could not connect to licensing server.')
    } finally {
      setBusy(false)
    }
  }

  const copyRegistrationId = async () => {
    if (!displayBizId) return
    try {
      await navigator.clipboard.writeText(displayBizId)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      setError('Could not copy automatically. Please select and copy manually.')
    }
  }

  const whatsappPhone = String(contact.whatsapp || '923172981931').replace(/[^0-9]/g, '')
  const whatsappText = `Hello ${contact.companyName || 'Vertexia'}, please provide a Retail POS license key for ${
    registration?.businessName || 'my retail mart'
  }. Registration ID: ${displayBizId}`

  return (
    <div className="auth-direct-page-view">
      {/* Top Seamless Navbar (Direct on page, no card border) */}
      <header className="auth-direct-navbar">
        <div className="auth-direct-nav-brand">
          <img src={RETAIL_POS_LOGO} alt="Vertexia Logo" className="brand-logo-transparent" />
          <div className="brand-titles">
            <h2>Vertexia Retail POS</h2>
            <span>Retail registration & license activation</span>
          </div>
        </div>
        <div className="auth-direct-nav-actions">
          <button type="button" onClick={onNavigateToLogin} className="nav-outline-btn">
            Already activated? Sign In &rarr;
          </button>
        </div>
      </header>

      {/* Progress Steps Directly on Page */}
      <div className="auth-direct-steps-wrap">
        <ol className="activation-steps-bar" aria-label="Setup progress">
          <li className="completed">
            <Icon name="check" size={16} />
            <span>1. Registered</span>
          </li>
          <li className="current">
            <span className="step-num">2</span>
            <span>Activate License</span>
          </li>
          <li>
            <span className="step-num">3</span>
            <span>Sign In</span>
          </li>
        </ol>
      </div>

      {/* Main Direct 2-Column Layout (Direct on Page, No Card Borders) */}
      <main className="auth-direct-main-content">
        <div className="activation-direct-grid">
          {/* Left Column: Activation Form */}
          <section className="activation-direct-left">
            <div className="direct-section-title-row">
              <span className="key-icon-badge">
                <Icon name="key" size={26} />
              </span>
              <div>
                <h1>{license?.status === 'EXPIRED' ? 'Renew Retail POS License' : 'Activate Your Retail POS'}</h1>
                <p>Enter the activation key supplied by {contact.companyName || 'Vertexia'}.</p>
              </div>
            </div>

            {/* License Status Banner */}
            <div
              className={`license-status-banner ${license?.accessAllowed ? 'status-active' : 'status-pending'}`}
              role="status"
            >
              <div className="status-label">
                <span className="indicator-dot" />
                <strong>
                  {license?.accessAllowed
                    ? 'LICENSE ACTIVE'
                    : String(license?.status || 'ACTIVATION_REQUIRED').replace(/_/g, ' ')}
                </strong>
              </div>
              <p>{license?.message || 'Enter your license key to enable sales, stock management, and central sync.'}</p>
              {license?.license_type === 'PERMANENT' ? (
                <small>Permanent License &middot; Multi-terminal ready</small>
              ) : license?.expires_at ? (
                <small>Valid until {new Date(license.expires_at).toLocaleDateString()}</small>
              ) : null}
            </div>

            {/* Success / Error alerts */}
            {successMsg && (
              <div className="auth-alert-box success">
                <Icon name="check" size={18} />
                <span>{successMsg}</span>
              </div>
            )}
            {error && (
              <div className="auth-alert-box error">
                <Icon name="warning" size={18} />
                <span>{error}</span>
              </div>
            )}

            {/* Activation Form */}
            <form onSubmit={handleActivate} className="activation-direct-form">
              <div className="form-field">
                <label htmlFor="license-key-input">License Key</label>
                <input
                  id="license-key-input"
                  name="licenseKey"
                  type="text"
                  required
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={45}
                  placeholder="MK-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX"
                  value={key}
                  onChange={e => handleKeyChange(e.target.value)}
                  disabled={busy}
                  className="license-key-input-field"
                />
              </div>

              <button
                type="submit"
                disabled={busy || !key.trim()}
                className="auth-btn-primary activate-submit-btn"
              >
                {busy ? 'Activating...' : 'Activate & Continue to Sign In'}
              </button>

              <button
                type="button"
                onClick={handleVerify}
                disabled={busy}
                className="auth-btn-secondary verify-retry-btn"
              >
                <Icon name="refresh" size={16} />
                <span>Verify License / Retry Online</span>
              </button>
            </form>

            <p className="activation-footnote">
              Your license is bound to this retail store and terminal. After activation, sign in with your owner account to start ringing up sales and tracking inventory.
            </p>
          </section>

          {/* Right Column: Registration ID & Support */}
          <aside className="activation-direct-right">
            {/* Registration ID Direct Box */}
            <div className="direct-side-block">
              <span className="side-block-label">STORE REGISTRATION ID</span>
              <div className="reg-id-display-box">
                <code title={displayBizId}>{displayBizId}</code>
                <button
                  type="button"
                  onClick={copyRegistrationId}
                  className="copy-id-icon-btn"
                  title="Copy Registration ID"
                  aria-label="Copy Registration ID"
                >
                  <Icon name={copied ? 'check' : 'copy'} size={18} />
                </button>
              </div>
              {registration?.businessName && (
                <p className="registered-store-name">
                  {registration.businessName} {registration.city ? `· ${registration.city}` : ''}
                </p>
              )}
            </div>

            {/* Support Actions Direct Box */}
            <div className="direct-side-block">
              <h3>Vertexia Support</h3>
              <p className="support-instruction">
                Share your <strong>Registration ID</strong> with our team to instantly issue your Retail POS license key:
              </p>

              <div className="support-channel-list">
                <a
                  href={`https://wa.me/${whatsappPhone}?text=${encodeURIComponent(whatsappText)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="whatsapp-support-btn"
                >
                  <span className="live-dot" />
                  <span>Contact on WhatsApp</span>
                </a>

                {contact.phone && (
                  <a href={`tel:${contact.phone}`} className="support-contact-row">
                    <Icon name="phone" size={16} />
                    <span>{contact.phone}</span>
                  </a>
                )}

                {contact.email && (
                  <a href={`mailto:${contact.email}`} className="support-contact-row">
                    <Icon name="mail" size={16} />
                    <span>{contact.email}</span>
                  </a>
                )}
              </div>
            </div>

            <div className="direct-side-footer text-center">
              <span className="switch-prompt">NEED NEW SETUP?</span>
              <button type="button" onClick={onNavigateToRegister} className="link-button register-reroute-btn">
                Register a new retail business &rarr;
              </button>
            </div>
          </aside>
        </div>
      </main>
    </div>
  )
}
