import { forwardRef } from 'react'
import { Icon } from '../../shared/ui/Icon'
import { NotificationCenter } from '../../shared/layout/NotificationCenter'
import { OwnerDropdown } from '../../shared/layout/OwnerDropdown'
import type { PosBootstrap } from '../../types/desktop-api'

type Props = {
  onMenu: () => void
  data: PosBootstrap | null
  search: string
  onSearch: (value: string) => void
  onSearchEnter: () => void
  onScan: () => void
  onNavigate?: (page: string) => void
}

export const PosHeader = forwardRef<HTMLInputElement, Props>(function PosHeader(
  { data, search, onSearch, onSearchEnter, onScan, onNavigate },
  ref
) {
  return (
    <header className="topbar pos-topbar">
      <div className="search-field pos-search">
        <Icon name="search" size={19} />
        <input
          ref={ref}
          value={search}
          onChange={event => onSearch(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') onSearchEnter()
          }}
          aria-label="Scan barcode or search product"
          placeholder="Scan barcode or search product..."
        />
        <kbd>F2</kbd>
      </div>
      <button className="scan-button" onClick={onScan}>
        <span>▥</span>Scan
      </button>
      <div className="topbar-right" style={{ marginLeft: 'auto' }}>
        <NotificationCenter onNavigate={onNavigate} />
        <div className="store-switcher">
          <span className="store-avatar">
            <Icon name="store" size={22} />
          </span>
          <span>
            <strong>{data?.businessName ?? 'Retail POS'}</strong>
            <small>{data?.branchName ?? 'Main Branch'}</small>
          </span>
        </div>
        <OwnerDropdown onNavigate={onNavigate} />
      </div>
    </header>
  )
})
