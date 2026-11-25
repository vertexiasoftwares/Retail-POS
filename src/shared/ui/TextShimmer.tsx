import { useCallback, useEffect, useRef, useState } from 'react'
import { REFRESH_SHIMMER_EVENT } from '../../services/retail-events'
import { getPosSettings } from '../settings/posSettings'

export type TextShimmerProps = {
  duration?: number
  className?: string
  children?: React.ReactNode
}

/**
 * Pure CSS TextShimmer — extra-large, bold shimmering "LOADING" text like a display splash screen.
 */
export function TextShimmer({
  duration = 1.4,
  className = '',
  children = 'LOADING',
}: TextShimmerProps) {
  return (
    <>
      <span
        className={`vtx-text-shimmer ${className}`}
        style={{
          display: 'inline-block',
          fontFamily: 'var(--font-heading, "Plus Jakarta Sans", "Inter", system-ui, -apple-system, sans-serif)',
          fontSize: 'clamp(58px, 11vw, 132px)',
          lineHeight: 1.05,
          fontWeight: 900,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          userSelect: 'none',
          backgroundImage:
            'linear-gradient(100deg, #cbd5e1 0%, #94a3b8 28%, #1e293b 44%, #5e0cf3 50%, #1e293b 56%, #94a3b8 72%, #cbd5e1 100%)',
          backgroundSize: '240% 100%',
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          color: 'transparent',
          WebkitTextFillColor: 'transparent',
          animation: `vtx-text-shimmer-sweep ${Math.max(duration, 0.8)}s linear infinite`,
        }}
      >
        {children}
      </span>
      <style>{`
        @keyframes vtx-text-shimmer-sweep {
          0% { background-position: 180% center; }
          100% { background-position: -60% center; }
        }
      `}</style>
    </>
  )
}

/**
 * PageTransitionShimmer — Shows large bold "LOADING" TextShimmer for 3-4 seconds ONLY on
 * initial browser load/reload and when Refresh buttons are clicked (NOT on tab switches).
 */
export function PageTransitionShimmer({
  children,
  duration,
  text = 'LOADING',
}: {
  children: React.ReactNode
  duration?: number
  text?: string
}) {
  const resolveDuration = () => {
    if (typeof duration === 'number') return duration
    return getPosSettings().shimmerDurationSec
  }

  const [runId, setRunId] = useState(0)
  const [phase, setPhase] = useState<'shimmer' | 'fadeout' | 'done'>(() =>
    resolveDuration() > 0 ? 'shimmer' : 'done'
  )
  const timersRef = useRef<number[]>([])

  const clearTimers = () => {
    for (const id of timersRef.current) window.clearTimeout(id)
    timersRef.current = []
  }

  const startShimmer = useCallback(() => {
    clearTimers()
    const totalSec = resolveDuration()
    if (totalSec <= 0) {
      setPhase('done')
      return
    }
    setPhase('shimmer')
    const fadeMs = 550
    const holdMs = Math.max(totalSec * 1000 - fadeMs, 400)
    const t1 = window.setTimeout(() => {
      setPhase('fadeout')
      const t2 = window.setTimeout(() => {
        setPhase('done')
      }, fadeMs)
      timersRef.current.push(t2)
    }, holdMs)
    timersRef.current.push(t1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration])

  useEffect(() => {
    startShimmer()
    return clearTimers
  }, [runId, startShimmer])

  useEffect(() => {
    const onRefresh = () => setRunId(n => n + 1)
    window.addEventListener(REFRESH_SHIMMER_EVENT, onRefresh)
    return () => window.removeEventListener(REFRESH_SHIMMER_EVENT, onRefresh)
  }, [])

  const isRevealing = phase === 'fadeout' || phase === 'done'

  return (
    <>
      {phase !== 'done' && (
        <div
          aria-live="polite"
          aria-busy={phase === 'shimmer'}
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#ffffff',
            zIndex: 9998,
            pointerEvents: phase === 'shimmer' ? 'all' : 'none',
            opacity: phase === 'fadeout' ? 0 : 1,
            transition: 'opacity 0.55s ease',
          }}
        >
          <TextShimmer duration={1.4}>{text}</TextShimmer>
        </div>
      )}
      <div
        style={{
          opacity: isRevealing ? 1 : 0,
          transition: 'opacity 0.55s ease',
        }}
      >
        {children}
      </div>
    </>
  )
}
