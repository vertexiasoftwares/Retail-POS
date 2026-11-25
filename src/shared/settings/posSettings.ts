import { useEffect, useState } from 'react'
import type { PosPaymentMethod } from '../../types/desktop-api'

export type PosSettings = {
  // Store contact details shown on receipts
  businessPhone: string
  businessCity: string
  businessAddress: string
  taxNumber: string
  // Receipt settings
  receiptHeader: string
  receiptFooter: string
  showLogoOnReceipt: boolean
  showBusinessDetailsOnReceipt: boolean
  showCashierOnReceipt: boolean
  autoPrintAfterSale: boolean
  // POS & Billing behavior
  defaultPaymentMethod: Exclude<PosPaymentMethod, 'Udhaar'>
  allowLineDiscounts: boolean
  // Inventory & Cash defaults
  defaultMinStock: number
  defaultOpeningCashRupees: number
  // Display & Shimmer
  shimmerDurationSec: number
}

const STORAGE_KEY = 'vertexia_pos_settings_v1'
export const SETTINGS_CHANGED_EVENT = 'vertexia:pos-settings-changed'

export const DEFAULT_POS_SETTINGS: PosSettings = {
  businessPhone: '',
  businessCity: '',
  businessAddress: '',
  taxNumber: '',
  receiptHeader: '',
  receiptFooter: 'Thank you for shopping with us.',
  showLogoOnReceipt: true,
  showBusinessDetailsOnReceipt: true,
  showCashierOnReceipt: true,
  autoPrintAfterSale: false,
  defaultPaymentMethod: 'Cash',
  allowLineDiscounts: true,
  defaultMinStock: 5,
  defaultOpeningCashRupees: 0,
  shimmerDurationSec: 3.5,
}

export function getPosSettings(): PosSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      // Migrate any legacy individual keys if present
      return {
        ...DEFAULT_POS_SETTINGS,
        businessPhone: localStorage.getItem('vtx_biz_phone') ?? '',
        businessCity: localStorage.getItem('vtx_biz_city') ?? '',
        businessAddress: localStorage.getItem('vtx_biz_address') ?? '',
        taxNumber: localStorage.getItem('vtx_biz_ntn') ?? '',
        receiptHeader: localStorage.getItem('vtx_receipt_header') ?? '',
        receiptFooter: localStorage.getItem('vtx_receipt_footer') ?? DEFAULT_POS_SETTINGS.receiptFooter,
        showLogoOnReceipt: localStorage.getItem('vtx_receipt_logo') !== 'false',
        defaultMinStock: Math.max(0, Number(localStorage.getItem('vtx_low_stock') ?? 5) || 5),
        defaultOpeningCashRupees: Math.max(0, Number(localStorage.getItem('vtx_opening_cash') ?? 0) || 0),
      }
    }
    const parsed = JSON.parse(raw) as Partial<PosSettings>
    return {
      ...DEFAULT_POS_SETTINGS,
      ...parsed,
      defaultMinStock: Math.max(0, Number(parsed.defaultMinStock ?? 5) || 0),
      defaultOpeningCashRupees: Math.max(0, Number(parsed.defaultOpeningCashRupees ?? 0) || 0),
      shimmerDurationSec:
        typeof parsed.shimmerDurationSec === 'number' && parsed.shimmerDurationSec >= 0
          ? parsed.shimmerDurationSec
          : DEFAULT_POS_SETTINGS.shimmerDurationSec,
    }
  } catch {
    return { ...DEFAULT_POS_SETTINGS }
  }
}

export function savePosSettings(patch: Partial<PosSettings>): PosSettings {
  const next = { ...getPosSettings(), ...patch }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {}
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT))
  }
  return next
}

export function resetPosSettings(): PosSettings {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {}
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT))
  }
  return { ...DEFAULT_POS_SETTINGS }
}

export function usePosSettings(): PosSettings {
  const [settings, setSettings] = useState<PosSettings>(() => getPosSettings())
  useEffect(() => {
    const sync = () => setSettings(getPosSettings())
    window.addEventListener(SETTINGS_CHANGED_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(SETTINGS_CHANGED_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])
  return settings
}
