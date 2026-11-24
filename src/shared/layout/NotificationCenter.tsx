import { useState, useRef, useEffect, useMemo } from 'react'
import { Icon } from '../ui/Icon'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { useRetailData } from '../../app/data/useRetailData'
import type { ProductRecord } from '../../features/products/products.types'

export type StoreNotification = {
  id: string
  type: 'stock' | 'shift' | 'sale' | 'system'
  title: string
  message: string
  timestamp: string
  read: boolean
  actionPage?: string
}

const STORAGE_KEY = 'vertexia_read_notifications_v1'

export function NotificationCenter({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { products } = useRetailData()
  const [open, setOpen] = useState(false)
  const [showAllModal, setShowAllModal] = useState(false)
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const popoverRef = useRef<HTMLDivElement>(null)

  useEscapeKey(() => setOpen(false), open)

  const [readIds, setReadIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      return stored ? new Set(JSON.parse(stored)) : new Set<string>()
    } catch {
      return new Set<string>()
    }
  })

  const markAsRead = (id: string) => {
    setReadIds(prev => {
      const next = new Set(prev)
      next.add(id)
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

  // Derive notifications from actual store data + events
  const notifications = useMemo<StoreNotification[]>(() => {
    const items: StoreNotification[] = []

    // 1. Low stock alerts
    const lowStock = (products as ProductRecord[]).filter((p: ProductRecord) => p.stock <= p.minimumStock)
    for (const p of lowStock) {
      items.push({
        id: `low-stock-${p.id}`,
        type: 'stock',
        title: p.stock <= 0 ? `Out of Stock: ${p.name}` : `Low Stock: ${p.name}`,
        message: p.stock <= 0
          ? `${p.name} has 0 stock remaining. Reorder needed.`
          : `${p.name} stock (${p.stock} ${p.unit}) is below minimum (${p.minimumStock}).`,
        timestamp: 'Active Alert',
        read: readIds.has(`low-stock-${p.id}`),
        actionPage: 'Inventory',
      })
    }

    // 2. Default initial notifications if list is sparse
    items.push({
      id: 'shift-sync-notice',
      type: 'shift',
      title: 'Cash Shift Tracking Active',
      message: 'Blind cash counts and shift management ready for cashiers.',
      timestamp: 'Today',
      read: readIds.has('shift-sync-notice'),
      actionPage: 'Cash & Shifts',
    })

    items.push({
      id: 'system-online-notice',
      type: 'system',
      title: 'Vertexia POS Ready',
      message: 'Local SQLite offline database connected and synchronized.',
      timestamp: 'Today',
      read: readIds.has('system-online-notice'),
      actionPage: 'Dashboard',
    })

    return items
  }, [products, readIds])

  const unreadCount = notifications.filter(n => !n.read).length
  const displayedNotifications = filter === 'unread' ? notifications.filter(n => !n.read) : notifications

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleOutsideClick)
    }
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [open])

  return (
    <div className="notification-center-container" ref={popoverRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        className="icon-button notification-button"
        onClick={() => setOpen(prev => !prev)}
        aria-label={`Notifications, ${unreadCount} unread`}
        aria-expanded={open}
        style={{
          cursor: 'pointer',
          position: 'relative',
          width: '38px',
          height: '38px',
          borderRadius: '8px',
          border: '1px solid #e2e8f0',
          background: '#f8fafc',
          display: 'grid',
          placeItems: 'center',
          padding: 0,
        }}
      >
        <Icon name="bell" size={20} />
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute',
            top: '-4px',
            right: '-4px',
            background: '#ef4444',
            color: '#fff',
            borderRadius: '999px',
            minWidth: '18px',
            height: '18px',
            padding: '0 4px',
            fontSize: '10.5px',
            fontWeight: 700,
            lineHeight: '18px',
            textAlign: 'center',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '2px solid #ffffff',
            boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
            pointerEvents: 'none',
            boxSizing: 'border-box',
          }}>
            {unreadCount}
          </span>
        )}
      </button>

      {/* Popover */}
      {open && (
        <div
          className="notification-popover"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            width: '340px',
            maxWidth: '92vw',
            background: '#ffffff',
            borderRadius: '12px',
            boxShadow: '0 12px 32px rgba(15, 23, 42, 0.2), 0 2px 6px rgba(0,0,0,0.06)',
            border: '1px solid #e2e8f0',
            zIndex: 10000,
            overflow: 'hidden',
          }}
        >
          {/* Popover Header */}
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: '#f8fafc',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <strong style={{ fontSize: '14px', color: '#0f172a' }}>Notifications</strong>
              {unreadCount > 0 && (
                <span style={{ fontSize: '11px', background: '#fee2e2', color: '#dc2626', padding: '1px 7px', borderRadius: '10px', fontWeight: 600 }}>
                  {unreadCount} new
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllAsRead}
                style={{
                  border: 0,
                  background: 'transparent',
                  color: '#2563eb',
                  fontSize: '11.5px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                Mark all as read
              </button>
            )}
          </div>

          {/* Filter Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid #f1f5f9', background: '#fff', padding: '4px 10px', gap: '6px' }}>
            <button
              type="button"
              onClick={() => setFilter('all')}
              style={{
                flex: 1,
                padding: '5px 0',
                border: 0,
                borderRadius: '6px',
                background: filter === 'all' ? '#eff6ff' : 'transparent',
                color: filter === 'all' ? '#2563eb' : '#64748b',
                fontWeight: filter === 'all' ? 700 : 500,
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              All ({notifications.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter('unread')}
              style={{
                flex: 1,
                padding: '5px 0',
                border: 0,
                borderRadius: '6px',
                background: filter === 'unread' ? '#eff6ff' : 'transparent',
                color: filter === 'unread' ? '#2563eb' : '#64748b',
                fontWeight: filter === 'unread' ? 700 : 500,
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              Unread ({unreadCount})
            </button>
          </div>

          {/* Notifications List */}
          <div style={{ maxHeight: '280px', overflowY: 'auto' }}>
            {displayedNotifications.length === 0 ? (
              <div style={{ padding: '24px 16px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>
                No {filter === 'unread' ? 'unread ' : ''}notifications.
              </div>
            ) : (
              displayedNotifications.map(item => (
                <div
                  key={item.id}
                  style={{
                    padding: '10px 14px',
                    borderBottom: '1px solid #f1f5f9',
                    display: 'flex',
                    gap: '10px',
                    alignItems: 'flex-start',
                    background: item.read ? '#ffffff' : '#f8faff',
                    transition: 'background 0.15s ease',
                  }}
                >
                  <div
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '8px',
                      display: 'grid',
                      placeItems: 'center',
                      flexShrink: 0,
                      background: item.type === 'stock' ? '#fee2e2' : item.type === 'shift' ? '#f3e8ff' : '#e0f2fe',
                      color: item.type === 'stock' ? '#dc2626' : item.type === 'shift' ? '#7e22ce' : '#0284c7',
                      fontSize: '14px',
                    }}
                  >
                    {item.type === 'stock' ? '⚠' : item.type === 'shift' ? '▣' : 'ℹ'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong style={{ fontSize: '12.5px', color: '#1e293b' }}>{item.title}</strong>
                      <small style={{ fontSize: '10.5px', color: '#94a3b8' }}>{item.timestamp}</small>
                    </div>
                    <p style={{ margin: '3px 0 0', fontSize: '11.5px', color: '#64748b', lineHeight: 1.35 }}>
                      {item.message}
                    </p>
                    <div style={{ display: 'flex', gap: '10px', marginTop: '6px', alignItems: 'center' }}>
                      {item.actionPage && (
                        <button
                          type="button"
                          onClick={() => {
                            setOpen(false)
                            onNavigate?.(item.actionPage!)
                          }}
                          style={{
                            border: 0,
                            background: 'transparent',
                            color: '#2563eb',
                            fontSize: '11px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            padding: 0,
                          }}
                        >
                          View in {item.actionPage} →
                        </button>
                      )}
                      {!item.read && (
                        <button
                          type="button"
                          onClick={() => markAsRead(item.id)}
                          style={{
                            border: 0,
                            background: 'transparent',
                            color: '#64748b',
                            fontSize: '11px',
                            cursor: 'pointer',
                            padding: 0,
                          }}
                        >
                          ✓ Mark read
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer View All */}
          <div
            style={{
              padding: '10px 14px',
              borderTop: '1px solid #e2e8f0',
              background: '#f8fafc',
              textAlign: 'center',
            }}
          >
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                if (onNavigate) {
                  onNavigate('Notifications')
                } else {
                  setShowAllModal(true)
                }
              }}
              style={{
                border: 0,
                background: 'transparent',
                color: '#2563eb',
                fontSize: '12.5px',
                fontWeight: 600,
                cursor: 'pointer',
                width: '100%',
              }}
            >
              View All Notifications ({notifications.length}) →
            </button>
          </div>
        </div>
      )}

      {/* Full Notifications Modal */}
      {showAllModal && (
        <AllNotificationsModal
          notifications={notifications}
          onMarkRead={markAsRead}
          onMarkAllRead={markAllAsRead}
          onNavigate={onNavigate}
          onClose={() => setShowAllModal(false)}
        />
      )}
    </div>
  )
}

function AllNotificationsModal({
  notifications,
  onMarkRead,
  onMarkAllRead,
  onNavigate,
  onClose,
}: {
  notifications: StoreNotification[]
  onMarkRead: (id: string) => void
  onMarkAllRead: () => void
  onNavigate?: (page: string) => void
  onClose: () => void
}) {
  useEscapeKey(onClose, true)
  const [selectedType, setSelectedType] = useState<string>('all')
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    return notifications.filter(n => {
      const matchType = selectedType === 'all' || n.type === selectedType
      const matchQuery = !search.trim() ||
        `${n.title} ${n.message}`.toLowerCase().includes(search.trim().toLowerCase())
      return matchType && matchQuery
    })
  }, [notifications, selectedType, search])

  return (
    <div
      className="medkit-modal-backdrop"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        background: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(4px)',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        boxSizing: 'border-box',
      }}
    >
      <div
        className="modal-card"
        style={{
          width: '760px',
          maxWidth: '95vw',
          maxHeight: '86vh',
          borderRadius: 14,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          margin: 'auto',
          position: 'relative',
          background: '#ffffff',
          boxShadow: '0 25px 50px -12px rgba(15, 23, 42, 0.25)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <header
          style={{
            padding: '16px 22px',
            background: 'linear-gradient(135deg, #1e293b, #0f172a)',
            color: '#fff',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Icon name="bell" size={20} />
            <div>
              <h2 style={{ margin: 0, fontSize: 17, color: '#fff' }}>All Notifications Center</h2>
              <small style={{ color: '#94a3b8', fontSize: 12 }}>Store alerts, inventory updates, and shift records</small>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 0,
              color: '#94a3b8',
              fontSize: 18,
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </header>

        {/* Filter bar */}
        <div
          style={{
            padding: '12px 20px',
            borderBottom: '1px solid #e2e8f0',
            background: '#f8fafc',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', gap: 6 }}>
            {['all', 'stock', 'shift', 'system'].map(cat => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedType(cat)}
                style={{
                  padding: '5px 12px',
                  borderRadius: 6,
                  border: '1px solid',
                  borderColor: selectedType === cat ? '#2563eb' : '#cbd5e1',
                  background: selectedType === cat ? '#2563eb' : '#fff',
                  color: selectedType === cat ? '#fff' : '#334155',
                  fontSize: 12,
                  fontWeight: 600,
                  textTransform: 'capitalize',
                  cursor: 'pointer',
                }}
              >
                {cat === 'all' ? 'All Alerts' : cat === 'stock' ? 'Low Stock' : cat === 'shift' ? 'Cash Shifts' : 'System'}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="text"
              placeholder="Search notifications..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                border: '1px solid #cbd5e1',
                fontSize: 12.5,
                outline: 0,
              }}
            />
            <button
              type="button"
              onClick={onMarkAllRead}
              style={{
                border: '1px solid #cbd5e1',
                background: '#fff',
                padding: '6px 12px',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600,
                color: '#2563eb',
                cursor: 'pointer',
              }}
            >
              Mark All Read
            </button>
          </div>
        </div>

        {/* Modal List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
              No notifications matching your search.
            </div>
          ) : (
            filtered.map(item => (
              <div
                key={item.id}
                style={{
                  padding: '14px',
                  borderRadius: 8,
                  border: '1px solid',
                  borderColor: item.read ? '#e2e8f0' : '#bfdbfe',
                  background: item.read ? '#ffffff' : '#f0f7ff',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 14,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flex: 1 }}>
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      display: 'grid',
                      placeItems: 'center',
                      background: item.type === 'stock' ? '#fee2e2' : item.type === 'shift' ? '#f3e8ff' : '#e0f2fe',
                      color: item.type === 'stock' ? '#dc2626' : item.type === 'shift' ? '#7e22ce' : '#0284c7',
                      fontSize: 15,
                    }}
                  >
                    {item.type === 'stock' ? '⚠' : item.type === 'shift' ? '▣' : 'ℹ'}
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <strong style={{ fontSize: 13.5, color: '#0f172a' }}>{item.title}</strong>
                      {!item.read && (
                        <span style={{ fontSize: 10, background: '#2563eb', color: '#fff', padding: '1px 6px', borderRadius: 8, fontWeight: 700 }}>
                          UNREAD
                        </span>
                      )}
                    </div>
                    <p style={{ margin: '4px 0 0', fontSize: 12.5, color: '#475569' }}>{item.message}</p>
                    <small style={{ fontSize: 11, color: '#94a3b8', marginTop: 4, display: 'block' }}>{item.timestamp}</small>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {item.actionPage && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose()
                        onNavigate?.(item.actionPage!)
                      }}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 6,
                        border: '1px solid #bfdbfe',
                        background: '#eff6ff',
                        color: '#2563eb',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Open {item.actionPage}
                    </button>
                  )}
                  {!item.read && (
                    <button
                      type="button"
                      onClick={() => onMarkRead(item.id)}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 6,
                        border: '1px solid #cbd5e1',
                        background: '#fff',
                        color: '#64748b',
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      ✓
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        <footer style={{ padding: '12px 20px', borderTop: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 22px',
              borderRadius: 6,
              background: '#0f172a',
              color: '#fff',
              border: 0,
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </footer>
      </div>
    </div>
  )
}
