import type { PosPaymentMethod } from '../../types/desktop-api'

/**
 * Payment method brand badges using CSP-safe inline vector marks matching
 * real-world Cash (banknotes), Card (Mastercard/Visa), JazzCash, Easypaisa,
 * and Udhaar (Khata ledger) checkout identities.
 */
export function PaymentMethodIcon({ method, selected }: { method: PosPaymentMethod; selected?: boolean }) {
  if (method === 'Cash') {
    return (
      <span className={`pm-icon-badge pm-cash ${selected ? 'selected' : ''}`} aria-hidden="true">
        <svg width="42" height="28" viewBox="0 0 46 30" fill="none">
          <rect x="4" y="6.5" width="38" height="20" rx="3.5" fill="#D1FAE5" stroke="#059669" strokeWidth="1.4" />
          <rect x="2" y="3.5" width="38" height="20" rx="3.5" fill="#ECFDF5" stroke="#047857" strokeWidth="1.6" />
          <rect x="5" y="6.5" width="32" height="14" rx="2" stroke="#10B981" strokeWidth="1.1" strokeDasharray="2 1.5" />
          <circle cx="21" cy="13.5" r="4.6" fill="#059669" />
          <text
            x="21"
            y="16"
            textAnchor="middle"
            fill="#FFFFFF"
            fontSize="6.4"
            fontWeight="800"
            fontFamily="system-ui, -apple-system, sans-serif"
          >
            Rs
          </text>
          <circle cx="9.5" cy="13.5" r="1.4" fill="#059669" opacity="0.65" />
          <circle cx="32.5" cy="13.5" r="1.4" fill="#059669" opacity="0.65" />
        </svg>
      </span>
    )
  }

  if (method === 'Card') {
    return (
      <span className={`pm-icon-badge pm-card ${selected ? 'selected' : ''}`} aria-hidden="true">
        <svg width="44" height="28" viewBox="0 0 48 30" fill="none">
          <rect x="1.5" y="2" width="45" height="26" rx="5" fill="#FFFFFF" stroke="#CBD5E1" strokeWidth="1.4" />
          <rect x="1.5" y="6.5" width="45" height="4.5" fill="#1E293B" />
          {/* EMV gold chip */}
          <rect x="6" y="14" width="9" height="7" rx="1.5" fill="#FBBF24" stroke="#D97706" strokeWidth="0.9" />
          <path d="M9 14v7M6 17.5h9" stroke="#B45309" strokeWidth="0.7" opacity="0.7" />
          {/* Overlapping Mastercard-style dual circles */}
          <circle cx="31.5" cy="19.5" r="5" fill="#EB001B" />
          <circle cx="37.5" cy="19.5" r="5" fill="#F79E1B" fillOpacity="0.92" />
          <path d="M34.5 15.5a5 5 0 0 1 0 8 5 5 0 0 1 0-8Z" fill="#FF5F00" />
        </svg>
      </span>
    )
  }

  if (method === 'JazzCash') {
    return (
      <span className={`pm-icon-badge pm-jazzcash ${selected ? 'selected' : ''}`} aria-hidden="true">
        <svg width="46" height="28" viewBox="0 0 56 32" fill="none">
          <rect x="1" y="1.5" width="54" height="29" rx="6" fill="#FFFFFF" stroke="#E2E8F0" strokeWidth="1.3" />
          {/* Authentic Jazz overlapping crimson red + golden yellow mark */}
          <circle cx="13.5" cy="13.5" r="7.2" fill="#E30613" />
          <circle cx="19" cy="17.5" r="6.8" fill="#FFC60A" />
          <path d="M17.5 11.2a7.2 7.2 0 0 0-4.9 9 6.8 6.8 0 0 0 6.8-8.8 7.1 7.1 0 0 0-1.9-.2Z" fill="#F97316" />
          <circle cx="14.2" cy="13.2" r="1.9" fill="#FFFFFF" />
          {/* Crisp stacked brand wordmark */}
          <text
            x="30"
            y="14.5"
            fill="#18181B"
            fontSize="8.8"
            fontWeight="800"
            letterSpacing="-0.3"
            fontFamily="'Plus Jakarta Sans', system-ui, sans-serif"
          >
            Jazz
          </text>
          <text
            x="30"
            y="24"
            fill="#E30613"
            fontSize="8.5"
            fontWeight="800"
            letterSpacing="-0.2"
            fontFamily="'Plus Jakarta Sans', system-ui, sans-serif"
          >
            Cash
          </text>
        </svg>
      </span>
    )
  }

  if (method === 'Easypaisa') {
    return (
      <span className={`pm-icon-badge pm-easypaisa ${selected ? 'selected' : ''}`} aria-hidden="true">
        <svg width="46" height="28" viewBox="0 0 56 32" fill="none">
          <rect x="1" y="1.5" width="54" height="29" rx="6" fill="#FFFFFF" stroke="#D1FAE5" strokeWidth="1.4" />
          {/* Centered authentic Easypaisa charcoal lowercase 'e' mark */}
          <path
            d="M34.6 12.8c0-3.8-2.9-6.6-7.1-6.6-4.2 0-7.2 3-7.2 7.1 0 4 3 6.9 7.4 6.9 2.6 0 4.7-1 6-2.5l-2.2-1.9c-.9.9-2.1 1.4-3.6 1.4-2 0-3.5-1.1-3.9-2.7h10.4c.1-.6.2-1.1.2-1.7Zm-10.5-1.2c.4-1.5 1.7-2.5 3.4-2.5 1.7 0 2.9 1 3.3 2.5h-6.7Z"
            fill="#171717"
          />
          {/* Authentic vibrant Easypaisa green curving smile / leaf swoosh */}
          <path
            d="M16.5 22.3c5.2 4.1 14.5 4.4 22.8-1.9 1-.8 1.9-1.6 2.6-2.4-4.7 2.8-14.2 6.2-25.4 4.3Z"
            fill="#00A859"
          />
          <circle cx="40.5" cy="14.2" r="2.1" fill="#00A859" />
        </svg>
      </span>
    )
  }

  // Udhaar (Khata / Customer Credit)
  return (
    <span className={`pm-icon-badge pm-udhaar ${selected ? 'selected' : ''}`} aria-hidden="true">
      <svg width="42" height="28" viewBox="0 0 46 30" fill="none">
        <rect x="10" y="2.5" width="26" height="25" rx="4" fill="#F5F3FF" stroke="#6D28D9" strokeWidth="1.7" />
        <path d="M16 2.5v25" stroke="#6D28D9" strokeWidth="1.6" />
        <path d="M20 9.5h10.5M20 14h8M20 18.5h6" stroke="#7C3AED" strokeWidth="1.7" strokeLinecap="round" />
        <circle cx="33.5" cy="21" r="6" fill="#5E0CF3" stroke="#FFFFFF" strokeWidth="1.5" />
        <text
          x="33.5"
          y="23.2"
          textAnchor="middle"
          fill="#FFFFFF"
          fontSize="6"
          fontWeight="800"
          fontFamily="system-ui, sans-serif"
        >
          Rs
        </text>
      </svg>
    </span>
  )
}
