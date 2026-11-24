import { useEffect, useRef, useState } from 'react'
import { PosProductVisual } from '../../shared/ui/ProductVisual'
import type { PosProduct } from '../../types/desktop-api'
import { formatPosMoney } from './pos-format'
import { useEscapeKey } from '../../shared/hooks/useEscapeKey'

function playScannerBeep() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(1400, ctx.currentTime)
    gain.gain.setValueAtTime(0.2, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12)
    osc.start()
    osc.stop(ctx.currentTime + 0.12)
  } catch {}
}

export function BarcodeScannerModal({
  products,
  onAddProduct,
  onClose,
}: {
  products: PosProduct[]
  onAddProduct: (product: PosProduct) => void
  onClose: () => void
}) {
  useEscapeKey(onClose, true)
  const [barcodeInput, setBarcodeInput] = useState('')
  const [lastScanned, setLastScanned] = useState<PosProduct | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [autoAdd, setAutoAdd] = useState(true)
  const [scanHistory, setScanHistory] = useState<PosProduct[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleScan = (codeToSearch?: string) => {
    const query = (codeToSearch ?? barcodeInput).trim().toLowerCase()
    if (!query) return

    const matched = products.find(
      p =>
        (p.barcode && p.barcode.toLowerCase() === query) ||
        (p.sku && p.sku.toLowerCase() === query) ||
        p.name.toLowerCase() === query
    )

    if (matched) {
      if (matched.quantityMilli <= 0) {
        setErrorMsg(`Product "${matched.name}" is out of stock!`)
        setBarcodeInput('')
        return
      }
      playScannerBeep()
      setLastScanned(matched)
      setErrorMsg('')
      setScanHistory(prev => [matched, ...prev.slice(0, 9)])
      if (autoAdd) {
        onAddProduct(matched)
      }
      setBarcodeInput('')
    } else {
      setErrorMsg(`No product found with barcode / SKU: "${barcodeInput}"`)
      setBarcodeInput('')
    }
  }

  return (
    <div
      className="medkit-modal-backdrop"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        background: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(4px)',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        boxSizing: 'border-box',
      }}
    >
      <div
        className="modal-card"
        style={{
          width: '560px',
          maxWidth: '95vw',
          borderRadius: 14,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 45px rgba(15, 23, 42, 0.25)',
          margin: 'auto',
          position: 'relative',
          background: '#ffffff',
        }}
        onClick={e => e.stopPropagation()}
      >
        <header
          style={{
            padding: '16px 20px',
            background: 'linear-gradient(135deg, #1e3a8a, #2563eb)',
            color: '#fff',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 24 }}>▥</span>
            <div>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#fff' }}>
                Barcode Scanner Terminal
              </h2>
              <small style={{ color: '#bfdbfe', fontSize: 12 }}>
                Scan using USB/Bluetooth barcode reader or manual entry
              </small>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.15)',
              border: 0,
              borderRadius: '50%',
              width: 32,
              height: 32,
              color: '#fff',
              fontSize: 16,
              cursor: 'pointer',
              display: 'grid',
              placeItems: 'center',
            }}
          >
            ✕
          </button>
        </header>

        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Scanner Input */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>
              Scan Barcode / Enter SKU:
            </label>
            <div
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                background: '#f8fafc',
                border: '2px solid #3b82f6',
                borderRadius: 10,
                padding: '6px 14px',
              }}
            >
              <span style={{ fontSize: 20, color: '#2563eb' }}>▥</span>
              <input
                ref={inputRef}
                type="text"
                value={barcodeInput}
                onChange={e => setBarcodeInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleScan()
                  }
                }}
                placeholder="Scan barcode now or type barcode..."
                style={{
                  flex: 1,
                  border: 0,
                  outline: 0,
                  fontSize: 15,
                  fontWeight: 600,
                  color: '#0f172a',
                  background: 'transparent',
                }}
              />
              <button
                type="button"
                onClick={() => handleScan()}
                style={{
                  background: '#2563eb',
                  color: '#fff',
                  border: 0,
                  borderRadius: 6,
                  padding: '6px 14px',
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Scan
              </button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748b', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={autoAdd}
                  onChange={e => setAutoAdd(e.target.checked)}
                />
                Auto-add to cart on barcode match
              </label>
              <small style={{ fontSize: 11, color: '#94a3b8' }}>Press Enter or scan trigger</small>
            </div>
          </div>

          {/* Error notice */}
          {errorMsg && (
            <div
              style={{
                background: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#dc2626',
                borderRadius: 8,
                padding: '10px 14px',
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              ⚠ {errorMsg}
            </div>
          )}

          {/* Last Scanned Product Result */}
          {lastScanned && (
            <div
              style={{
                background: '#f0fdf4',
                border: '1px solid #bbf7d0',
                borderRadius: 10,
                padding: '14px',
                display: 'flex',
                alignItems: 'center',
                gap: 14,
              }}
            >
              <PosProductVisual
                kind={lastScanned.kind}
                category={lastScanned.category}
                name={lastScanned.name}
                size={44}
              />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#15803d', background: '#dcfce7', padding: '1px 7px', borderRadius: 10 }}>
                    SCANNED
                  </span>
                  <strong style={{ fontSize: 15, color: '#14532d' }}>{lastScanned.name}</strong>
                </div>
                <div style={{ fontSize: 12, color: '#475569', marginTop: 3 }}>
                  Barcode: <b>{lastScanned.barcode || lastScanned.sku}</b> · Stock: <b>{(lastScanned.quantityMilli / 1000).toLocaleString('en-PK')} {lastScanned.unit}</b>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <strong style={{ fontSize: 16, color: '#15803d', display: 'block' }}>
                  {formatPosMoney(lastScanned.sellingPricePaisa)}
                </strong>
                {!autoAdd && (
                  <button
                    type="button"
                    onClick={() => onAddProduct(lastScanned)}
                    style={{
                      marginTop: 4,
                      background: '#16a34a',
                      color: '#fff',
                      border: 0,
                      borderRadius: 6,
                      padding: '4px 10px',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    + Add to Cart
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Scan History */}
          {scanHistory.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 8 }}>
                Recent Scans ({scanHistory.length})
              </div>
              <div style={{ maxHeight: '140px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {scanHistory.map((item, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      background: '#f8fafc',
                      borderRadius: 6,
                      padding: '6px 12px',
                      fontSize: 12.5,
                      border: '1px solid #e2e8f0',
                    }}
                  >
                    <span>{item.name}</span>
                    <span style={{ fontWeight: 600, color: '#2563eb' }}>
                      {formatPosMoney(item.sellingPricePaisa)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <footer
          style={{
            padding: '12px 20px',
            background: '#f8fafc',
            borderTop: '1px solid #e2e8f0',
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 20px',
              borderRadius: 6,
              background: '#2563eb',
              color: '#fff',
              border: 0,
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Done Scanning
          </button>
        </footer>
      </div>
    </div>
  )
}
