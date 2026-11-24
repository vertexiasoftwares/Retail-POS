import { useState, useRef, useEffect } from 'react'
import { Icon } from './Icon'
import { exportToExcel, exportToPdf, type ExportPayload } from '../utils/exportUtils'

export type ExportDropdownProps = {
  data: () => ExportPayload
  disabled?: boolean
  label?: string
  className?: string
}

export function ExportDropdown({
  data,
  disabled = false,
  label = 'Export',
  className = '',
}: ExportDropdownProps) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleOutside)
    }
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [open])

  const handleExportExcel = () => {
    setOpen(false)
    const payload = data()
    exportToExcel(payload)
  }

  const handleExportPdf = () => {
    setOpen(false)
    const payload = data()
    exportToPdf(payload)
  }

  return (
    <div ref={menuRef} style={{ position: 'relative', display: 'inline-block' }} className={className}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(prev => !prev)}
        style={{
          height: '38px',
          padding: '0 12px',
          border: '1px solid #dce4ef',
          borderRadius: '8px',
          background: '#ffffff',
          color: '#1e293b',
          fontSize: '12.5px',
          fontWeight: 600,
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1,
          boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
        }}
      >
        <Icon name="download" size={15} />
        <span>{label}</span>
        <span style={{ fontSize: '10px', color: '#64748b', marginLeft: '2px' }}>▼</span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 5px)',
            right: 0,
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            boxShadow: '0 10px 25px rgba(15, 23, 42, 0.15)',
            zIndex: 10000,
            minWidth: '130px',
            overflow: 'hidden',
            padding: '4px',
          }}
        >
          <button
            type="button"
            onClick={handleExportExcel}
            style={{
              width: '100%',
              padding: '8px 12px',
              border: 0,
              background: 'transparent',
              color: '#0f172a',
              fontSize: '13px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '9px',
              cursor: 'pointer',
              borderRadius: '6px',
              textAlign: 'left',
              whiteSpace: 'nowrap',
              transition: 'background 0.15s ease',
            }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#f1f5f9')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>
            </svg>
            <span>Excel</span>
          </button>

          <button
            type="button"
            onClick={handleExportPdf}
            style={{
              width: '100%',
              padding: '8px 12px',
              border: 0,
              background: 'transparent',
              color: '#0f172a',
              fontSize: '13px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '9px',
              cursor: 'pointer',
              borderRadius: '6px',
              textAlign: 'left',
              whiteSpace: 'nowrap',
              transition: 'background 0.15s ease',
            }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#f1f5f9')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
            <span>PDF</span>
          </button>
        </div>
      )}
    </div>
  )
}
