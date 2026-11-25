import type { ComponentType } from 'react'
import type { PageProps } from '../shared/layout/PageShell'
import type { PageName } from '../types'
import LicensePage from '../features/licensing/LicensePage'
import BranchesPage from '../features/branches/BranchesPage'
import TransfersPage from '../features/transfers/TransfersPage'
import DashboardPage from '../features/dashboard/DashboardPage'
import PosPage from '../features/pos/PosPage'
import SalesPage from '../features/sales/SalesPage'
import SalesHistoryPage from '../features/sales/SalesHistoryPage'
import ReturnsPage from '../features/returns/ReturnsPage'
import ProductsPage from '../features/products/ProductsPage'
import InventoryPage from '../features/inventory/InventoryPage'
import PurchasesPage from '../features/purchases/PurchasesPage'
import CustomersPage from '../features/customers/CustomersPage'
import SuppliersPage from '../features/suppliers/SuppliersPage'
import CashShiftsPage from '../features/cash-shifts/CashShiftsPage'
import ExpensesPage from '../features/expenses/ExpensesPage'
import StaffPage from '../features/staff/StaffPage'
import ReportsPage from '../features/reports/ReportsPage'
import SettingsPage from '../features/settings/SettingsPage'
import HelpCenterPage from '../features/help/HelpCenterPage'
import NotificationsPage from '../features/notifications/NotificationsPage'

export const hashToPage: Record<string, PageName> = {
  '#license': 'License',
  '#branches': 'Branches', '#stock-transfers': 'Stock Transfers', '#dashboard': 'Dashboard', '#pos': 'POS', '#sales': 'Sales', '#sales-history': 'Sales History', '#returns': 'Returns', '#products': 'Products',
  '#inventory': 'Inventory', '#purchases': 'Purchases', '#customers': 'Customers',
  '#suppliers': 'Suppliers', '#cash-shifts': 'Cash & Shifts', '#expenses': 'Expenses',
  '#staff': 'Staff', '#reports': 'Reports', '#settings': 'Settings', '#help-center': 'Help Center',
  '#notifications': 'Notifications',
}

export const pageToHash: Record<PageName, string> = Object.fromEntries(
  Object.entries(hashToPage).map(([hash, page]) => [page, hash]),
) as Record<PageName, string>

export const pages: Record<PageName, ComponentType<PageProps>> = {
  License: LicensePage,
  Branches: BranchesPage, 'Stock Transfers': TransfersPage, Dashboard: DashboardPage, POS: PosPage, Sales: SalesPage, 'Sales History': SalesHistoryPage, Returns: ReturnsPage, Products: ProductsPage,
  Inventory: InventoryPage, Purchases: PurchasesPage, Customers: CustomersPage,
  Suppliers: SuppliersPage, 'Cash & Shifts': CashShiftsPage, Expenses: ExpensesPage,
  Staff: StaffPage, Reports: ReportsPage, Settings: SettingsPage, 'Help Center': HelpCenterPage,
  Notifications: NotificationsPage,
}
