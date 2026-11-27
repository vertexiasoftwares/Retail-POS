export type ReportSection = 'transfers' | 'overview' | 'sales' | 'expenses' | 'purchases' | 'customers' | 'suppliers' | 'stock' | 'shifts'
export type ReportTrendGranularity = 'daily' | 'weekly' | 'monthly'
export type ReportQuery = { branchId: string; allBranches?: boolean; dateFrom: string; dateTo: string; section: ReportSection; page?: number; pageSize?: number; trendGranularity?: ReportTrendGranularity }
export type ReportColumn = { key: string; label: string; kind?: 'money' | 'quantity' }
export type ReportTable = { title: string; columns: ReportColumn[]; rows: Record<string, string | number>[]; total: number; page: number; pageCount: number }
export type StockValuation = { valuePaisa: number; estimatedValuePaisa: number; estimatedProducts: number; productCount: number }
export type ReportSummary = StockValuation & {
  salesPaisa: number
  returnsPaisa: number
  netSalesPaisa: number
  costPaisa: number
  grossProfitPaisa: number
  expensesPaisa: number
  operatingProfitPaisa: number
  purchasesPaisa: number
  collectionsPaisa: number
  supplierPaymentsPaisa: number
  customerDuePaisa: number
  customerCreditPaisa: number
  supplierDuePaisa: number
  supplierCreditPaisa: number
  estimatedCostLines: number
  stockAdjustmentCostPaisa: number
  inTransitValuePaisa: number
  inventoryValuePaisa: number
  invoiceCount: number
  itemsSoldMilli: number
  averageInvoicePaisa: number
  newCustomersCount: number
}
export type ReportTrendPoint = { periodKey: string; label: string; salesPaisa: number; returnsPaisa: number; netSalesPaisa: number; grossProfitPaisa: number }
export type ReportCategoryPoint = { category: string; netSalesPaisa: number; quantityMilli: number }
export type ReportTopProduct = { productId: string; name: string; category: string; unit: string; quantityMilli: number; netSalesPaisa: number }
export type ReportStaffSale = { userId: string; name: string; invoiceCount: number; salesPaisa: number; returnsPaisa: number; netSalesPaisa: number }
export type ReportRecentSale = { id: string; invoiceNumber: string; completedAt: string; customerName: string; paymentMethod: string; totalPaisa: number; status: string }
export type ReportExpenseCategory = { category: string; netPaisa: number }
export type ReportCounterSale = { counterId: string; counterNumber: number; name: string; invoiceCount: number; salesPaisa: number; returnsPaisa: number; netSalesPaisa: number }
export type ReportSnapshot = {
  businessName: string
  branchNames: string[]
  dateFrom: string
  dateTo: string
  generatedAt: string
  summary: ReportSummary
  payments: { method: string; netSalesPaisa: number }[]
  salesTrend: ReportTrendPoint[]
  categorySales: ReportCategoryPoint[]
  topProducts: ReportTopProduct[]
  staffSales: ReportStaffSale[]
  recentSales: ReportRecentSale[]
  expenseByCategory: ReportExpenseCategory[]
  byCounter?: ReportCounterSale[]
  table: ReportTable
}
