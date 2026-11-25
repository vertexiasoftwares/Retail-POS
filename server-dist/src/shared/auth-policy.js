const operational = ['transfers.read', 'transfers.dispatch', 'transfers.receive', 'transfers.cancel', 'reports.read', 'dashboard.read', 'pos.sell', 'pos.discount', 'customers.create', 'customers.read', 'customers.manage', 'customers.collect', 'expenses.read', 'expenses.manage', 'shifts.open', 'shifts.read', 'shifts.close', 'cash.manage', 'products.read', 'products.manage', 'retail.read', 'stock.adjust', 'purchases.receive', 'suppliers.pay', 'sales.read', 'sales.return', 'data.export'];
export const rolePermissions = {
    Owner: [...operational, 'branches.manage', 'users.manage', 'settings.manage', 'backup.manage'],
    Manager: operational,
    Cashier: ['pos.sell', 'customers.create', 'customers.read', 'customers.collect', 'shifts.open', 'shifts.read', 'shifts.close', 'sales.read'],
    Inventory: ['transfers.read', 'transfers.dispatch', 'transfers.receive', 'products.read', 'products.manage', 'retail.read', 'stock.adjust', 'purchases.receive'],
};
export function isUserRole(value) { return typeof value === 'string' && Object.hasOwn(rolePermissions, value); }
export function canAccessPage(page, permissions, allowedTabs) {
    if (page === 'Notifications' || page === 'Help Center')
        return true;
    if (allowedTabs && Array.isArray(allowedTabs) && allowedTabs.length > 0) {
        return allowedTabs.includes(page);
    }
    const required = { License: 'settings.manage', Branches: 'branches.manage', 'Stock Transfers': 'transfers.read', Reports: 'reports.read', Customers: 'customers.read', Expenses: 'expenses.read', Dashboard: 'dashboard.read', POS: 'pos.sell', Sales: 'sales.read', 'Sales History': 'sales.read', Returns: 'sales.return', Products: 'products.read', Inventory: 'retail.read', Purchases: 'purchases.receive', Suppliers: 'suppliers.pay', Staff: 'users.manage', 'Cash & Shifts': 'shifts.read', Settings: 'settings.manage' };
    return Boolean(required[page] && permissions.includes(required[page]));
}
//# sourceMappingURL=auth-policy.js.map