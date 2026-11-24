import { type ReactNode } from 'react'

export type PosProductVisualProps = {
  kind?: string
  category?: string
  name?: string
  imageUrl?: string | null
  size?: number
  className?: string
}

type CategoryStyle = {
  bg: string
  border: string
  color: string
  icon: ReactNode
}

function getCategoryConfig(category = '', name = '', kind = ''): CategoryStyle {
  const text = `${category} ${name} ${kind}`.toLowerCase()

  // 1. Dairy
  if (/dairy|milk|cheese|butter|yogurt|cream|doodh|dahi|makhan/.test(text)) {
    return {
      bg: '#eff6ff',
      border: '#bfdbfe',
      color: '#2563eb',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 2h8v3H8z" />
          <path d="M7 5h10l2 4v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9l2-4z" />
          <path d="M12 12v5" />
          <path d="M9.5 14.5h5" />
        </svg>
      ),
    }
  }

  // 2. Beverages & Drinks
  if (/beverage|drink|juice|soda|cola|pepsi|water|sharbat|tea|coffee|chai|coke|sprite/.test(text)) {
    return {
      bg: '#eef2ff',
      border: '#c7d2fe',
      color: '#4f46e5',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 8h1a4 4 0 1 1 0 8h-1" />
          <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" />
          <line x1="6" x2="6" y1="2" y2="4" />
          <line x1="10" x2="10" y1="2" y2="4" />
          <line x1="14" x2="14" y1="2" y2="4" />
        </svg>
      ),
    }
  }

  // 3. Bakery, Snacks & Confectionery
  if (/bakery|biscuit|cookie|bread|cake|rusk|snack|chips|lays|sweet|mithai|confectionery|chocolate|nimko/.test(text)) {
    return {
      bg: '#fff7ed',
      border: '#fed7aa',
      color: '#ea580c',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5" />
          <path d="M8.5 8.5v.01" />
          <path d="M16 15.5v.01" />
          <path d="M12 12v.01" />
          <path d="M11 17v.01" />
          <path d="M7 13v.01" />
        </svg>
      ),
    }
  }

  // 4. Fresh Produce & Fruits / Veg
  if (/fruit|veg|sabzi|phal|apple|banana|onion|potato|tomato|fresh|salad/.test(text)) {
    return {
      bg: '#f7fee7',
      border: '#d9f99d',
      color: '#65a30d',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2a5 5 0 0 0-5 5c0 4 5 11 5 11s5-7 5-11a5 5 0 0 0-5-5Z" />
          <path d="M12 2v4" />
        </svg>
      ),
    }
  }

  // 5. Meat & Poultry
  if (/meat|chicken|mutton|beef|fish|gosht|poultry|seafood/.test(text)) {
    return {
      bg: '#fff1f2',
      border: '#fecdd3',
      color: '#e11d48',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="8" />
          <path d="m15 9-6 6" />
        </svg>
      ),
    }
  }

  // 6. Pharmacy & Medicine
  if (/medicine|pharm|drug|tablet|capsule|syrup|health|pain|panadol|cough/.test(text)) {
    return {
      bg: '#ecfdf5',
      border: '#a7f3d0',
      color: '#059669',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z" />
          <path d="m8.5 8.5 7 7" />
        </svg>
      ),
    }
  }

  // 7. Personal Care & Cosmetics
  if (/personal|care|soap|shampoo|cream|lotion|beauty|cosmetic|toothpaste|lux|colgate|perfume|wash/.test(text)) {
    return {
      bg: '#fdf2f8',
      border: '#fbcfe8',
      color: '#db2777',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
        </svg>
      ),
    }
  }

  // 8. Cleaning & Household
  if (/clean|detergent|surf|tide|harpic|tissue|household|bleach|soap/.test(text)) {
    return {
      bg: '#ecfeff',
      border: '#a5f3fc',
      color: '#0891b2',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m15 4-3 3 2 2 3-3" />
          <path d="M12 7 4 15l2 2 8-8" />
          <path d="M18 10l-2-2" />
          <path d="m4 15 2 2" />
        </svg>
      ),
    }
  }

  // 9. Grocery / Pulses / Grains / Spices / Cooking Oil
  if (/grocery|dal|daal|grain|flour|atta|rice|chawal|sugar|cheeni|oil|ghee|masala|spice|salt|lentil|chana/.test(text)) {
    return {
      bg: '#f5f3ff',
      border: '#ddd6fe',
      color: '#7c3aed',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
          <path d="M3 6h18" />
          <path d="M16 10a4 4 0 0 1-8 0" />
        </svg>
      ),
    }
  }

  // 10. Electronics & Accessories
  if (/electronic|mobile|cable|charger|battery|device|tech/.test(text)) {
    return {
      bg: '#faf5ff',
      border: '#e9d5ff',
      color: '#9333ea',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect width="16" height="20" x="4" y="2" rx="2" ry="2" />
          <line x1="12" x2="12.01" y1="18" y2="18" />
        </svg>
      ),
    }
  }

  // Default: Elegant Retail Package
  return {
    bg: '#f6f1ff',
    border: '#e9d8fd',
    color: '#5E0CF3',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m16.5 9.4-9-5.19" />
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.29 7 12 12 20.71 7" />
        <line x1="12" x2="12" y1="22" y2="12" />
      </svg>
    ),
  }
}

export function PosProductVisual({
  kind = '',
  category = '',
  name = '',
  imageUrl,
  size = 36,
  className = '',
}: PosProductVisualProps) {
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={name || 'Product'}
        className={`pos-product-uploaded-img ${className}`}
        style={{
          width: size,
          height: size,
          minWidth: size,
          minHeight: size,
          objectFit: 'cover',
          borderRadius: 8,
          border: '1px solid #e2e8f0',
          display: 'block',
        }}
      />
    )
  }

  const conf = getCategoryConfig(category, name, kind)

  return (
    <div
      className={`pos-product-category-badge ${className}`}
      style={{
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
        borderRadius: 9,
        background: conf.bg,
        border: `1px solid ${conf.border}`,
        color: conf.color,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
      }}
      title={category ? `${category} product` : name || 'Product'}
      aria-label={name || category || 'Product icon'}
    >
      {conf.icon}
    </div>
  )
}
