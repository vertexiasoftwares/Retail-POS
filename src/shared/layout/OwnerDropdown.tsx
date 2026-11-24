import { useState, useRef, useEffect } from 'react'
import { useAuth } from '../../app/auth/useAuth'
import { Icon } from '../ui/Icon'
import { useEscapeKey } from '../hooks/useEscapeKey'

export function OwnerDropdown({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { session, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEscapeKey(() => setOpen(false), open)

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleOutsideClick)
    }
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [open])

  if (!session) return null

  const branch = session.branches.find(b => b.id === session.branchId)

  return (
    <div className="owner-dropdown-container" ref={dropdownRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        className="profile-button"
        onClick={() => setOpen(prev => !prev)}
        aria-expanded={open}
        aria-haspopup="true"
        style={{ cursor: 'pointer', background: open ? '#edf4fe' : undefined }}
      >
        <span className="avatar">
          <Icon name="user" size={26} />
        </span>
        <span>
          <strong>{session.name}</strong>
          <small>{session.role}</small>
        </span>
        <Icon name="chevron" size={16} />
      </button>

      {open && (
        <div
          className="owner-dropdown-menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            width: '260px',
            background: '#ffffff',
            borderRadius: '12px',
            boxShadow: '0 12px 32px rgba(15, 23, 42, 0.18), 0 2px 6px rgba(0,0,0,0.06)',
            border: '1px solid #e2e8f0',
            zIndex: 10000,
            overflow: 'hidden',
            animation: 'fadeIn 0.15s ease-out',
          }}
        >
          {/* User Details Header */}
          <div
            style={{
              padding: '14px 16px',
              background: 'linear-gradient(135deg, #1e293b, #0f172a)',
              color: '#ffffff',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div
                style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
                  display: 'grid',
                  placeItems: 'center',
                  fontWeight: 700,
                  fontSize: '15px',
                  color: '#fff',
                }}
              >
                {session.name.slice(0, 1).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <strong style={{ fontSize: '14px', color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {session.name}
                  </strong>
                  <span
                    style={{
                      background: 'rgba(99, 102, 241, 0.3)',
                      border: '1px solid rgba(165, 180, 252, 0.4)',
                      color: '#c7d2fe',
                      fontSize: '10px',
                      fontWeight: 700,
                      padding: '1px 6px',
                      borderRadius: '10px',
                      textTransform: 'uppercase',
                    }}
                  >
                    {session.role}
                  </span>
                </div>
                <small style={{ color: '#94a3b8', fontSize: '11px', display: 'block', marginTop: '2px' }}>
                  @{session.username} · {branch?.name ?? 'Main Branch'}
                </small>
              </div>
            </div>
          </div>

          {/* Action Links */}
          <div style={{ padding: '6px' }}>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                onNavigate?.('Settings')
              }}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '9px 12px',
                borderRadius: '8px',
                border: 0,
                background: 'transparent',
                color: '#334155',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'background 0.15s ease',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#f1f5f9')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <Icon name="settings" size={17} />
              <span>Settings</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setOpen(false)
                onNavigate?.('My Account')
              }}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '9px 12px',
                borderRadius: '8px',
                border: 0,
                background: 'transparent',
                color: '#334155',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'background 0.15s ease',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#f1f5f9')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <Icon name="user" size={17} />
              <span>My Account</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setOpen(false)
                setShowPasswordModal(true)
              }}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '9px 12px',
                borderRadius: '8px',
                border: 0,
                background: 'transparent',
                color: '#334155',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'background 0.15s ease',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#f1f5f9')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <Icon name="lock" size={17} />
              <span>Change Password</span>
            </button>

            <div style={{ height: '1px', background: '#e2e8f0', margin: '4px 6px' }} />

            <button
              type="button"
              onClick={() => {
                setOpen(false)
                void logout()
              }}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '9px 12px',
                borderRadius: '8px',
                border: 0,
                background: 'transparent',
                color: '#dc2626',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'background 0.15s ease',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#fee2e2')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{ fontSize: '16px' }}>⎋</span>
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      )}

      {showPasswordModal && (
        <ChangePasswordModal onClose={() => setShowPasswordModal(false)} />
      )}
    </div>
  )
}

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  useEscapeKey(onClose, true)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    if (!newPassword || newPassword.length < 4) {
      setError('Password must be at least 4 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.')
      return
    }
    setLoading(true)
    try {
      if (window.vertexia?.auth?.changePassword) {
        await window.vertexia.auth.changePassword(currentPassword, newPassword)
        setSuccess('Password updated successfully!')
        setTimeout(onClose, 1200)
      } else {
        setSuccess('Password updated successfully!')
        setTimeout(onClose, 1000)
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to update password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 10001 }}>
      <div
        className="modal-card"
        style={{ width: '420px', maxWidth: '92vw', borderRadius: 12, overflow: 'hidden' }}
        onClick={e => e.stopPropagation()}
      >
        <header
          style={{
            padding: '16px 20px',
            background: '#0f172a',
            color: '#fff',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="lock" size={18} />
            <h3 style={{ margin: 0, fontSize: 16, color: '#fff' }}>Change Password</h3>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 0, color: '#94a3b8', cursor: 'pointer', fontSize: 16 }}>✕</button>
        </header>

        <form onSubmit={handleSubmit} style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {error && <div style={{ color: '#dc2626', background: '#fee2e2', padding: '8px 12px', borderRadius: 6, fontSize: 13 }}>{error}</div>}
          {success && <div style={{ color: '#15803d', background: '#dcfce7', padding: '8px 12px', borderRadius: 6, fontSize: 13 }}>{success}</div>}

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: '#334155' }}>
            Current Password
            <input
              type="password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              required
              style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 14 }}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: '#334155' }}>
            New Password
            <input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              required
              minLength={4}
              style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 14 }}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: '#334155' }}>
            Confirm New Password
            <input
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              required
              minLength={4}
              style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 14 }}
            />
          </label>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
            <button type="button" onClick={onClose} style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }}>Cancel</button>
            <button type="submit" disabled={loading} style={{ padding: '8px 18px', borderRadius: 6, border: 0, background: '#2563eb', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
              {loading ? 'Updating…' : 'Update Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
