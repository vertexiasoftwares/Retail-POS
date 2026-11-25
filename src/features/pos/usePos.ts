import { useAuth } from '../../app/auth/useAuth'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  PosBootstrap,
  PosCartLineInput,
  PosCompletedSale,
  PosCreateCustomerInput,
  PosCreateProductInput,
  PosPaymentMethod,
  PosProduct,
} from '../../types/desktop-api'
import { useOperationIdentity } from '../../shared/hooks/useOperationIdentity'
import { notifyRetailDataChanged } from '../../services/retail-events'
import { getPosSettings, usePosSettings } from '../../shared/settings/posSettings'

export type PosCartLine = PosProduct & { quantityInCartMilli: number; discountBasisPoints: number }

export type PosBillPreview = {
  createdAt: string
  customerName: string
  customerPhone: string
  paymentMethod: PosPaymentMethod
  subtotalPaisa: number
  discountPaisa: number
  totalPaisa: number
  cashReceivedPaisa: number
  changePaisa: number
  lines: Array<{
    name: string
    quantityMilli: number
    unitPricePaisa: number
    discountPaisa: number
    lineTotalPaisa: number
  }>
}

const lineSubtotal = (line: PosCartLine) => Math.round((line.sellingPricePaisa * line.quantityInCartMilli) / 1000)
export const lineDiscount = (line: PosCartLine) => Math.round((lineSubtotal(line) * line.discountBasisPoints) / 10_000)
export const lineTotal = (line: PosCartLine) => lineSubtotal(line) - lineDiscount(line)

