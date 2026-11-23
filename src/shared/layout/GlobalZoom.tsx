import { useEffect, useState } from 'react'

const MIN_ZOOM = 0.65
const MAX_ZOOM = 1.85
const DEFAULT_ZOOM = 1.0
const STEP = 0.05

export function GlobalZoom() {
  const [zoom, setZoom] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('vertexia_app_zoom')
      if (saved) {
        const val = parseFloat(saved)
        if (!isNaN(val) && val >= MIN_ZOOM && val <= MAX_ZOOM) return val
      }
    } catch {}
    return DEFAULT_ZOOM
  })

  // Synchronize with Electron webFrame and persist
  useEffect(() => {
    const clamped = Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) * 100) / 100

    const apply = () => {
      if (window.vertexia?.zoom?.setZoomFactor) {
        try {
          window.vertexia.zoom.setZoomFactor(clamped)
        } catch {}
      } else {
        document.documentElement.style.zoom = String(clamped)
      }
      document.documentElement.style.setProperty('--zoom-factor', String(clamped))
      try {
        localStorage.setItem('vertexia_app_zoom', String(clamped))
      } catch {}
    }

    apply()

    // Reassert whenever window is restored, focused, or unhidden
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
  }, [zoom])

  // Listen for electron zoom broadcast
  useEffect(() => {
    const unsubscribe = window.vertexia?.zoom?.onZoomFactorChange?.((factor: number) => {
      if (typeof factor === 'number' && factor >= MIN_ZOOM && factor <= MAX_ZOOM) {
        setZoom(factor)
      }
    })
    return () => {
      unsubscribe?.()
    }
  }, [])

  // Wheel and Keyboard listener
  useEffect(() => {
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
  }, [])

  return null
}
