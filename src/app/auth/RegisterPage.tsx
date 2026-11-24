import { useState, type FormEvent } from 'react'
import { Icon } from '../../shared/ui/Icon'
import { RETAIL_POS_LOGO } from '../../shared/assets/logoDataUrl'
import {
  createLocalId,
  getRegistrationIdentity,
  registerRetailBusiness,
  storeRegistration,
  type CloudRegistrationInput,
} from '../../services/cloudLicensing'

type RegisterPageProps = {
  onSuccess: () => void
  onNavigateToLogin: () => void
  onNavigateToActivate: () => void
}

export function RegisterPage({ onSuccess, onNavigateToLogin, onNavigateToActivate }: RegisterPageProps) {
  const identity = getRegistrationIdentity()
  const [freshBusinessId] = useState(() => createLocalId('biz_retail'))
  const [formData, setFormData] = useState({
    businessId: freshBusinessId,
    existingRegistrationId: '',
    businessName: '',
    ownerName: '',
    phone: '',
    email: '',
    city: 'Karachi',
    businessType: 'Retail Mart / POS',
    username: '',
    password: '',
    confirmPassword: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const handleChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setError('')

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    if (formData.password.length < 8) {
      setError('Password should be at least 8 characters long.')
      return
    }

    setBusy(true)

    try {
      const finalBusinessId = formData.existingRegistrationId.trim() || formData.businessId || freshBusinessId
      const regInput: CloudRegistrationInput = {
        businessId: finalBusinessId,
        businessName: formData.businessName.trim(),
        ownerName: formData.ownerName.trim(),
        phone: formData.phone.trim(),
        email: formData.email.trim(),
        city: formData.city.trim(),
        businessType: formData.businessType.trim() || 'Retail Mart / POS',
      }

      // 1. Setup local auth repository first
      if (window.vertexia?.auth) {
        try {
          await window.vertexia.auth.setup({
            businessName: formData.businessName.trim(),
            branchName: 'Main Branch',
            city: formData.city.trim() || 'Karachi',
            ownerName: formData.ownerName.trim(),
            username: formData.username.trim(),
            password: formData.password,
            force: true,
          })
        } catch (setupErr: any) {
          console.error('Local setup error:', setupErr)
          setError(setupErr?.message || 'Failed to initialize local store credentials.')
          setBusy(false)
          return
        }
      }

      // 2. Persist new store identity so LicenseActivation displays the new Store Registration ID
      localStorage.setItem(
        'vertexiaRegistrationIdentity',
        JSON.stringify({
          businessId: finalBusinessId,
          installationId: identity.installationId,
          deviceIdentifier: identity.deviceIdentifier,
        })
      )
      localStorage.removeItem('vertexia_cloud_license')

      // 3. Save cloud registration and notify central server (non-blocking fallback)
      try {
        await registerRetailBusiness(regInput)
      } catch (cloudErr: any) {
        console.warn('Online cloud registration notice:', cloudErr?.message || cloudErr)
      }
      storeRegistration(regInput)

      onSuccess()
    } catch (err: any) {
      setError(err?.message || 'Registration failed. Please check details and retry.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-direct-page-view">
      {/* Top Seamless Header Bar (Direct on page, no card border) */}
      <header className="auth-direct-navbar">
        <div className="auth-direct-nav-brand">
          <img src={RETAIL_POS_LOGO} alt="Vertexia Logo" className="brand-logo-transparent" />
          <div className="brand-titles">
            <h2>Vertexia Retail POS</h2>
            <span>Store Setup & Cloud Registration</span>
          </div>
        </div>
        <div className="auth-direct-nav-actions">
          <button type="button" onClick={onNavigateToActivate} className="nav-text-btn">
            Already registered? <strong>Activate License &rarr;</strong>
          </button>
          <button type="button" onClick={onNavigateToLogin} className="nav-outline-btn">
            Sign In
          </button>
        </div>
      </header>

      {/* Progress Steps Directly on Page */}
      <div className="auth-direct-steps-wrap">
        <ol className="activation-steps-bar" aria-label="Setup progress">
          <li className="current">
            <span className="step-num">1</span>
            <span>Store Setup</span>
          </li>
          <li>
            <span className="step-num">2</span>
            <span>Activate License</span>
          </li>
          <li>
            <span className="step-num">3</span>
            <span>Sign In</span>
          </li>
        </ol>
      </div>

      {/* Main Direct Form Container (No card border, sits straight on page) */}
      <main className="auth-direct-main-content">
        <div className="register-header text-center">
          <div className="register-icon-badge">
            <Icon name="shieldCheck" size={32} />
          </div>
          <h1>Register Your Retail Business</h1>
          <p>Set up this installation to enable fast checkout, barcode scanning, and central activation</p>
        </div>

        {error && (
          <div className="auth-alert-box error" role="alert">
            <Icon name="warning" size={18} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="register-form direct-flat-form">
          <div className="form-grid-2">
            <div className="form-field">
              <label>Business / Mart Name *</label>
              <div className="input-with-icon-fixed">
                <Icon name="store" size={18} className="input-prefix-icon" />
                <input
                  type="text"
                  required
                  placeholder="e.g. Al-Madina Mart & Superstore"
                  value={formData.businessName}
                  onChange={e => handleChange('businessName', e.target.value)}
                />
              </div>
            </div>

            <div className="form-field">
              <label>Owner Full Name *</label>
              <div className="input-with-icon-fixed">
                <Icon name="user" size={18} className="input-prefix-icon" />
                <input
                  type="text"
                  required
                  placeholder="e.g. Taha Ahmed"
                  value={formData.ownerName}
                  onChange={e => handleChange('ownerName', e.target.value)}
                />
              </div>
            </div>

            <div className="form-field">
              <label>Phone / WhatsApp *</label>
              <div className="input-with-icon-fixed">
                <Icon name="phone" size={18} className="input-prefix-icon" />
                <input
                  type="tel"
                  required
                  placeholder="e.g. 03172981931"
                  value={formData.phone}
                  onChange={e => handleChange('phone', e.target.value)}
                />
              </div>
            </div>

            <div className="form-field">
              <label>City *</label>
              <div className="input-with-icon-fixed">
                <Icon name="mapPin" size={18} className="input-prefix-icon" />
                <input
                  type="text"
                  required
                  placeholder="e.g. Karachi"
                  value={formData.city}
                  onChange={e => handleChange('city', e.target.value)}
                />
              </div>
            </div>

            <div className="form-field">
              <label>Email Address</label>
              <div className="input-with-icon-fixed">
                <Icon name="mail" size={18} className="input-prefix-icon" />
                <input
                  type="email"
                  placeholder="e.g. owner@vertexiaagency.com"
                  value={formData.email}
                  onChange={e => handleChange('email', e.target.value)}
                />
              </div>
            </div>

            <div className="form-field">
              <label>System / Business Category</label>
              <div className="input-with-icon-fixed">
                <Icon name="cart" size={18} className="input-prefix-icon" />
                <input
                  type="text"
                  disabled
                  value={formData.businessType}
                  className="input-disabled"
                />
              </div>
            </div>

            <div className="form-field full-width">
              <label>
                Store Registration ID{' '}
                <span className="field-hint">(Auto-assigned; or enter existing key if reinstating)</span>
              </label>
              <div className="input-with-icon-fixed">
                <Icon name="key" size={18} className="input-prefix-icon" />
                <input
                  type="text"
                  placeholder={formData.businessId}
                  value={formData.existingRegistrationId}
                  onChange={e => handleChange('existingRegistrationId', e.target.value)}
                  className="font-mono"
                />
              </div>
            </div>

            <div className="form-field">
              <label>Owner Username *</label>
              <div className="input-with-icon-fixed">
                <Icon name="user" size={18} className="input-prefix-icon" />
                <input
                  type="text"
                  required
                  autoComplete="username"
                  placeholder="e.g. admin"
                  value={formData.username}
                  onChange={e => handleChange('username', e.target.value)}
                />
              </div>
            </div>

            <div className="form-field">
              <label>Password (Min. 8 characters) *</label>
              <div className="input-with-icon-fixed">
                <Icon name="lock" size={18} className="input-prefix-icon" />
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={formData.password}
                  onChange={e => handleChange('password', e.target.value)}
                />
              </div>
            </div>

            <div className="form-field full-width">
              <label>Confirm Password *</label>
              <div className="input-with-icon-fixed">
                <Icon name="lock" size={18} className="input-prefix-icon" />
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={formData.confirmPassword}
                  onChange={e => handleChange('confirmPassword', e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="register-actions-row">
            <button type="submit" disabled={busy} className="auth-btn-primary register-submit-btn">
              {busy ? 'Registering...' : 'Complete Registration & Continue to License Activation \u2192'}
            </button>
          </div>
        </form>

        <div className="register-footer-links text-center">
          <p>
            Already have an active Retail POS license?{' '}
            <button type="button" onClick={onNavigateToLogin} className="link-text-btn">
              Sign In Directly
            </button>
          </p>
        </div>
      </main>
    </div>
  )
}