export function usePos() {
  const { session, can } = useAuth()
  const posSettings = usePosSettings()
  const branchId = session!.branchId
  const saleOperation = useOperationIdentity('sale')
  const shiftOperation = useOperationIdentity('shift-open')
  const busyRef = useRef(false)
  const [data, setData] = useState<PosBootstrap | null>(null)
  const [cart, setCart] = useState<PosCartLine[]>([])
  const [customerId, setCustomerId] = useState('customer-walk-in')
  const [draftCustomerName, setDraftCustomerName] = useState('')
  const [draftCustomerPhone, setDraftCustomerPhone] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PosPaymentMethod>(() => getPosSettings().defaultPaymentMethod)
  const [cashReceived, setCashReceived] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [billPreview, setBillPreview] = useState<PosBillPreview | null>(null)
  const [receipt, setReceipt] = useState<PosCompletedSale | null>(null)

  const refresh = useCallback(async () => {
    if (!window.vertexia) {
      setError('Desktop database is unavailable. Start Vertexia with npm run dev:desktop.')
      setLoading(false)
      return
    }
    try {
      const result = await window.vertexia.pos.getBootstrap(branchId)
      setData(result)
      setError('')
      setCustomerId(current => (result.customers.some(customer => customer.id === current) ? current : result.customers[0]?.id ?? 'customer-walk-in'))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'POS data could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [branchId])

  useEffect(() => {
    const task = window.setTimeout(() => void refresh(), 0)
    return () => window.clearTimeout(task)
  }, [refresh])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 3500)
    return () => window.clearTimeout(timer)
  }, [notice])

  const subtotalPaisa = useMemo(() => cart.reduce((sum, line) => sum + lineSubtotal(line), 0), [cart])
  const discountPaisa = useMemo(() => cart.reduce((sum, line) => sum + lineDiscount(line), 0), [cart])
  const totalPaisa = subtotalPaisa - discountPaisa

  const hasTypedCash = cashReceived.trim() !== ''
  const parsedCash = Number(cashReceived)
  const isValidCashNumber = hasTypedCash && Number.isFinite(parsedCash) && parsedCash >= 0
  const typedCashPaisa = isValidCashNumber ? Math.round(parsedCash * 100) : 0
  const effectiveCashReceivedPaisa = paymentMethod === 'Cash' ? typedCashPaisa : totalPaisa
  const changePaisa = paymentMethod === 'Cash' ? Math.max(0, effectiveCashReceivedPaisa - totalPaisa) : 0

  const selectedSavedCustomer = useMemo(() => {
    const found = data?.customers.find(c => c.id === customerId)
    return found && !found.isWalkIn ? found : undefined
  }, [data?.customers, customerId])

  const effectiveCustomerName = draftCustomerName.trim() || selectedSavedCustomer?.name || ''
  const effectiveCustomerPhone = draftCustomerPhone.trim() || selectedSavedCustomer?.phone || ''
  const hasNamedCustomer = Boolean(effectiveCustomerName)

  const selectCustomer = (id: string) => {
    const chosen = data?.customers.find(c => c.id === id)
    if (!chosen || chosen.isWalkIn) {
      setCustomerId('customer-walk-in')
      setDraftCustomerName('')
      setDraftCustomerPhone('')
      return
    }
    setCustomerId(chosen.id)
    setDraftCustomerName(chosen.name)
    setDraftCustomerPhone(chosen.phone ?? '')
  }

  const updateCustomerName = (name: string) => {
    setDraftCustomerName(name)
    if (selectedSavedCustomer && name.trim().toLowerCase() !== selectedSavedCustomer.name.toLowerCase()) {
      setCustomerId('customer-walk-in')
    }
  }

  const updateCustomerPhone = (phone: string) => {
    setDraftCustomerPhone(phone)
  }

  const clearCustomer = () => {
    setCustomerId('customer-walk-in')
    setDraftCustomerName('')
    setDraftCustomerPhone('')
  }

  const addProduct = useCallback((product: PosProduct) => {
    setError('')
    setCart(current => {
      const existing = current.find(line => line.id === product.id)
      const nextQuantity = (existing?.quantityInCartMilli ?? 0) + 1000
      if (nextQuantity > product.quantityMilli) {
        setError(`${product.name} has insufficient stock.`)
        return current
      }
      if (existing) {
        return current.map(line => (line.id === product.id ? { ...line, quantityInCartMilli: nextQuantity } : line))
      }
      return [...current, { ...product, quantityInCartMilli: 1000, discountBasisPoints: 0 }]
    })
  }, [])

  const setQuantity = (productId: string, quantityMilli: number) =>
    setCart(current =>
      current.map(line =>
        line.id === productId ? { ...line, quantityInCartMilli: Math.min(line.quantityMilli, Math.max(1, quantityMilli)) } : line
      )
    )

  const setDiscount = (productId: string, basisPoints: number) =>
    setCart(current =>
      current.map(line =>
        line.id === productId ? { ...line, discountBasisPoints: Math.min(10_000, Math.max(0, basisPoints)) } : line
      )
    )

  const removeLine = (productId: string) => setCart(current => current.filter(line => line.id !== productId))

  const clearCart = () => {
    setCart([])
    setCashReceived('')
    setPaymentMethod(getPosSettings().defaultPaymentMethod)
  }

  const requestLines = (): PosCartLineInput[] =>
    cart.map(line => ({
      productId: line.id,
      quantityMilli: line.quantityInCartMilli,
      discountBasisPoints: line.discountBasisPoints,
    }))

  const run = async <T,>(operation: () => Promise<T>) => {
    if (busyRef.current) return undefined
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      return await operation()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The operation could not be completed.')
      return undefined
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  /** Opens Bill Preview modal without persisting any sale to database until user confirms Complete Bill. */
  const openBillPreview = () => {
    if (!data) return
    if (!cart.length) {
      setError('Add at least one product before billing.')
      return
    }
    if (!data.activeShiftId) {
      setError('Open a cash shift before billing.')
      return
    }
    if (paymentMethod === 'Cash' && !hasTypedCash) {
      setError('Enter Cash Received amount before generating bill.')
      return
    }
    if (paymentMethod === 'Cash' && (!isValidCashNumber || typedCashPaisa < totalPaisa)) {
      setError('Cash received is less than the bill total.')
      return
    }
    if (paymentMethod === 'Udhaar' && !hasNamedCustomer) {
      setError('Enter customer name or select a customer before using Udhaar.')
      return
    }
    setError('')
    setBillPreview({
      createdAt: new Date().toISOString(),
      customerName: effectiveCustomerName,
      customerPhone: effectiveCustomerPhone,
      paymentMethod,
      subtotalPaisa,
      discountPaisa,
      totalPaisa,
      cashReceivedPaisa: effectiveCashReceivedPaisa,
      changePaisa,
      lines: cart.map(line => ({
        name: line.name,
        quantityMilli: line.quantityInCartMilli,
        unitPricePaisa: line.sellingPricePaisa,
        discountPaisa: lineDiscount(line),
        lineTotalPaisa: lineTotal(line),
      })),
    })
  }

  const closeBillPreview = () => {
    if (busy) return
    setBillPreview(null)
  }

  /** Commits and stores the sale permanently only when cashier explicitly clicks Complete Bill. */
  const confirmCompleteSale = async () => {
    if (!window.vertexia || !data) return
    if (paymentMethod === 'Cash' && !hasTypedCash) {
      setError('Enter Cash Received amount before completing sale.')
      return
    }
    if (paymentMethod === 'Cash' && (!isValidCashNumber || typedCashPaisa < totalPaisa)) {
      setError('Cash received is less than the bill total.')
      return
    }
    const trimmedName = draftCustomerName.trim()
    const trimmedPhone = draftCustomerPhone.trim()
    const request = {
      branchId: data.branchId,
      customerId,
      customerName: trimmedName || undefined,
      customerPhone: trimmedPhone || undefined,
      lines: requestLines(),
      paymentMethod,
      cashReceivedPaisa: effectiveCashReceivedPaisa,
    }
    const result = await run(() =>
      window.vertexia!.pos.completeSale({ ...request, operationId: saleOperation.idFor(request) })
    )
    if (!result) return
    saleOperation.reset()
    notifyRetailDataChanged()
    setBillPreview(null)
    setReceipt(null)
    clearCart()
    clearCustomer()
    setNotice(`${result.invoiceNumber} completed & saved successfully!`)
    await refresh()
  }

  const holdSale = async () => {
    if (!window.vertexia || !data) return
    const result = await run(() => window.vertexia!.pos.holdSale(data.branchId, customerId, requestLines()))
    if (!result) return
    clearCart()
    clearCustomer()
    setNotice('Sale held successfully.')
    await refresh()
  }

  const resumeSale = async (id: string) => {
    if (!window.vertexia || !data) return
    const held = await run(() => window.vertexia!.pos.resumeHeldSale(id))
    if (!held?.lines) return
    const next = held.lines
      .map(saved => {
        const product = data.products.find(item => item.id === saved.productId)
        return product
          ? { ...product, quantityInCartMilli: saved.quantityMilli, discountBasisPoints: saved.discountBasisPoints }
          : null
      })
      .filter((line): line is PosCartLine => line !== null)
    setCart(next)
    selectCustomer(held.customerId)
    setNotice('Held sale restored.')
    await refresh()
  }

  const deleteHeldSale = async (id: string) => {
    if (!window.vertexia) return
    const result = await run(async () => {
      await window.vertexia!.pos.deleteHeldSale(id)
      return true
    })
    if (!result) return
    setNotice('Held sale removed.')
    await refresh()
  }

  const openShift = async (openingCashPaisa: number) => {
    if (!window.vertexia || !data) return false
    const request = { branchId: data.branchId, openingCashPaisa }
    const result = await run(() =>
      window.vertexia!.pos.openShift(data.branchId, openingCashPaisa, shiftOperation.idFor(request))
    )
    if (!result) return false
    shiftOperation.reset()
    notifyRetailDataChanged()
    setNotice('Cash shift opened.')
    await refresh()
    return true
  }

  const createProduct = async (input: PosCreateProductInput) => {
    if (!window.vertexia || !data) return false
    const product = await run(() => window.vertexia!.pos.createProduct(data.branchId, input))
    if (!product) return false
    notifyRetailDataChanged()
    setNotice(`${product.name} added.`)
    await refresh()
    return true
  }

  const createCustomer = async (input: PosCreateCustomerInput) => {
    if (!window.vertexia) return false
    const customer = await run(() => window.vertexia!.pos.createCustomer(input))
    if (!customer) return false
    await refresh()
    setCustomerId(customer.id)
    setDraftCustomerName(customer.name)
    setDraftCustomerPhone(customer.phone ?? '')
    setNotice(`${customer.name} added.`)
    return true
  }

  return {
    canDiscount: can('pos.discount') && posSettings.allowLineDiscounts,
    data,
    cart,
    customerId,
    setCustomerId: selectCustomer,
    draftCustomerName,
    updateCustomerName,
    draftCustomerPhone,
    updateCustomerPhone,
    clearCustomer,
    selectedSavedCustomer,
    effectiveCustomerName,
    effectiveCustomerPhone,
    hasNamedCustomer,
    paymentMethod,
    setPaymentMethod,
    cashReceived,
    setCashReceived,
    subtotalPaisa,
    discountPaisa,
    totalPaisa,
    cashReceivedPaisa: effectiveCashReceivedPaisa,
    changePaisa,
    loading,
    busy,
    error,
    setError,
    notice,
    billPreview,
    openBillPreview,
    closeBillPreview,
    confirmCompleteSale,
    completeSale: confirmCompleteSale,
    receipt,
    setReceipt,
    refresh,
    addProduct,
    setQuantity,
    setDiscount,
    removeLine,
    clearCart,
    holdSale,
    resumeSale,
    deleteHeldSale,
    openShift,
    createProduct,
    createCustomer,
  }
}

export type PosController = ReturnType<typeof usePos>
