import { useState } from 'react'
import { CustomSelect } from './CustomSelect'

export type DateFilterPreset = 'today' | 'yesterday' | 'week' | 'month' | 'last_month' | 'custom'

export type DateRange = {
  preset: DateFilterPreset
  startDate: string // YYYY-MM-DD
  endDate: string   // YYYY-MM-DD
  label: string
}

const DATE_OPTIONS = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'week', label: 'Last 7 Days' },
  { value: 'month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'custom', label: 'Custom Date…' },
]

function getPresetDates(preset: DateFilterPreset): { startDate: string; endDate: string; label: string } {
  const now = new Date()
  const format = (d: Date) => {
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

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
  const [internalPreset, setInternalPreset] = useState<DateFilterPreset>(value?.preset ?? 'today')
  const [editingCustom, setEditingCustom] = useState(value?.preset === 'custom')
  const [customStart, setCustomStart] = useState(() => value?.startDate ?? getPresetDates('today').startDate)
  const [customEnd, setCustomEnd] = useState(() => value?.endDate ?? getPresetDates('today').endDate)

  const currentPreset: DateFilterPreset = editingCustom ? 'custom' : (value?.preset ?? internalPreset)

  const handlePresetChange = (preset: DateFilterPreset) => {
    setInternalPreset(preset)
    if (preset === 'custom') {
      setCustomStart(value?.startDate ?? customStart)
      setCustomEnd(value?.endDate ?? customEnd)
      setEditingCustom(true)
      return
    }
    setEditingCustom(false)
    const dates = getPresetDates(preset)
    onChange?.({ preset, ...dates })
  }

  const handleCustomApply = () => {
    setEditingCustom(false)
    setInternalPreset('custom')
    onChange?.({
      preset: 'custom',
      startDate: customStart,
      endDate: customEnd,
      label: `${customStart} - ${customEnd}`,
    })
  }

  return (
    <div
      className={`date-range-filter-wrap ${className}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}
    >
      <CustomSelect
        icon="calendar"
        ariaLabel="Date range filter"
        value={currentPreset}
        onChange={val => handlePresetChange(val as DateFilterPreset)}
        options={DATE_OPTIONS}
        minWidth={155}
      />

      {currentPreset === 'custom' && (
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            background: '#fff',
            border: '1px solid #dbe4ef',
            borderRadius: 10,
            padding: '0 10px',
            height: 40,
            boxSizing: 'border-box',
          }}
        >
          <input
            type="date"
            value={customStart}
            onChange={e => setCustomStart(e.target.value)}
            style={{ border: 0, outline: 0, fontSize: 13, color: '#1e293b', background: 'transparent' }}
          />
          <span style={{ color: '#94a3b8', fontSize: 12.5 }}>to</span>
          <input
            type="date"
            value={customEnd}
            onChange={e => setCustomEnd(e.target.value)}
            style={{ border: 0, outline: 0, fontSize: 13, color: '#1e293b', background: 'transparent' }}
          />
          <button
            type="button"
            onClick={handleCustomApply}
            style={{
              background: '#5E0CF3',
              color: '#fff',
              border: 0,
              borderRadius: 7,
              padding: '6px 12px',
              fontSize: 12.5,
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
