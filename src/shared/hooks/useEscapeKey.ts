import { useEffect } from 'react'

export function useEscapeKey(onClose?: () => void, active = true) {
  useEffect(() => {
    if (!active || !onClose) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.code === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, active])
}
