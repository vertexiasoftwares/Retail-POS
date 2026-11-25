import type { ReactNode } from 'react'
import { TextShimmer } from './TextShimmer'

type ShimmerLoadingProps = {
  title?: string
  subtitle?: string
  error?: string
  onRetry?: () => void
  fullScreen?: boolean
  children?: ReactNode
}

export function ShimmerLoading({
  title = 'Vertexia Retail POS',
  subtitle = 'Loading...',
  error,
  onRetry,
  fullScreen = true,
  children,
}: ShimmerLoadingProps) {
  if (!error) {
    return (
      <main
        className={fullScreen ? 'shimmer-loading-screen' : 'shimmer-loading-inline'}
        style={{ background: '#ffffff' }}
      >
        <div className="shimmer-loading-inner">
          <TextShimmer duration={1}>Loading...</TextShimmer>
          {children}
        </div>
      </main>
    )
  }

  return (
    <main className={fullScreen ? 'shimmer-loading-screen' : 'shimmer-loading-inline'}>
      <div className="shimmer-loading-inner">
        <h1 className="shimmer-title-static">{title}</h1>
        <p role="alert" className="shimmer-error-text">
          {error || subtitle}
        </p>
        {onRetry && (
          <button type="button" className="auth-btn-primary shimmer-retry-btn" onClick={onRetry}>
            Retry Connection
          </button>
        )}
        {children}
      </div>
    </main>
  )
}
