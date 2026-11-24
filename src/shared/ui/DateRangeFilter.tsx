import { useState } from 'react'
import { Icon } from './Icon'

export type DateFilterPreset = 'today' | 'yesterday' | 'week' | 'month' | 'last_month' | 'custom'

export type DateRange = {
  preset: DateFilterPreset
  startDate: string // YYYY-MM-DD
  endDate: string   // YYYY-MM-DD
  label: string
}

function getPresetDates(preset: DateFilterPreset): { startDate: string; endDate: string; label: string } {
  const now = new Date()
  const format = (d: Date) => d.toISOString().slice(0, 10)

  if (preset === 'today') {
    const todayStr = format(now)
    return { startDate: todayStr, endDate: todayStr, label: 'Today' }
  }
  if (preset === 'yesterday') {
    const yest = new Date(now)
    yest.setDate(now.getDate() - 1)
    const yestStr = format(yest)
    return { startDate: yestStr, endDate: yestStr, label: 'Yesterday' }
  }
  if (preset === 'week') {
    const start = new Date(now)
    start.setDate(now.getDate() - 7)
    return { startDate: format(start), endDate: format(now), label: 'Last 7 Days' }
  }
  if (preset === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    return { startDate: format(start), endDate: format(now), label: 'This Month' }
  }
  if (preset === 'last_month') {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const end = new Date(now.getFullYear(), now.getMonth(), 0)
    return { startDate: format(start), endDate: format(end), label: 'Last Month' }
  }
  return { startDate: format(now), endDate: format(now), label: 'Custom' }
}

export function DateRangeFilter({
  value,
  onChange,
  className = '',
}: {
  value?: DateRange
  onChange?: (range: DateRange) => void
  className?: string
}) {
  const [currentPreset, setCurrentPreset] = useState<DateFilterPreset>(value?.preset ?? 'today')
  const [customStart, setCustomStart] = useState(() => value?.startDate ?? new Date().toISOString().slice(0, 10))
  const [customEnd, setCustomEnd] = useState(() => value?.endDate ?? new Date().toISOString().slice(0, 10))

  const handlePresetChange = (preset: DateFilterPreset) => {
    setCurrentPreset(preset)
    if (preset !== 'custom') {
      const dates = getPresetDates(preset)
      onChange?.({ preset, ...dates })
    }
  }

  const handleCustomApply = () => {
    onChange?.({
      preset: 'custom',
      startDate: customStart,
      endDate: customEnd,
      label: `${customStart} - ${customEnd}`,
    })
  }

  return (
    <div className={`date-range-filter-wrap ${className}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
      <div
        className="date-range-filter-card"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          height: '42px',
          minHeight: '42px',
          border: '1px solid #dbe4ef',
          borderRadius: '8px',
          backgroundColor: '#ffffff',
          padding: '0 8px 0 12px',
          gap: '8px',
          boxSizing: 'border-box',
          boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', color: '#64748b', flexShrink: 0, pointerEvents: 'none' }}>
          <Icon name="calendar" size={16} />
        </span>
        <select
          aria-label="Date range filter"
          className="date-filter-clean"
          value={currentPreset}
          onChange={e => handlePresetChange(e.target.value as DateFilterPreset)}
          style={{
            height: '100%',
            border: 0,
            outline: 0,
            background: 'transparent',
            color: '#1e293b',
            fontSize: '13px',
            fontWeight: 500,
            cursor: 'pointer',
            boxSizing: 'border-box',
          }}
        >
          <option value="today">Today</option>
          <option value="yesterday">Yesterday</option>
          <option value="week">Last 7 Days</option>
          <option value="month">This Month</option>
          <option value="last_month">Last Month</option>
          <option value="custom">Custom Date…</option>
        </select>
      </div>

      {currentPreset === 'custom' && (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', border: '1px solid #dbe4ef', borderRadius: 8, padding: '0 10px', height: 42, boxSizing: 'border-box' }}>
          <input
            type="date"
            value={customStart}
            onChange={e => setCustomStart(e.target.value)}
            style={{ border: 0, outline: 0, fontSize: 12.5, color: '#1e293b' }}
          />
          <span style={{ color: '#94a3b8', fontSize: 12 }}>to</span>
          <input
            type="date"
            value={customEnd}
            onChange={e => setCustomEnd(e.target.value)}
            style={{ border: 0, outline: 0, fontSize: 12.5, color: '#1e293b' }}
          />
          <button
            type="button"
            onClick={handleCustomApply}
            style={{
              background: '#2563eb',
              color: '#fff',
              border: 0,
              borderRadius: 6,
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Apply
          </button>
        </div>
      )}
    </div>
  )
}
