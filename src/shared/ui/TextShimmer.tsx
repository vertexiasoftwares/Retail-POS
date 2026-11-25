import { useCallback, useEffect, useRef, useState } from 'react'
import { REFRESH_SHIMMER_EVENT } from '../../services/retail-events'
import { getPosSettings } from '../settings/posSettings'
import LoaderOne from './LoaderOne'

export type TextShimmerProps = {
  duration?: number
  className?: string
  children?: React.ReactNode
}

/**
 * TextShimmer wrapper retained for compatibility; renders LoaderOne.
 */
export function TextShimmer(_props: TextShimmerProps) {
  return <LoaderOne />
}

/**
 * PageTransitionShimmer — Shows LoaderOne for the configured load duration ONLY on
 * initial browser load/reload and when Refresh buttons are clicked (NOT on tab switches).
 */
export function PageTransitionShimmer({
  children,
  duration,
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
          <LoaderOne />
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
