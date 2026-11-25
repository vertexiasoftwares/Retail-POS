import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon, type IconName } from './Icon'

export type CustomSelectOption = {
  value: string
  label: string
  badge?: string
}

export type CustomSelectProps = {
  value: string
  onChange: (value: string) => void
  options: CustomSelectOption[]
  icon?: IconName
  placeholder?: string
  ariaLabel?: string
  disabled?: boolean
  className?: string
  triggerClassName?: string
  size?: 'xs' | 'sm' | 'md'
  fullWidth?: boolean
  align?: 'left' | 'right'
  minWidth?: number | string
}

export function CustomSelect({
  value,
  onChange,
  options,
  icon,
  placeholder = 'Select…',
  ariaLabel,
  disabled = false,
  className = '',
  triggerClassName = '',
  size = 'md',
  fullWidth = false,
  align = 'left',
  minWidth,
}: CustomSelectProps) {
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number; width: number; openUp: boolean }>({
    top: 0,
    left: 0,
    width: 180,
    openUp: false,
  })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  const selected = options.find(opt => opt.value === value)

  const updatePosition = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const estimatedHeight = Math.min(280, options.length * 38 + 14)
    const spaceBelow = window.innerHeight - rect.bottom
    const openUp = spaceBelow < estimatedHeight && rect.top > estimatedHeight
    const menuWidth = Math.max(rect.width, 168)
    const maxLeft = Math.max(8, window.innerWidth - menuWidth - 8)
    const alignedLeft = align === 'right' ? rect.right - menuWidth : rect.left
    const nextCoords = {
      top: openUp ? rect.top - 6 : rect.bottom + 6,
      left: Math.min(Math.max(8, alignedLeft), maxLeft),
      width: menuWidth,
      openUp,
    }
    setCoords(prev =>
      prev.top === nextCoords.top &&
      prev.left === nextCoords.left &&
      prev.width === nextCoords.width &&
      prev.openUp === nextCoords.openUp
        ? prev
        : nextCoords
    )
  }, [align, options.length])

  useLayoutEffect(() => {
    if (!open) return
    updatePosition()
  }, [open, updatePosition])

  useEffect(() => {
    if (!open) return
    const handleOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    const handleReposition = () => updatePosition()

    document.addEventListener('mousedown', handleOutside)
    window.addEventListener('keydown', handleKey, true)
    window.addEventListener('resize', handleReposition)
    window.addEventListener('scroll', handleReposition, true)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      window.removeEventListener('keydown', handleKey, true)
      window.removeEventListener('resize', handleReposition)
      window.removeEventListener('scroll', handleReposition, true)
    }
  }, [open, updatePosition])

  return (
    <div
      className={`vx-select-wrap ${fullWidth ? 'vx-select-full' : ''} ${className}`}
      style={{
        display: fullWidth ? 'block' : 'inline-block',
        width: fullWidth ? '100%' : undefined,
        minWidth,
        position: 'relative',
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => !disabled && setOpen(prev => !prev)}
        className={`vx-select-trigger vx-select-${size} ${open ? 'is-open' : ''} ${triggerClassName}`}
      >
        <span className="vx-select-value">
          {icon && (
            <span className="vx-select-icon">
              <Icon name={icon} size={size === 'xs' ? 13 : 16} />
            </span>
          )}
          <span className="vx-select-text">{selected ? selected.label : placeholder}</span>
        </span>
        <svg
          className={`vx-select-chevron ${open ? 'is-open' : ''}`}
          width={size === 'xs' ? 12 : 15}
          height={size === 'xs' ? 12 : 15}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={listId}
            role="listbox"
            className={`vx-select-menu ${coords.openUp ? 'open-up' : 'open-down'}`}
            style={{
              position: 'fixed',
              top: coords.openUp ? undefined : coords.top,
              bottom: coords.openUp ? window.innerHeight - coords.top : undefined,
              left: coords.left,
              minWidth: coords.width,
              maxWidth: 'min(340px, calc(100vw - 16px))',
            }}
          >
            {options.map(option => {
              const isSelected = option.value === value
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={`vx-select-option ${isSelected ? 'is-selected' : ''}`}
                  onClick={() => {
                    onChange(option.value)
                    setOpen(false)
                  }}
                >
                  <span className="vx-select-option-label">
                    {option.label}
                    {option.badge && <small className="vx-select-option-badge">{option.badge}</small>}
                  </span>
                  {isSelected && (
                    <svg
                      className="vx-select-check"
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              )
            })}
          </div>,
          document.body
        )}
    </div>
  )
}
