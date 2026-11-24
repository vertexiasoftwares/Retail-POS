import { useEffect, useState } from 'react'

const MIN_ZOOM = 0.65
const MAX_ZOOM = 1.85
const DEFAULT_ZOOM = 1.0
const STEP = 0.05

export function GlobalZoom() {
  const isElectron = typeof window !== 'undefined' && Boolean((window as any).desktopApp)

  // In standard web browser mode, remove any CSS zoom and let Chrome's native engine handle zoom seamlessly
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.style.zoom = ''
      document.body.style.zoom = ''
      document.documentElement.style.removeProperty('--zoom-factor')
      try {
        localStorage.removeItem('vertexia_app_zoom')
      } catch {}
    }
  }, [])

  const [zoom, setZoom] = useState<number>(() => {
    if (!isElectron) return DEFAULT_ZOOM
    try {
      const saved = localStorage.getItem('vertexia_app_zoom')
      if (saved) {
        const val = parseFloat(saved)
        if (!isNaN(val) && val >= MIN_ZOOM && val <= MAX_ZOOM) return val
      }
    } catch {}
    return DEFAULT_ZOOM
  })

  // Synchronize ONLY in Electron with webFrame
  useEffect(() => {
    if (!isElectron) return

    const clamped = Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) * 100) / 100

    const apply = () => {
      if (window.vertexia?.zoom?.setZoomFactor) {
        try {
          window.vertexia.zoom.setZoomFactor(clamped)
        } catch {}
      }
      try {
        localStorage.setItem('vertexia_app_zoom', String(clamped))
      } catch {}
    }

    apply()

    const handleReassert = () => {
      apply()
    }

    window.addEventListener('focus', handleReassert)
    window.addEventListener('pageshow', handleReassert)
    document.addEventListener('visibilitychange', handleReassert)

    return () => {
      window.removeEventListener('focus', handleReassert)
      window.removeEventListener('pageshow', handleReassert)
      document.removeEventListener('visibilitychange', handleReassert)
    }
  }, [zoom, isElectron])

  // Listen for electron zoom broadcast
  useEffect(() => {
    if (!isElectron) return
    const unsubscribe = window.vertexia?.zoom?.onZoomFactorChange?.((factor: number) => {
      if (typeof factor === 'number' && factor >= MIN_ZOOM && factor <= MAX_ZOOM) {
        setZoom(factor)
      }
    })
    return () => {
      unsubscribe?.()
    }
  }, [isElectron])

  // Wheel and Keyboard listener ONLY for Electron
  useEffect(() => {
    if (!isElectron) return

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        e.stopPropagation()
        const direction = e.deltaY < 0 ? 1 : -1
        setZoom(prev => {
          return Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev + direction * STEP)) * 100) / 100
        })
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        const isPlus = e.key === '=' || e.key === '+' || e.code === 'NumpadAdd' || e.code === 'Equal'
        const isMinus = e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract' || e.code === 'Minus'
        const isReset = e.key === '0' || e.code === 'Numpad0' || e.code === 'Digit0'

        if (isPlus) {
          e.preventDefault()
          setZoom(prev => Math.round(Math.min(MAX_ZOOM, prev + STEP) * 100) / 100)
        } else if (isMinus) {
          e.preventDefault()
          setZoom(prev => Math.round(Math.max(MIN_ZOOM, prev - STEP) * 100) / 100)
        } else if (isReset) {
          e.preventDefault()
          setZoom(DEFAULT_ZOOM)
        }
      }
    }

    window.addEventListener('wheel', handleWheel, { passive: false, capture: true })
    document.addEventListener('wheel', handleWheel, { passive: false, capture: true })
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    document.addEventListener('keydown', handleKeyDown, { capture: true })

    return () => {
      window.removeEventListener('wheel', handleWheel, { capture: true })
      document.removeEventListener('wheel', handleWheel, { capture: true })
      window.removeEventListener('keydown', handleKeyDown, { capture: true })
      document.removeEventListener('keydown', handleKeyDown, { capture: true })
    }
  }, [isElectron])

  return null
}
