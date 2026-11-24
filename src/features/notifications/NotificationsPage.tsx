import { useState, useMemo } from 'react'
import { PageShell, type PageProps } from '../../shared/layout/PageShell'
import { TopNavHeader } from '../../shared/layout/TopNavHeader'
import { Icon } from '../../shared/ui/Icon'
import { useRetailData } from '../../app/data/useRetailData'
import type { ProductRecord } from '../products/products.types'

const STORAGE_KEY = 'vertexia_read_notifications_v1'

export type StoreNotification = {
  id: string
  type: 'stock' | 'shift' | 'sale' | 'system'
  title: string
  message: string
  timestamp: string
  read: boolean
  actionPage?: string
}

export default function NotificationsPage(props: PageProps) {
  const { products } = useRetailData()
  const [selectedType, setSelectedType] = useState<string>('all')
  const [unreadOnly, setUnreadOnly] = useState<boolean>(false)
  const [search, setSearch] = useState<string>('')

  const [readIds, setReadIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      return stored ? new Set(JSON.parse(stored)) : new Set<string>()
    } catch {
      return new Set<string>()
    }
  })

  const toggleRead = (id: string) => {
    setReadIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(next)))
      } catch {}
      return next
    })
  }

  const markAllAsRead = () => {
    const allIds = notifications.map(n => n.id)
    const next = new Set([...readIds, ...allIds])
    setReadIds(next)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(next)))
    } catch {}
  }

  // Derive notifications from actual system state
  const notifications = useMemo<StoreNotification[]>(() => {
    const items: StoreNotification[] = []

    // 1. Low & Out of stock alerts
    const lowStock = (products as ProductRecord[]).filter((p: ProductRecord) => p.stock <= p.minimumStock)
    for (const p of lowStock) {
      items.push({
        id: `low-stock-${p.id}`,
        type: 'stock',
        title: p.stock <= 0 ? `Out of Stock: ${p.name}` : `Low Stock: ${p.name}`,
        message: p.stock <= 0
          ? `${p.name} has 0 stock remaining. Immediate reorder required.`
          : `${p.name} stock level (${p.stock} ${p.unit}) is below minimum alert threshold (${p.minimumStock}).`,
        timestamp: 'Active Alert',
        read: readIds.has(`low-stock-${p.id}`),
        actionPage: 'Inventory',
      })
    }

    // 2. Shift tracking alert
    items.push({
      id: 'shift-sync-notice',
      type: 'shift',
      title: 'Cash Shift Tracking Active',
      message: 'Blind cash counts, drawer balance records, and shift reports are active for counters.',
      timestamp: 'Today',
      read: readIds.has('shift-sync-notice'),
      actionPage: 'Cash & Shifts',
    })

    // 3. System status
    items.push({
      id: 'system-online-notice',
      type: 'system',
      title: 'Vertexia POS Ready',
      message: 'Local SQLite offline database connected and synchronized.',
      timestamp: 'System',
      read: readIds.has('system-online-notice'),
      actionPage: 'Dashboard',
    })

    return items
  }, [products, readIds])

  const totalCount = notifications.length
  const unreadCount = notifications.filter(n => !n.read).length
  const stockCount = notifications.filter(n => n.type === 'stock').length
  const otherCount = notifications.filter(n => n.type === 'shift' || n.type === 'system').length

  const filtered = useMemo(() => {
    return notifications.filter(n => {
      const matchType = selectedType === 'all' || n.type === selectedType
      const matchUnread = !unreadOnly || !n.read
      const matchSearch =
        !search.trim() ||
        `${n.title} ${n.message}`.toLowerCase().includes(search.trim().toLowerCase())
      return matchType && matchUnread && matchSearch
    })
  }, [notifications, selectedType, unreadOnly, search])

  return (
    <PageShell
      {...props}
      activePage="Notifications"
      className="notifications-page-app"
      header={() => (
        <TopNavHeader
          title="Notifications & Alerts"
          subtitle="Real-time store alerts, inventory thresholds, and shift records"
          onNavigate={props.onNavigate}
        />
      )}
    >
      <div className="medkit-page-container" style={{ padding: '20px 24px', width: '100%', maxWidth: '100%', margin: 0, boxSizing: 'border-box' }}>
        {/* Banner */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '20px',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div>
            <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#0f172a', margin: 0 }}>
              Store Notifications
            </h1>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
              Manage and review real-time alerts across all registers, inventory, and system operations.
            </p>
          </div>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={markAllAsRead}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 16px',
                borderRadius: '8px',
                background: '#2563eb',
                color: '#fff',
                border: 0,
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: '0 2px 6px rgba(37, 99, 235, 0.25)',
              }}
            >
              ✓ Mark All as Read
            </button>
          )}
        </div>

        {/* Metric KPI cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
            gap: '14px',
            marginBottom: '20px',
          }}
        >
          <div
            style={{
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: '12px',
              padding: '16px 20px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}
          >
            <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>
              Total Alerts
            </div>
            <div style={{ fontSize: '26px', fontWeight: 700, color: '#0f172a', marginTop: '4px' }}>
              {totalCount}
            </div>
          </div>

          <div
            style={{
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: '12px',
              padding: '16px 20px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}
          >
            <div style={{ fontSize: '12px', color: '#dc2626', fontWeight: 600, textTransform: 'uppercase' }}>
              Unread Alerts
            </div>
            <div style={{ fontSize: '26px', fontWeight: 700, color: '#dc2626', marginTop: '4px' }}>
              {unreadCount}
            </div>
          </div>

          <div
            style={{
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: '12px',
              padding: '16px 20px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}
          >
            <div style={{ fontSize: '12px', color: '#d97706', fontWeight: 600, textTransform: 'uppercase' }}>
              Inventory Warnings
            </div>
            <div style={{ fontSize: '26px', fontWeight: 700, color: '#d97706', marginTop: '4px' }}>
              {stockCount}
            </div>
          </div>

          <div
            style={{
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: '12px',
              padding: '16px 20px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}
          >
            <div style={{ fontSize: '12px', color: '#7c3aed', fontWeight: 600, textTransform: 'uppercase' }}>
              System & Shifts
            </div>
            <div style={{ fontSize: '26px', fontWeight: 700, color: '#7c3aed', marginTop: '4px' }}>
              {otherCount}
            </div>
          </div>
        </div>

        {/* Filter controls row */}
        <div
          style={{
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            padding: '14px 18px',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            flexWrap: 'wrap',
          }}
        >
          {/* Category Tabs */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {[
              { id: 'all', label: `All (${totalCount})` },
              { id: 'stock', label: `Low Stock (${stockCount})` },
              { id: 'shift', label: 'Cash Shifts' },
              { id: 'system', label: 'System' },
            ].map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSelectedType(tab.id)}
                style={{
                  height: '38px',
                  padding: '0 14px',
                  borderRadius: '8px',
                  border: '1px solid',
                  borderColor: selectedType === tab.id ? '#2563eb' : '#dce4ef',
                  background: selectedType === tab.id ? '#eff6ff' : '#fff',
                  color: selectedType === tab.id ? '#2563eb' : '#475569',
                  fontSize: '13px',
                  fontWeight: selectedType === tab.id ? 700 : 500,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {tab.label}
              </button>
            ))}

            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '13px',
                color: '#334155',
                cursor: 'pointer',
                marginLeft: '6px',
                userSelect: 'none',
              }}
            >
              <input
                type="checkbox"
                checked={unreadOnly}
                onChange={e => setUnreadOnly(e.target.checked)}
                style={{ width: '16px', height: '16px', cursor: 'pointer' }}
              />
              Unread only
            </label>
          </div>

          {/* Search box */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              border: '1px solid #dce4ef',
              borderRadius: '8px',
              background: '#f8fafc',
              padding: '0 12px',
              height: '38px',
              minWidth: '240px',
            }}
          >
            <Icon name="search" size={16} />
            <input
              type="text"
              placeholder="Search notifications..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                border: 0,
                outline: 0,
                background: 'transparent',
                fontSize: '13px',
                color: '#1e293b',
                width: '100%',
              }}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                style={{
                  border: 0,
                  background: 'transparent',
                  color: '#94a3b8',
                  fontSize: '14px',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Notifications List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filtered.length === 0 ? (
            <div
              style={{
                background: '#fff',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                padding: '48px 24px',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: '36px', marginBottom: '8px' }}>🔔</div>
              <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a', margin: '0 0 6px' }}>
                No notifications found
              </h3>
              <p style={{ fontSize: '13px', color: '#64748b', margin: 0 }}>
                {unreadOnly
                  ? 'All notifications have been read.'
                  : 'There are no notifications matching your selected criteria.'}
              </p>
            </div>
          ) : (
            filtered.map(item => (
              <div
                key={item.id}
                style={{
                  background: item.read ? '#ffffff' : '#f8faff',
                  border: '1px solid',
                  borderColor: item.read ? '#e2e8f0' : '#bfdbfe',
                  borderRadius: '12px',
                  padding: '16px 20px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: '16px',
                  boxShadow: item.read ? 'none' : '0 2px 6px rgba(37, 99, 235, 0.05)',
                  transition: 'background 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start', flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '10px',
                      display: 'grid',
                      placeItems: 'center',
                      flexShrink: 0,
                      background:
                        item.type === 'stock'
                          ? '#fee2e2'
                          : item.type === 'shift'
                          ? '#f3e8ff'
                          : '#e0f2fe',
                      color:
                        item.type === 'stock'
                          ? '#dc2626'
                          : item.type === 'shift'
                          ? '#7e22ce'
                          : '#0284c7',
                      fontSize: '16px',
                    }}
                  >
                    {item.type === 'stock' ? '⚠' : item.type === 'shift' ? '▣' : 'ℹ'}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: '14px', color: '#0f172a' }}>{item.title}</strong>
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 600,
                          padding: '2px 8px',
                          borderRadius: '6px',
                          background: item.read ? '#f1f5f9' : '#dbeafe',
                          color: item.read ? '#64748b' : '#1d4ed8',
                        }}
                      >
                        {item.read ? 'Read' : 'New'}
                      </span>
                      <small style={{ fontSize: '11.5px', color: '#94a3b8' }}>• {item.timestamp}</small>
                    </div>

                    <p style={{ margin: '6px 0 0', fontSize: '13px', color: '#475569', lineHeight: 1.45 }}>
                      {item.message}
                    </p>
                  </div>
                </div>

                {/* Card Actions */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                  {item.actionPage && (
                    <button
                      type="button"
                      onClick={() => props.onNavigate(item.actionPage!)}
                      style={{
                        padding: '6px 12px',
                        borderRadius: '6px',
                        border: '1px solid #dce4ef',
                        background: '#ffffff',
                        color: '#2563eb',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      View in {item.actionPage} →
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => toggleRead(item.id)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '6px',
                      border: '1px solid #dce4ef',
                      background: '#f8fafc',
                      color: item.read ? '#64748b' : '#059669',
                      fontSize: '12px',
                      fontWeight: 500,
                      cursor: 'pointer',
                    }}
                  >
                    {item.read ? 'Mark unread' : '✓ Mark read'}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </PageShell>
  )
}
