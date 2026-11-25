# Vertexia Retail POS — End-to-End Architecture & Real-World Retail Operations Review

> **Audit Scope & Rules:** Yeh review read-only code audit par mabni hai (`d:\MUSIC 30 oct 26\New folder`). Har baat code, database schema, IPC handlers, API routes aur UI components ki exact evidence par likhi gayi hai. Koi hissa guess nahi kiya gaya; jo feature code mein nahi mila usay saaf **"not found"** likha gaya hai.

---

## 1. System Overview (System Kaise Chalta Hai)

**Tech Stack & Structure (Short Summary):**
- **Desktop Shell:** Electron `44.7.0` (`electron/main.mts`, `electron/preload.cts`, `electron/ipc-policy.mts`).
- **Frontend UI:** React `19.2.8` + TypeScript `6.0.2` + Vite `8.3.0` + Tailwind CSS `4.3.3` (`src/app/`, `src/features/`, `src/shared/`).
- **Local Database:** Node built-in `node:sqlite` (`DatabaseSync`, `PRAGMA journal_mode=WAL`, `synchronous=FULL`, `foreign_keys=ON`) (`electron/database/schema.mts`, `database.mts`, `auth.mts`, `cash.mts`, `accounts.mts`, `retail.mts`, `reports.mts`, `valuation.mts`, `posting.mts`, `branches.mts`, `transfers.mts`).
- **LAN / Web Server:** Fastify `5.12.8` + RFC 6455 WebSocket (`server/server.mts`, `server/routes/*.mts`, `server/websocket.mts`, `server/lock.mts`).
- **Utilities & Media:** `jsbarcode` (barcode SVG), `pngjs`, `framer-motion`, HTML-based `.xls` / `window.print()` PDF export (`src/shared/utils/exportUtils.ts`).
- **Cloud Touchpoint:** Sirf license/store registration check (`electron/licensing/*`, `src/services/cloudLicensing.ts`) via Supabase endpoint (`medkit-api`). Business data cloud par sync **nahi** hota.

**Simple Words Mein Data Flow:**
1. **Desktop Mode (Single PC):** Cashier React UI mein button dabata hai -> `window.vertexia.*` IPC (`electron/preload.cts`) -> `electron/main.mts` permission/branch check (`electron/ipc-policy.mts`) -> `VertexiaDatabase` / repositories SQLite file (`%APPDATA%/.../data/vertexia.db`) mein `BEGIN IMMEDIATE` transaction likhte hain -> UI state refresh hoti hai (`vertexia:retail-data-changed`).
2. **LAN Browser Mode (Multi-Device on Local Wi-Fi/Network):** `server/server.mts` port `8080` (`0.0.0.0`) par chalta hai. Doosre PC/tablet ka browser `src/services/browserAdapter.ts` aur `apiClient.ts` ke zariye HTTP REST (`/api/*`) calls bhejta hai. Server SQLite update karke WebSocket se baqi browsers ko reload signal deta hai. Electron desktop aur LAN server ek sath same DB par nahi chal sakte (`server/lock.mts` file lock laga deta hai).

---

## 2. Database & Data Storage Map

### A. SQLite Relational Schema (`electron/database/schema.mts` — Migrations v1 to v14, Total 44 `STRICT` Tables)

**Key Relationships (Asaan Map):**
- `businesses` (1) -> (many) `branches`, `users`, `products`, `customers`, `suppliers`, `stock_transfers`.
- `branches` (1) -> (many) `stock_levels`, `stock_movements`, `stock_values`, `sales`, `sale_returns`, `manual_returns`, `purchases`, `cash_shifts`, `expenses`, `customer_ledger`, `customer_receipts`, `supplier_ledger`, `supplier_payments`, `audit_events`.
- `sales` -> `sale_items` -> `sale_item_costs` + `sale_payments` -> `sale_returns` -> `sale_return_items`.
- `purchases` -> `purchase_items` + `supplier_payment_allocations` <- `supplier_payments`.
- `cash_shifts` -> `cash_transactions` -> `cash_movement_notes` + `cash_shift_closings` (1-to-1 close record).

### B. Complete Data Storage Table

| Data Type | Where Saved | Table / Key / File & Key Fields | Works Offline? |
| :--- | :--- | :--- | :--- |
| **App Metadata & Install ID** | Local SQLite | `app_meta` (`key`, `value` — e.g. `installation_id`, `auth_setup_complete`, `seeded_business_date`) | Yes |
| **Business & Branches** | Local SQLite | `businesses` (`currency_code='PKR'`, `timezone='Asia/Karachi'`), `branches` (`id`, `business_id`, `code`, `name`, `city`, `is_active`) | Yes |
| **Users, Login & Permissions** | Local SQLite | `users` (`role`, `is_active`, `allowed_tabs`), `user_credentials` (`username`, `password_hash`, `credential_version`, `must_change_password`, `failed_attempts`, `locked_until`), `user_branches`, `login_throttle` | Yes |
| **Live Login Sessions** | RAM (Process Memory) | Desktop: `desktopSession` (`electron/database/auth.mts`); Web/LAN: in-memory `Map` + `vertexia_session` cookie (`server/server.mts`). **Server restart par khatam.** | Yes |
| **Products & Barcodes** | Local SQLite | `products` (`sku`, `barcode`, `name`, `category`, `subcategory`, `brand`, `unit`, `visual_kind`, `purchase_price_paisa`, `selling_price_paisa`, `mrp_paisa`, `minimum_stock_milli`, `image_data_url`, `is_active`). **Note:** `tax_rate`, `shelf`, `expiry` columns **not found**. | Yes |
| **Stock Qty & Cost Valuation** | Local SQLite | `stock_levels` (`branch_id`, `product_id`, `quantity_milli`), `stock_movements`, `stock_values` (`total_cost_paisa`, `estimated`), `stock_value_movements` | Yes |
| **POS Sales & Invoices** | Local SQLite | `sales` (`invoice_number`, `business_date`, `customer_id`, `cashier_id`, `subtotal_paisa`, `discount_paisa`, `total_paisa`, `cost_paisa`, `status`, `shift_id`), `sale_items` (`product_name_snapshot`, `quantity_milli`, `unit_price_paisa`, `unit_cost_paisa`, `discount_paisa`, `line_total_paisa`), `sale_item_costs`, `sale_payments` (`method`, `amount_paisa`) | Yes |
| **Held (Pending) Bills** | Local SQLite | `held_sales` (`id`, `branch_id`, `customer_id`, `cart_json`, `item_count`, `total_paisa`, `held_at`) | Yes |
| **Returns (Bill & Manual)** | Local SQLite | `sale_returns` (`return_number`, `sale_id`, `refund_method`, `total_paisa`, `cost_paisa`, `shift_id`), `sale_return_items`, `manual_returns` (`return_number`, `customer_id`, `refund_method`, `total_paisa`), `manual_return_items` | Yes |
| **Customers & Udhaar Ledger** | Local SQLite | `customers` (`name`, `phone`, `is_walk_in`, `is_active`), `customer_ledger` (`entry_type`: `opening_balance`/`sale`/`payment`/`sale_return`, `debit_paisa`, `credit_paisa`), `customer_receipts` (`receipt_number`, `amount_paisa`, `balance_after_paisa`) | Yes |
| **Suppliers & Purchases** | Local SQLite | `suppliers`, `supplier_profiles` (`ntn_strn`, `opening_balance_paisa`, `payment_terms`, etc.), `purchases` (`purchase_number`, `supplier_invoice_number`, `total_paisa`), `purchase_items`, `supplier_ledger`, `supplier_payments`, `supplier_payment_allocations` | Yes |
| **Cash Shifts & Drawer Moves** | Local SQLite | `cash_shifts` (`opening_cash_paisa`, `status`, `counter_id`, `close_reason`), `cash_shift_closings` (`counted_cash_paisa`, `expected_cash_paisa`, `variance_paisa`), `cash_transactions`, `cash_movement_notes` | Yes |
| **Expenses & Reversals** | Local SQLite | `expenses` (`business_date`, `description`, `category`, `amount_paisa`, `payment_method`), `expense_postings` (`expense_number`, `reference`, `created_by`), `expense_reversals` (`reversal_number`, `reason`) | Yes |
| **Inter-Branch Transfers** | Local SQLite | `stock_transfers` (`transfer_number`, `source_branch_id`, `destination_branch_id`, `status`), `stock_transfer_items`, `transfer_document_sequences` | Yes |
| **Bill Numbers & Idempotency** | Local SQLite | `document_sequences`, `account_document_sequences`, `transfer_document_sequences`, `operation_results` (`branch_id`, `operation_id`, `kind`, `request_hash`, `result_json`) | Yes |
| **Audit Logs** | Local SQLite | `audit_events` (`actor_id`, `entity_type`, `action`, `entity_id`, `summary`, `details`, `occurred_at`) — **UI viewer page not found**. | Yes |
| **Backups** | Local File System + SQLite Meta | Backup folder mein `.sqlite` + `.sqlite.json` files + `backup_metadata` table (`electron/backup.mts`). **Web/LAN mode mein real backup not found (stub).** | Yes (Desktop only) |
| **License / Store Activation** | Encrypted File + Cloud + `localStorage` | Desktop: `device.bin` via Electron `safeStorage` (`electron/licensing/*`). Web/Fallback: `localStorage` keys `vertexia_cloud_license`, `vertexiaRegistrationIdentity`, `vertexiaRegisteredBusiness`, `vertexia_web_device_identity` (`src/services/cloudLicensing.ts`). | Lease works offline till expiry; activate/refresh needs Internet |
| **UI Preferences & Retry Keys** | Browser `localStorage` / `sessionStorage` | `vertexia.pending-operation.*` (`useOperationIdentity.ts`), `vertexia_read_notifications_v1`, `vertexia_sidebar_locked`, `vertexia_app_zoom`, `sessionStorage: vertexia_return_bill` | Yes |
| **IndexedDB / Offline Write Queue** | — | **Not found.** LAN browser offline hone par error `503 NetworkError` aata hai (`src/services/apiClient.ts`). | No |
| **Cloud Business Sync** | — | **Not found.** Sales, products, customers ya ledger kisi cloud DB mein sync nahi hote. | N/A |

### C. Settings / Config (Owner Kya Configure Kar Sakta Hai?)
- **`SettingsPage.tsx` (lines 1–27):** Sirf **Backup & Restore** mojood hai (`Create backup`, `Select backup to restore`, `Save copy`).
- **Missing Settings ("not found"):** Shop name/address/phone receipt header, receipt footer, thermal paper size (58mm/80mm), GST/tax %, tax-inclusive/exclusive toggle, rounding rule (nearest Rs 1/5/10), default currency (`PKR` schema mein hardcoded hai), cashier max discount %, credit limit default, ya negative stock allow/block toggle **kahin configure karne ka option nahi hai**.
- **Fake/Non-Saved Product Toggles (`ProductsPage.tsx:442-447, 855-920`):** Product form mein `GST / Sales Tax Rate (%)`, `Shelf / Storage Location`, `Batch & Expiry Tracking`, aur `Allow POS Cashier Discount` UI par hain lekin `save()` (`454-459`) inhein DB mein bhejta hi nahi — save karte hi gayab ho jaate hain.

---

## 3. Workflow Documentation (All 18 Workflows A to Z)

### Workflow 1: Login, User Roles, Session
- **Trigger:** App start ya Logout ke baad `LoginPage.tsx` (`Sign In` submit) / pehli dafa `RegisterPage.tsx`.
- **Step-by-step Flow:**
  1. **UI (`LoginPage.tsx:30-68`):** Username/password validate karta hai -> `window.vertexia.auth.login()`. Agar login fail ho aur `localStorage` mein `vertexiaRegisteredBusiness` para ho toh auto-heal loop chalta hai (`window.vertexia.auth.setup(..., { force: true })` — **dangerous!**).
  2. **Handler:** Desktop IPC `auth:login` -> `AuthRepository.login()` (`electron/database/auth.mts`). Web: `POST /api/auth/login` (`server/routes/auth.mts:26`) -> `Set-Cookie: vertexia_session`.
  3. **DB Reads/Writes:** `user_credentials` & `login_throttle` check (5 galat tries par user 15 min lock; 20 par IP lock). Scrypt password verify (`N=131072`). `desktopSession` ya server `Map` mein token save.
  4. **Startup Backdoor (`electron/main.mts:551-560`):** Agar Owner ka username `'taha'` ho toh har startup par DB mein business aur owner ko overwrite karke `'jameel'` bana deta hai!
- **Failure Handling:** PC band ya server restart hone par RAM session urr jata hai (`login_throttle` SQLite mein bachti hai). OS sleep/lock screen par auto-logout hota hai (`powerMonitor` in `electron/main.mts`).
- **Permissions:** 4 fixed roles (`src/shared/auth-policy.ts:4-9`): `Owner`, `Manager`, `Cashier`, `Inventory` + custom `users.allowed_tabs`. **Bug:** Web `/api/auth/status` (`server/routes/auth.mts:78-93`) refresh par `allowedTabs` wapas nahi bhejta.
- **Audit:** `login_throttle` update hota hai; `audit_events` par login event likha jata hai (`auth.mts`).

```
Login Form -> Throttle Check (user_credentials/login_throttle) -> Scrypt Verify
   |-- Fail -> failed_attempts++ (Lock 15m after 5)
   '-- Pass -> Session in RAM (+ Cookie on Web) -> Load Branch & Role Permissions
```

---

### Workflow 2: Shift / Day Opening & Closing
- **Trigger:** `POS` par `"Open Shift"` dialog (`PosDialogs.tsx:42-75`) ya `Cash & Shifts` page (`CashShiftsPage.tsx`).
- **Step-by-step Flow:**
  1. **Open:** User opening cash dalta hai -> `usePos.openShift()` (`usePos.ts:310-322`) `shiftOperation.idFor()` generate karta hai -> `pos:open-shift` / `POST /api/pos/open-shift` -> `VertexiaDatabase.openPosShift()` (`database.mts:547-573`).
  2. **Validation:** Check hota hai ke pichle din ka purana shift open toh nahi (`date(opened_at, '+5 hours') < today` -> manager force-close maangta hai). Ek cashier aur ek counter (`idx_cash_shifts_one_open`, `idx_cash_shifts_one_open_counter`) par sirf 1 open shift allowed hai.
  3. **Close (Blind):** `CashShiftsPage` se `countedCashPaisa` aur `note` jata hai -> `CashRepository.close()` (`cash.mts:58-83`).
  4. **Move / Force-Close:** `CashRepository.move()` (`cash.mts:84-109`) cash in/out likhta hai; `forceClose()` (`cash.mts:110-132`) sirf Owner/Manager kar sakta hai.
- **Tables Read/Written:** `cash_shifts` (insert/update `status='closed'`), `cash_transactions` (`opening_cash`, `cash_in`, `withdrawal`), `cash_shift_closings`, `cash_movement_notes`, `audit_events`.
- **Calculations:** `expected_cash = SUM(CASE WHEN direction='in' THEN amount_paisa ELSE -amount_paisa END)`. `variance_paisa = counted_cash_paisa - expected_cash_paisa` (SQLite `CHECK` constraint). Agar `variance !== 0` toh minimum 3-char `note` zaroori. **Risk:** `forceClose()` mein `counted = expected` aur `variance = 0` hardcoded hai (`cash.mts:127`), yani actual short/excess chhup jata hai!
- **Failure Handling:** `postOperation()` idempotent hai (`shift.open`, `shift.close`, `cash.move`, `shift.force_close`). Crash par half-close nahi hota.
- **Permissions:** `shifts.open`, `shifts.close`, `cash.manage`. Cashier sirf apna shift close kar sakta hai; Manager/Owner kisi ka bhi ya force-close.
- **Audit:** Har action `audit_events` (`Shift` / `Cash`) mein log hota hai.

```
Open Shift (openingCashPaisa) -> Check stale/open shift & counter -> cash_shifts + cash_transactions('opening_cash')
Close Shift (countedCash) -> Calc expected & variance -> Require note if variance!=0 -> cash_shift_closings
Force Close (Manager) -> Forces counted=expected (variance=0) [RISK]
```

---

### Workflow 3: Product Creation / Edit
- **Trigger:** `ProductsPage.tsx` (`Add Product` / `Edit` modal) ya POS par `+ Add Custom Product` (`PosDialogs.tsx:77-120`).
- **Step-by-step Flow:** `ProductFormModal.save()` -> `products:save` / `POST /api/products/save` -> `VertexiaDatabase.saveProduct()` (`database.mts:667-695`) ya `createPosProduct()` (`575-601`).
- **Validation (`normalizeProductInput`, `database.mts:617-636`):** Name <=120 chars, `sellingPricePaisa > 0`, `mrp >= sellingPrice` (agar mrp > 0 ho), `imageDataUrl <= 2.8MB`, SKU auto-generate (`PRD-...` ya `CUSTOM-...`). Trim ke baad duplicate `sku` ya `barcode` par DB unique error throw hota hai.
- **Tables Read/Written:** `products` (insert/update), `branches` (read). Naye product par: `stock_levels` (opening stock selected branch mein, baqi active branches mein `0` via `openingStockValue()`), `stock_movements` (`opening_stock`), `stock_values` & `stock_value_movements`, `audit_events`.
- **Calculations:** Frontend rupees/qty ko `* 100` (paisa) aur `* 1000` (milli) mein convert karta hai. `ProductsPage` mein `taxRate`, `trackExpiry`, `allowDiscount`, `scaleProduct`, `storageShelf` fields DB mein **nahi jate** (`ProductsPage.tsx:442-459`).
- **Failure Handling:** `BEGIN IMMEDIATE ... COMMIT/ROLLBACK`. Transaction fail ho toh product/stock kuch save nahi hota. **Exception:** `saveProduct` aur `createPosProduct` `postOperation` use nahi karte — fast double click par (bina barcode/custom SKU ke) 2 duplicate named products ban sakte hain agar UI `busy` bypass ho.
- **Permissions:** `products.manage` (`Owner`, `Manager`, `Inventory`).
- **Audit:** `audit_events` (`Product created` / `Product updated`).

```
Product Form -> normalizeProductInput (ignores tax/expiry UI state) -> BEGIN IMMEDIATE
   |-- New -> INSERT products + stock_levels + stock_movements + openingStockValue + audit_events
   '-- Edit -> UPDATE products (prices/name/status) + audit_events (old bills untouched)
```

---

### Workflow 4: Billing Flow (A to Z)
- **Trigger:** POS screen (`PosWorkspace.tsx` + `usePos.ts`) par barcode scan/product click -> Cart -> `Complete Bill` button (`openBillPreview`) -> Bill Preview modal mein `Complete Bill` (`confirmCompleteSale`).
- **Step-by-step Flow:**
  1. **Scan/Search:** `BarcodeScannerModal.tsx` (keyboard input + AudioContext beep) ya search input se barcode/SKU/name match. Loaded from `pos:get-bootstrap` (saare active products ek sath RAM mein).
  2. **Cart & Qty/Weight:** `addProduct()` `+1000` milli (`1` unit) add karta hai; `setQuantity()` qty update karta hai (`1` to `product.quantityMilli` limit). Same product 2 dafa scan hone par ek hi line ki qty barhti hai (backend mein duplicate `productId` lines blocked hain `database.mts:418`).
  3. **Discount & Customer:** Item-level discount `0%–100%` (`discountBasisPoints`) ya Quick Discount sab lines par same % (`PosDialogs.tsx:263-298`). Customer dropdown se select ya inline name/phone type.
  4. **Bill Preview (`usePos.ts:199-236` & `PosDialogs.tsx:320-433`):** `"Not Saved Yet"` preview dikhata hai (`Close`, `Print`, `Complete Bill`). Yahan tak DB aur stock ko haath nahi lagta. **Risk:** Cashier `Print` dabakar kacha/fake print customer ko dekar `Close` kar sakta hai bina bill save kiye!
  5. **Save (`confirmCompleteSale`, `usePos.ts:244-269` -> `completePosSale`, `database.mts:436-515`):**
     - `postOperation('sale.post')` start.
     - Active shift verify (cashier ka apna `open` shift).
     - Agar Walk-in selected ho par `customerName` type kiya ho toh phone/name se match karta hai ya naya customer INSERT karta hai!
     - `priceLines()` live DB se `selling_price_paisa` aur `stockCost()` se weighted-average cost leta hai. Stock check (`quantity_milli >= line.quantityMilli`).
     - Invoice number `BILL-001` (`nextDocumentNumber`).
     - Inserts `sales`, `sale_items`, `sale_item_costs`, `stock_levels` minus, `stock_movements` (`sale`), `stock_values` minus, `sale_payments` (1 row), `cash_transactions` (agar Cash) ya `customer_ledger` (agar Udhaar), `audit_events`.
- **Calculations:**
  - `lineSubtotal = Math.round((sellingPricePaisa * quantityMilli) / 1000)`
  - `lineDiscount = Math.round((lineSubtotal * discountBasisPoints) / 10_000)`
  - `lineTotal = lineSubtotal - lineDiscount`
  - **Tax = 0** (tax calculation **not found**). **Rounding = nearest 1 paisa** (nearest Rs 1/5 shop rounding **not found**).
  - **Profit (COGS):** `costPaisa` via `stockCost()` (`proportionalCost(total_cost_paisa, qtyMilli, stockMilli)`).
- **Failure Handling:** Complete transaction `BEGIN IMMEDIATE` mein hai + `useOperationIdentity` client retry ID `localStorage` mein rakhta hai (`operation_results` mein match hone par duplicate bill nahi banta). Power cut agar `COMMIT` se pehle ho toh sale + stock kuch save nahi hota; agar `COMMIT` ke baad receipt print se pehle ho toh sale, bill number aur stock 100% safe saved rehte hain (bas print dubara `Sales History` se karna parega).
- **Permissions:** `pos.sell` (discount ke liye UI check `pos.discount` — backend check karta hai `pos.sell` aur discount bounds `0..10000`, `ipc-policy` / route handler par depend).
- **Audit:** `audit_events` (`Sale completed`) + `stock_movements` + `cash_transactions` / `customer_ledger`.

```
Scan/Select -> Cart (Qty in milli, Discount %) -> [Preview Modal: Print/Close/Complete]
   '-- Click "Complete Bill" -> postOperation('sale.post') BEGIN IMMEDIATE:
       Check Open Shift -> Resolve Customer -> priceLines() (Live Price + Avg Cost)
       -> Check & Deduct stock_levels & stock_values
       -> INSERT sales (BILL-xxx), sale_items, sale_payments
       -> Cash? -> cash_transactions | Udhaar? -> customer_ledger
       -> audit_events -> COMMIT
```

---

### Workflow 5: Hold / Resume Bill & Cancel Bill
- **Trigger:** POS bottom buttons `Hold Sale` / `Held Sales` (`PosWorkspace.tsx:100`) & `Clear Cart` (`87-89`).
- **Step-by-step Flow:**
  - **Hold:** `usePos.holdSale()` -> `pos:hold-sale` -> `holdPosSale()` (`database.mts:517-525`): `held_sales` table mein `cart_json`, `customer_id`, `total_paisa` save hota hai (no stock deduction, no `paymentMethod` saved, unsaved typed `draftCustomerName` drop ho jata hai agar save na kiya ho).
  - **Resume:** `resumePosSale()` (`database.mts:527-541`): `BEGIN IMMEDIATE` mein `held_sales` row parhta hai, live catalog prices par `priceLines()` validate karta hai (agar tab tak price barh/kam gayi ho ya stock khatam ho toh resume FAIL error de deta hai!), aur **foran `DELETE FROM held_sales WHERE id=?` kar deta hai**!
  - **Cancel/Clear Cart:** Sirf browser `window.confirm(...)` ke baad React `cart` state empty (`usePos.clearCart()`). Audit log nahi hota (lekin held sale delete karne par `deleteHeldPosSale()` bina kisi confirmation ya audit ke row delete kar deta hai `database.mts:543-545`).
- **Risk:** Bijli jaye ya browser crash ho `Resume` click karne ke foran baad aur `Complete Bill` se pehle -> held bill DB se pehle hi delete ho chuka hota hai, data hamesha ke liye gaya!
- **Permissions:** `pos.sell`.
- **Audit:** Hold/Resume/Delete par `audit_events` row **not found**.

```
Hold -> INSERT held_sales (no stock lock)
Resume -> Re-check live price & stock (fails if 0 stock!) -> DELETE FROM held_sales -> Load in React Cart [LOSS RISK]
```

---

### Workflow 6: Payment Handling (Cash, Card, Wallet, Split, Change)
- **Trigger:** POS right panel payment selector (`PosWorkspace.tsx`) -> `cashReceived` input -> `Complete Bill`.
- **Supported Methods (`database.mts:438`):** `'Cash'`, `'Card'`, `'JazzCash'`, `'Easypaisa'`, `'Udhaar'`.
- **Split Payment:** **Not found.** Ek sale ke liye `sale_payments` mein sirf 1 method ja sakta hai (`completePosSale:508`). Customer aadha Cash aur aadha Udhaar ya aadha JazzCash nahi de sakta.
- **Calculations:**
  - Agar `paymentMethod === 'Cash'`: `effectiveCashReceivedPaisa = typed ? typedCashPaisa : totalPaisa` (`usePos.ts:95`). Agar typed cash < total ho toh error. `changePaisa = Math.max(0, cashReceivedPaisa - totalPaisa)`.
  - `cash_transactions` mein `totalPaisa` (`amount` NOT `cashReceived` minus change — drawer mein sirf net bill cash jati hai, jo sahi hai).
  - Card / JazzCash / Easypaisa: `paidAmount = totalPaisa` (`sale_payments`), drawer cash (`cash_transactions`) mein **nahi** jata (jo sahi hai), lekin koi bank/wallet settlement account ya transaction ID (`TID`) field **not found** POS sale par!
- **Permissions & Audit:** `pos.sell`; `sale_payments` + `cash_transactions`.

```
Select 1 Method (Cash/Card/JazzCash/Easypaisa/Udhaar) [No Split]
   |-- Cash -> Check cashReceived >= total -> Change = cashReceived - total -> cash_transactions (+total)
   '-- Card/Wallet -> Record paidAmount = total in sale_payments (No TID field)
```

---

### Workflow 7: Udhaar / Credit Sale & Later Payment Receiving (Customer Ledger)
- **Trigger:** Udhaar sale at POS (`paymentMethod='Udhaar'`) + Collection on `CustomersPage.tsx` (`Collect Payment`).
- **Step-by-step Flow:**
  1. **Udhaar Sale:** Walk-in customer block hai (`Number(customer.is_walk_in) === 1` throw error `database.mts:478`). `sale_payments` mein `amount_paisa = 0` likha jata hai (`507-508`), aur `customer_ledger` mein `entry_type='sale'`, `debit_paisa = totalPaisa`, `credit_paisa = 0` (`509`).
  2. **Customer Create/Opening:** `CustomersPage` -> `AccountsRepository.createCustomer()` (`accounts.mts`) optional opening balance ke sath (`entry_type='opening_balance'`).
  3. **Collection (`accounts.mts:133-151`):** `customers:collect` / `POST /api/customers/collect` -> `postOperation('customer.collect')`. Balance check: **`if (amount > balance) throw` (`143`)** (yani advance jama / overpayment blocked hai!). `customer_receipts` (`RCP-...`) banta hai, `customer_ledger` mein `credit_paisa = amount`, aur agar method `'Cash'` ho toh `cash_transactions` (`customer_payment`, `in`, active open shift required) likha jata hai.
- **Credit Limit:** **Not found.** Customer par koi credit limit field ya block nahi hai — Rs 500 ke bharosay wale gahak ko Rs 50,000 ka udhaar bina warning ho sakta hai.
- **Permissions:** `customers.create`, `customers.read`, `customers.manage`, `customers.collect` (Cashier ke paas `collect` permission hai!).
- **Audit:** `audit_events` (`Customer Payment`) + immutable `customer_ledger` + `customer_receipts`.

```
Udhaar Sale (Walk-in blocked, No Credit Limit) -> sale_payments(0) + customer_ledger(debit)
Later Collect Payment -> Check amount <= balance (Overpay blocked!) -> customer_receipts + customer_ledger(credit) + Cash? drawer IN
```

---

### Workflow 8: Return / Exchange / Refund
- **Trigger:** `SalesPage.tsx` (InvoiceModal -> Return Items), `SalesHistoryPage.tsx` (redirects via `sessionStorage`), aur `ReturnsPage.tsx` (Mode 1: Return with Bill #, Mode 2: Manual Return No Bill).
- **Two Separate Flows:**
  1. **With Bill (`createSalesReturn`, `database.mts:870-923`):**
     - Reason optional (`<= 250`). `postOperation('sale.return')`.
     - Returnable qty check (`sold - already_returned`).
     - Refund calculation **original bill ke proportional price par** hoti hai: `proportionalCost(line_total_paisa, cumulativeQty, soldQty) - previously_refunded` (`893-898`). Is tarah original discount bhi adjust hota hai aur agar last piece wapas aaye toh poore bache paise exact match karte hain.
     - Cost restoration (`stock_values`) original `sale_item_costs.total_cost_paisa` se hoti hai.
     - Refund method zyadatar **original sale ke payment method par locked** hai (`877, 913`) — agar original bill Cash tha toh open shift lazmi aur cash drawer se refund kat-ta hai; agar Udhaar tha toh `customer_ledger` credit hota hai.
  2. **Without Bill / Manual Return (`createManualReturn`, `database.mts:943-1041`):**
     - `MRET-001+` number. User khud product, qty, **`unitPricePaisa`**, aur **`refundMethod`** (`Cash`, `Card`, `JazzCash`, `Easypaisa`, `Udhaar`) type/select karta hai!
     - **Severe Risk:** System na yeh check karta hai ke customer ne yeh item kabhi kharida bhi tha ya nahi, na hi sale price se compare karta hai! Cost restoration `products.purchase_price_paisa` se `estimated=1` par karta hai.
- **Exchange Flow:** Direct swap/exchange ("replace size/flavor on same bill") **not found** — pehle return banana parega phir naya sale.
- **Permissions:** `sales.return` (Owner & Manager ko by default hai; Cashier ko nahi unless custom `allowedTabs` mein `Returns` diya jaye — par tab API `rolePermissions` reject kar degi!).
- **Audit:** `sale_returns` / `manual_returns` + `stock_movements` + `cash_transactions` / `customer_ledger` + `audit_events`.

```
Mode 1 (Bill #) -> Validate remaining qty -> Calc refund from original line_total & cost -> Stock + / Drawer or Udhaar -
Mode 2 (Manual) -> User enters ANY price & method [RISK] -> MRET-xxx -> Stock + (estimated cost) / Refund OUT
```

---

### Workflow 9: Bill Edit / Delete / Void After Saving
- **Status:** **Not found.**
- **Details:** Code mein `sales.status` column aur `ReportsRepository` mein `'voided'` check mojood hai (`schema.mts`, `reports.mts:10`), aur `SalesPage` status filter mein `'voided'` option hai, **magar kisi bhi file (UI, IPC, route, ya database class) mein completed bill ko edit, void ya delete karne ka koi function ya button nahi hai.**
- **Side-effect:** Galti se ghalat item/payment method (Cash ki jagah Card/Udhaar) select ho kar bill complete ho jaye toh cashier ko poora **Return** dalna parta hai aur dubara naya bill banana parta hai (jo sales return stats ko barha deta hai).

```
Completed Sale -> [No Edit / Void / Delete Endpoint Found] -> Workaround: Post Return + New Sale
```

---

### Workflow 10: Purchase Entry (Stock In) & Supplier Payments
- **Trigger:** `PurchasesPage.tsx` (`New Purchase` modal -> `RetailDataProvider.receivePurchase`) aur `SuppliersPage.tsx` (`Pay Supplier` / `Add Supplier`).
- **Step-by-step Flow (`RetailRepository`, `electron/database/retail.mts:82-200`):**
  1. **Receive Purchase (`receivePurchase`, `82-140`):** `postOperation('purchase.receive')`. Check karta hai duplicate `(business_id, supplier_id, supplier_invoice_number)` na ho. `PUR-YYYYMMDD-0001`.
  2. `purchases` & `purchase_items` insert. `stock_levels` increase, `stock_movements` (`purchase`), `changeStockValue(..., line.total, false)` (exact purchase total stock value mein add), aur `products.purchase_price_paisa = line.cost` reference update.
  3. `supplier_ledger` mein `debit_paisa = total`. Agar `paidAmountPaisa > 0`: `supplier_payments`, `supplier_ledger` credit, `supplier_payment_allocations`, aur Cash ho toh open shift drawer se out (`cash_transactions`).
  4. **Pay Supplier (`paySupplier`, `171-199`):** `due = this.outstanding()` (SUM of `supplier_ledger`), FIFO basis par unpaid `purchases` par allocate karta hai.
- **CRITICAL BUG (`retail.mts:41, 163, 227`):** `createSupplier()` ke zariye dala gaya `supplier_profiles.opening_balance_paisa` UI table (`getSnapshot` line `227`) mein total due mein jorta hai, **lekin `supplier_ledger` mein nahi dalta!** Nateeja: `paySupplier()` jab `outstanding()` (`41-43`) check karta hai toh woh purana udhaar due nahi manta aur owner supplier ko opening balance pay hi nahi kar sakta (`Payment cannot exceed supplier outstanding`)!
- **Permissions:** `purchases.receive`, `suppliers.pay`.

```
Receive Purchase -> Check dup supplier invoice -> PUR-xxx -> stock_levels + & stock_values + (Weighted Avg)
   -> supplier_ledger (debit) -> Paid > 0? -> supplier_payments + FIFO allocations + Cash? drawer OUT
Pay Supplier -> Checks supplier_ledger only (Ignores supplier_profiles.opening_balance_paisa! [BUG])
```

---

### Workflow 11: Stock Adjustment, Damage / Wastage, Stock Count
- **Trigger:** `InventoryPage.tsx` (`Stock Adjustment` modal).
- **Step-by-step Flow (`RetailRepository.adjustStock`, `retail.mts:58-80`):**
  - `postOperation('stock.adjust')`. Non-zero `quantityDeltaMilli`, mandatory `reason`.
  - Block if `balance < 0` (`Adjustment cannot reduce stock below zero`).
  - Agar stock kam ho (`< 0`): weighted-average `stockCost()` se exact cost deduct (`estimated=0` ya existing basis).
  - Agar stock barhe (`> 0`): current average cost (ya agar stock `0` tha toh `products.purchase_price_paisa`) se cost add aur `estimated=1` flag lag jata hai.
- **Missing:** Dedicated **Damage / Wastage / Expired Write-off** classification ya **Physical Stock Count / Audit Sheet reconciliation** workflow **not found** — sab generic `adjustment_increase`/`adjustment_decrease` mein jata hai.
- **Permissions:** `stock.adjust` (`Owner`, `Manager`, `Inventory`).

```
Adjust Modal (qty != 0, reason) -> Check new balance >= 0 -> stock_levels +/- -> stock_movements -> stock_values (+/-, inc marked estimated=1)
```

---

### Workflow 12: Price Change Impact
- **Trigger:** `ProductsPage` -> Edit Product -> change `sellingPriceRupees` / `purchasePriceRupees` -> `saveProduct()`.
- **Kya Asar Hota Hai?**
  - **Old Bills (`sales`, `sale_items`):** **Koi asar nahi.** `sale_items` mein `unit_price_paisa`, `unit_cost_paisa`, aur `line_total_paisa` snapshot saved hote hain. Returns purane bill price par hi hote hain (`database.mts:894-895`).
  - **Held Bills (`held_sales`):** `cart_json` mein sirf `productId`, `quantityMilli`, `discountBasisPoints` saved hai — jab cashier `Resume` dabata hai toh `resumePosSale()` aur `usePos.resumeSale()` **NAYI live price** lagate hain (`database.mts:533`, `usePos.ts:287`). Customer ko agar purane rate par hold bill diya tha toh rate badal jayega!
  - **Open Carts (Other Devices/Tabs):** `completePosSale()` server par hamesha live DB price (`priceLines`, `database.mts:422-427`) se total calculate karta hai — yani UI par purana price dikhne ke bawajood save hotay waqt naya price lag sakta hai (jab tak WebSocket `RETAIL_DATA_CHANGED` reload na kare)!
  - **Stock Valuation (`stock_values`):** Product edit se `purchase_price_paisa` change karne par **stock inventory value (`stock_values.total_cost_paisa`) update NAHI hoti** — woh asal purchases aur opening stock ke weighted average par chalti hai (accounting ke hisaab se sahi hai).

```
Edit Product Price -> UPDATE products only
   |-- Old Bills -> Safe (snapshot prices kept)
   |-- Stock Value -> Safe (weighted avg unchanged)
   '-- Held / Active Carts -> Pick NEW live DB price on Resume/Checkout
```

---

### Workflow 13: Expense Entry
- **Trigger:** `ExpensesPage.tsx` (`Add Expense` / `Reverse Expense`).
- **Step-by-step Flow (`AccountsRepository.postExpense`, `accounts.mts:191-224`):**
  - `postOperation('expense.post')`. Future date blocked (`date > retailBusinessDate` throws error).
  - `EXP-YYYYMMDD-0001` generated in `account_document_sequences`.
  - Inserts into `expenses` + `expense_postings`. Agar `method === 'Cash'`, open shift aur sufficient drawer cash check karke `cash_transactions` (`out`) likhta hai!
  - Reversal (`reverseExpense`): existing expense ko delete nahi karta balke aaj ki date par `expense_reversals` aur drawer mein `cash_transactions` (`in`, `expense_reversal`) add karta hai.
- **CRITICAL UI BUGS (`ExpensesPage.tsx:97-109, 163`):**
  1. Jab DB khali/loading ho ya value `0` ho: `todayExpensesPaisa` fallback **`|| 320000` (Rs 3,200)** aur `highestCategory` **`Rent (Rs 60,000, 32%)`** aur `totalExpensesPaisa` **`18675000` (Rs 186,750)** fake dummy data dikhate hain!
  2. `<DateRangeFilter />` line `163` par bina `onChange` prop ke laga hai — yani filter select karne se **koi filter apply nahi hota!**
- **Permissions:** `expenses.read`, `expenses.manage`.

```
Add Expense -> Check date <= today & Cash <= drawer -> INSERT expenses + expense_postings -> Cash? drawer OUT
Reverse Expense -> INSERT expense_reversals -> Cash? drawer IN
[UI Bug: Shows fake Rs 3,200 / Rent 32% fallbacks & DateRangeFilter ignores onChange]
```

---

### Workflow 14: Reports (Sales, Profit, Stock, Ledger)
- **Backend Calculation (`ReportsRepository`, `electron/database/reports.mts:8-121`):**
  - **Net Sales:** `SUM(sales.total_paisa WHERE status != 'voided') - SUM(sale_returns.total_paisa) - SUM(manual_returns.total_paisa)`.
  - **COGS (`costPaisa`):** `SUM(sales.cost_paisa) - SUM(sale_returns.cost_paisa) - SUM(manual_returns.cost_paisa)` (weighted average).
  - **Gross Profit:** `netSalesPaisa - costPaisa`.
  - **Expenses:** `SUM(expenseFacts.amount_paisa)` (`expenses - expense_reversals`).
  - **Operating Profit:** `grossProfitPaisa - expensesPaisa`.
  - **Stock Valuation:** `SUM(stock_values.total_cost_paisa)` + dispatched `stock_transfer_items.cost_paisa`.
- **MASSIVE UI DEFECT (`ReportsPage.tsx:38-52, 87-92, 287-750`):**
  - Top 4 KPI cards (`summary?.salesPaisa ?? 248560000`, etc.) agar data null ho toh fake Rs 2.48M numbers dikhate hain.
  - **Niche ke SAARE charts aur tables (`Sales Trend` SVG, `Sales by Category`, `Top Selling Products` e.g. Coca Cola 842 qty, `Payment Method Breakdown`, `Sales by Staff` e.g. Ali Raza/Sana Khan, `Recent Sales` `SAL-2026-1258`, Summary `Total Cost of Goods Rs. 1,843,300` / `1,258 invoices` / `8,645 items` / `36 customers`) 100% HARDCODED STATIC MOCK DATA hain!**
  - Tabs (`Inventory`, `Customers`, `Profit & Loss`, `Staff`, `Tax Report`) click karne par section reload zaroor hota hai par UI body **wahi static dummy HTML** dikhati hai! Tax Report mein **0 tax logic** hai. Sirf CSV export (`reports:export-csv`) real `ReportsRepository` table dump karta hai.

```
ReportsPage UI -> Top 4 KPIs + CSV Export read ReportsRepository (Real SQL)
               -> All Charts, Staff, Top Products, Recent Sales & Bottom Summary = STATIC MOCK DATA [BUG]
```

---

### Workflow 15: Receipt / Invoice Generation & Numbering
- **Trigger:** `completePosSale()` (`database.mts:492`), `createSalesReturn()` (`912`), `createManualReturn()` (`1014`), `receivePurchase()` (`retail.mts:119`).
- **Numbering Logic (`electron/database/posting.mts:38-79`):**
  - **Sale Invoice (`BILL-001`, `BILL-002`...):** `document_sequences` (`kind='sale', business_date='GLOBAL'`) se `UPDATE ... RETURNING last_value` atomic transaction ke andar nikalta hai. Safe from duplicates! Reset **nahi** hota (purane `sales` table mein `maxExisting` bhi check karta hai). **Performance Flaw:** Har ek sale ke waqt poora `SELECT invoice_number FROM sales WHERE branch_id=?` loop karta hai!
  - **Bill Return:** `RET-YYYYMMDD-0001`.
  - **Manual Return:** `MRET-001` (same full-table scan bug).
  - **Purchase:** `PUR-YYYYMMDD-0001`.
  - **Printing:** Thermal ESC/POS direct driver ya raw USB/serial printer support **not found** — sirf browser/Electron `window.print()` dialog (`PosDialogs.tsx:418`, `SalesPage.tsx:71`, `SalesHistoryPage.tsx:137`) use hota hai.
  - **Bug (`SalesPage.tsx` vs `PosDialogs`):** Pre-save preview mein Print dabanay par bina invoice number ke `"Pending Confirmation"` slip print hoti hai, aur `Complete Bill` dabane par modal foran band (`setReceipt(null)`, `usePos.ts:264`) ho jata hai! Cashier ko final receipt print karne ke liye dubara `Sales History` ya `Sales` tab kholna parta hai!

```
Sale Save -> Scan ALL sales rows (slow at scale) -> UPDATE document_sequences('GLOBAL') -> BILL-xxx
Print Flow -> Preview lets user print BEFORE saving | Saving closes modal without auto-printing final receipt
```

---

### Workflow 16: Backup / Restore, Data Import / Export
- **Desktop Backup (`electron/backup.mts:1-224`):**
  - **Auto-Backup:** Har 15 min timer check karta hai (`electron/main.mts`) aur rozana 1 automatic SQLite online-backup snapshot (`vertexia-automatic-<uuid>.sqlite` + `.json` metadata) banata hai (`backup.mts:110-116`). Retention: latest 100 list hote hain (`status()` line `83`), disk cleanup khud karni hoti hai.
  - **Validation:** `inspectBackup()` (`32-58`) `PRAGMA integrity_check`, `PRAGMA foreign_key_check`, reference schema match, cross-business consistency check aur owner existence verify karta hai.
  - **Restore (`184-223`):** Open shifts block karta hai, current owner password + backup owner username/password + `"RESTORE"` confirmation leta hai, pehle `before_restore` safety copy banata hai, phir replace karta hai. **Note:** Backup files unencrypted hain (`SettingsPage.tsx:23`).
- **Web/LAN Backup (`server/routes/system.mts:77-98`, `browserAdapter.ts:114-121`):** **FAKE STUBS!** `/api/backup/create` `sizeBytes: 0` wapas karta hai aur koi file banata hi nahi!
- **Import (`database.mts:735-759`):** Products CSV import (`name,category,unit,sale_price,opening_stock` required). Duplicate SKU/barcode DB mein hone par poora import rollback ho jata hai.
- **Export:** Backend mein CSV endpoints hain (max 100k rows, formula injection escaped `^[=+\-@]`); Frontend buttons zyadatar client-side `.xls` HTML download aur printable HTML PDF (`src/shared/utils/exportUtils.ts`) chalate hain — jo sirf current loaded rows/page export karte hain (paginated tables mein poora data missing ho sakta hai!).

```
Desktop Backup -> Online sqlite backup() + SHA-256 + integrity_check -> Local unencrypted .sqlite
Web/LAN Backup -> Fake stub returns sizeBytes:0 [BUG]
Frontend Excel -> Exports only currently loaded UI page rows (incomplete on paginated lists)
```

---

### Workflow 17: Sync (Offline Queue, Conflict Resolution, Duplicates)
- **Cloud Sync:** **Not found.** Koi multi-branch cloud sync engine ya internet offline queue mojood nahi hai.
- **Local LAN Realtime Sync (`server/websocket.mts`, `src/services/browserAdapter.ts:27-54`):**
  - Browser clients WebSocket se jude hote hain (`ws://host:8080`, 3s reconnect). Jab koi client sale/stock/cash change karta hai toh Fastify server baqi sab clients ko event (`sale:completed`, `inventory:changed`) bhejta hai taake unke screens refresh ho jayein.
  - **Offline Behavior on LAN:** Agar Wi-Fi band ho jaye toh LAN client par **koi IndexedDB offline queue nahi hai** — bill save nahi hoga (`apiClient.ts`).
  - **Duplicate Prevention:** `useOperationIdentity` (`localStorage` + `crypto.randomUUID()`) aur `postOperation()` (`operation_results` table SHA-256 request hash check) **bahut mazboot** hai — network timeout par retry karne se duplicate sale ya double stock deduction nahi hoti (`posting.mts:14-35`).

```
Client Action + operationId -> HTTP POST /api/* -> SQLite BEGIN IMMEDIATE (operation_results hash check)
   '-- COMMIT -> WebSocket Broadcast -> Connected LAN Clients re-fetch via HTTP (No IndexedDB queue if offline)
```

---

### Workflow 18: Multi-User Behavior (Two Cashiers Selling Same Item)
- **Desktop Electron:** Single user desktop par ek waqt mein kaam karta hai.
- **LAN Server Mode (Multiple Cashiers on Browsers):**
  - Har cashier apna separate session (`user_credentials`) aur apna separate shift (`idx_cash_shifts_one_open` + `counter_id`) kholta hai.
  - Agar Counter 1 aur Counter 2 aakhri 1 bottle Pepsi ek hi waqt scan kar lein:
    1. Dono ke cart mein add ho jayegi.
    2. Counter 1 pehle `Complete Bill` dabata hai -> `BEGIN IMMEDIATE` SQLite write lock leta hai -> `UPDATE stock_levels ... WHERE quantity_milli >= line.quantityMilli` chal kar stock `0` ho jata hai -> `COMMIT`.
    3. Counter 2 millisecond baad request bhejta hai -> `priceLines()` ya `updated.changes !== 1` (`database.mts:503`) fail ho kar saaf error dega: **`"<Product> stock changed. Refresh the cart and try again."`**
    4. WebSocket event Counter 2 ki screen par reload trigger karega.
  - **Limit:** Ek hi Windows PC par Electron app aur LAN Fastify server ek sath start karne par `acquireDatabaseLock()` (`server/lock.mts`) rok deta hai. Multi-counter ke liye ek PC ko dedicated LAN server (ya headless server) chalana zaroori hai.

```
Counter 1 & 2 scan last 1 item -> Counter 1 COMMITs first (stock = 0)
Counter 2 submits -> SQLite lock -> WHERE quantity_milli >= qty fails (changes=0) -> Safe error + WebSocket reload
```

---

## 4. Real-World Stress Test (20 Pakistani Shop Scenarios)

| # | Scenario | Result | What Actually Happens in Code | Evidence (File / Function) |
| :--- | :--- | :--- | :--- | :--- |
| 1 | **Customer returns item after price changed** | ✅ | Original bill ke `sale_items.line_total_paisa` aur `sale_item_costs` se exact purana rate refund aur purani cost par stock wapas hota hai. *(Manual No-Bill Return ⚠️ dangerous hai kyunki cashier koi bhi price dal sakta hai!)* | `electron/database/database.mts`: `createSalesReturn` (L886-898), `createManualReturn` (L974-985) |
| 2 | **Power goes off mid-sale or right after payment before receipt** | ✅ | Bill preview stage mein kuch DB mein save nahi hota; jab cashier `Complete Bill` dabata hai toh poori sale `BEGIN IMMEDIATE` transaction mein commit hoti hai (`synchronous=FULL` WAL). Bijli beech mein jaye toh kuch nahi kat-ta; commit ke baad jaye toh sale, stock, cash sab 100% saved aur intact milta hai. | `electron/database/posting.mts`: `postOperation` (L14-35); `database.mts`: `completePosSale` (L440-514) |
| 3 | **Cashier presses Save twice quickly** | ✅ | UI `busyRef.current` lock karta hai + `useOperationIdentity` wahi `operationId` bhejta hai -> backend `operation_results` same request dekh kar pehla result replay karta hai. Duplicate bill ya double stock minus NAHI hota. | `src/features/pos/usePos.ts`: `run` (L182-184); `posting.mts`: `postOperation` (L20-26) |
| 4 | **Cashier deletes/edits bill after customer left** | 🟡 / ⚠️ | Bill edit/delete/void feature mojood hi **nahi** hai (theft prevented on invoice level ✅). **LEKIN** bill save hone se pehle `Bill Preview` modal par `Print` dabakar kacha bill customer ko dekar modal `Close` kiya ja sakta hai (`Chori rasta` ⚠️)! Aur cashier `Manual Return` (`MRET-`) bina receipt ke fake return dal kar paise nikal sakta hai agar manager permission mil jaye. | Bill void: **not found**; Preview Print: `PosDialogs.tsx` (L418-420); Manual return: `database.mts:943` |
| 5 | **Cashier gives huge discount or sells below cost** | ❌ / ⚠️ | Backend `0` to `10,000` basis points (100% discount, Rs 1 ya Rs 0.01 bill) tak allow karta hai! Cost price (`purchase_price` / `stockCost`) se niche bechne par **koi block ya warning not found**. Product tab ka `"Allow POS Cashier Discount"` toggle save hi nahi hota! | `database.mts`: `priceLines` (L421, 484); `ProductsPage.tsx` (L444, 457) |
| 6 | **Stock is zero in system, item physically in shop (Negative Stock)** | 🟡 | Stock `0` ya kam hone par billing **strictly blocked** hai (`Out of stock` button disabled & backend throws insufficient stock). Kiryana/mini mart mein jab supplier ka naya maal counter par aaya ho aur purchase entry abhi pending ho, toh sale ruk jati hai (negative stock allow karne ki setting nahi hai). | `PosWorkspace.tsx` (L53-54); `database.mts` (`priceLines` L424, `valuation.mts` L17) |
| 7 | **Same barcode on two products, or product without barcode** | 🟡 | **Duplicate barcode:** DB `UNIQUE(business_id, barcode)` tightly block karta hai (multi-MRP / variant barcoded packs ke liye ek hi barcode par 2 prices nahi ban saktin). **Bina barcode:** `NULL` allowed hai, auto-SKU (`PRD-...`) milta hai aur search/custom product se bik jata hai. **Minor bug:** Barcode case/leading zeros normalize nahi hote. | `electron/database/schema.mts`: `products` (`UNIQUE(business_id, barcode)`); `database.mts:621, 691` |
| 8 | **Loose items: 750g sugar, price per kg** | ✅ / 🟡 | Qty integer `milli` units (`750g` = `750` milli = `0.75`) aur rate `paisa` mein store hai: `Math.round(pricePaisa * 750 / 1000)` paisa tak bilkul sahi calculate hota hai aur weighted-avg cost `BigInt` half-up rounding karta hai. **UX Issue:** POS par `+` button seedha `+1000` (`1 kg`) add karta hai; cashier ko manually decimal `0.75` type karna parta hai, aur `"Scale Product"` UI toggle save nahi hota! | `database.mts`: `priceLines` (L427-430); `valuation.mts`: `proportionalCost` (L6-10); `usePos.ts:141, 153` |
| 9 | **Carton bought, pieces sold (Unit Conversion)** | ❌ | Multi-unit / pack-to-piece conversion (`1 Carton = 24 Pcs`) **not found**. Dukaan-daar ko purchase entry karte waqt khud calculator se total pieces aur per-piece cost nikal kar dalni parti hai — ghalat calculation par poora stock aur profit kharab ho jata hai. | Unit conversion table/logic: **not found** in `schema.mts` / `retail.mts` |
| 10 | **Tax inclusive vs exclusive pricing (GST)** | ❌ | Backend SQLite schema aur `priceLines()` / `receivePurchase()` mein **tax/GST percentage, inclusive/exclusive logic, ya FBR tax breakdown not found**. Product modal ka `GST / Sales Tax Rate (%)` dropdown aur `ReportsPage` ka `Tax Report` tab bilkul dummy/non-functional hain! | `ProductsPage.tsx` (L858-868); `ReportsPage.tsx` (L35); Tax columns: **not found** |
| 11 | **Customer pays partly cash, partly udhaar (or pays more than owed)** | ❌ | **Split payment:** **Not found** — ek bill ya toh poora Cash hoga ya poora Udhaar (`sale_payments` single row). **Overpayment:** `AccountsRepository.collect()` (`accounts.mts:143`) agar customer apne udhaar se zyada paise jama karaye toh error de kar **rok deta hai** (advance deposit / excess round-up jama nahi ho sakta). | `database.mts` (L507-509); `accounts.mts` (L143) |
| 12 | **Udhaar customer exceeds credit limit** | ❌ | Customer table (`customers`) mein koi credit limit column nahi hai, na hi `completePosSale` koi limit check karta hai. Cashier kitna bhi udhaar chahe de sakta hai. | `schema.mts`: `customers`; `database.mts:478` |
| 13 | **Cost price changes with every purchase (Costing Method & Profit)** | ✅ | System per-branch **Weighted Average Costing** (`stock_values.total_cost_paisa / stock_levels.quantity_milli`) use karta hai, aur har `sale_items` ke waqt us waqt ki actual weighted cost `sale_item_costs` mein lock hoti hai. Is wajah se profit report accounting ke hisaab se accurate aati hai. | `electron/database/valuation.mts` (`stockCost`, `changeStockValue`); `retail.mts:128` |
| 14 | **Backdated entries or system date/time changed by cashier** | 🟡 / ⚠️ | Backend local PC ki clock `new Date()` + `Asia/Karachi` offset use karta hai. Expenses par future dates blocked hain (`accounts.mts:194`), magar Purchases (`receivePurchase`) mein koi bhi purani backdate (`businessDate`) dal sakta hai. Agar Windows ki system clock cashier khud piche/aage kar de toh **koi NTP/monotonic clock check transactions par nahi laga** (monotonic check sirf license lease par hai). | `database.mts:56`; `accounts.mts:194`; `retail.mts:87` |
| 15 | **Cashier opens app on two devices** | 🟡 / ⚠️ | **LAN browser mode:** Chalta hai aur WebSocket se sync hota hai (`server/websocket.mts`). **Two Desktop installs sharing DB folder (e.g. Dropbox/shared drive):** Lock/WAL corruption khatra agar server lock ke bina access ho; ek PC par Desktop aur LAN Server ek sath nahi khul sakte (`server/lock.mts`). | `server/lock.mts`; `server/websocket.mts`; `electron/database/auth.mts` |
| 16 | **Internet drops while syncing** | ❌ | Cloud sync hai hi nahi; aur LAN Wi-Fi drop hone par browser mode mein **koi offline queue (`IndexedDB`) nahi hai** — network error aa jata hai (lekin agar server par write commit ho gaya ho aur sirf response drop ho toh `operationId` retry par duplicate nahi banta ✅). | `src/services/apiClient.ts`; `src/services/browserAdapter.ts` |
| 17 | **Database grows to 10,000+ products and 100,000+ sales** | 🟡 / ⚠️ | `products:list` paginated hai ✅. **LEKIN:** 1) `pos:get-bootstrap` **saare 10,000+ active products aur saare customers ek sath load + DOM mein render** karta hai -> POS freeze/slow ho jayega (`database.mts:395-400`, `PosWorkspace.tsx:39`). 2) Har sale par `nextDocumentNumber()` poori `sales` table scan karta hai (`posting.mts:40`) -> 100,000+ sales par har bill save hone mein latency barhti jayegi. 3) `LIKE '%term%'` leading wildcard indexes use nahi karta (`database.mts:805`). | `database.mts:395-400, 805`; `posting.mts:40` |
| 18 | **Shop owner wants to check sales from home (securely)** | ❌ | Koi cloud dashboard/mobile view **not found**. LAN server `0.0.0.0:8080` sirf **plain HTTP/WS (bina HTTPS encryption)** chalta hai (`server/server.mts:48-66`). Agar port forward kar ke ghar se khola jaye toh passwords, customer data aur backups plain text par leak ho sakte hain + `/api/backup/*` web par fake stubs hain. | `server/server.mts`; `server/routes/system.mts:77-98`; Cloud sync: **not found** |
| 19 | **Expiry products: sell nearest-expiry batch first (FEFO)** | ❌ | **Bilkul fake hai!** SQLite mein koi `batches` ya `expiry_date` table/column nahi hai. `InventoryPage` ka `ExpiryView` har product ko **`Date.now() + ((idx * 37) % 360)`** se jhooti expiry dates aur `BAT-...` batch numbers dikha raha hai! Real shop mein expired maal bik jayega! | `src/features/inventory/InventoryPage.tsx:791-814`; `schema.mts` |
| 20 | **FBR / Tax Invoice Requirements** | ❌ | Invoices uneditable hain aur sequential numbers hain (`BILL-001`) ✅, **magar FBR POS integration (POSID, USIN, FBR Fiscal Invoice Number, QR Code, 18% GST breakup, buyer NTN/CNIC)** code mein **not found**. Tier-1 retail shops ke liye legal compliance adhoori hai. | FBR / Tax invoice code: **not found** |

---

## 5. What is GOOD (Jo Sahi Bana Hai & Rakhna Chahiye)

1. **Mazboot SQLite Transactions & Crash Safety (`electron/database/database.mts`, `posting.mts`):**
   - `WAL` mode, `synchronous = FULL`, `foreign_keys = ON`, `STRICT` tables aur `BEGIN IMMEDIATE`. Pakistan mein load-shedding ke dauran data corrupt ya half-saved hone ka khatra bohat kam hai.
2. **Double-Click / Retry Protection (`useOperationIdentity.ts` + `postOperation`, `posting.mts:14-35`):**
   - Har mali transaction (`sale.post`, `sale.return`, `purchase.receive`, `customer.collect`, `expense.post`) SHA-256 request hash aur `operation_results` ke sath idempotent hai. Slow PC ya double click par do bills nahi bante.
3. **Accurate Money & Weight Math (`paisa` + `milli` + `BigInt`, `valuation.mts:6-43`):**
   - Floating point (`0.1 + 0.2 = 0.30000000004`) bugs se bachne ke liye poora backend integer `paisa` aur `1/1000` (`milli`) mein chalta hai, aur per-branch **Weighted Average Costing** sahi implement ki gayi hai.
4. **Return Integrity on Receipt Bills (`createSalesReturn`, `database.mts:886-921`):**
   - Receipt wale return mein purane bill ka exact discounted rate aur `sale_item_costs` wali historical cost wapas lagti hai, aur double return blocked hai.
5. **Immutable Expense Reversals & Ledgers (`accounts.mts:175-224`, `retail.mts:249-253`):**
   - Expenses delete nahi hotay balke reversal entry hoti hai (`expense_reversals`); `customer_ledger` aur `supplier_ledger` running balance ke sath maintain hote hain.
6. **Verified Desktop Backups & Local Auth (`electron/backup.mts`, `electron/database/auth.mts`):**
   - Scrypt (`N=131072`) password hashing, brute-force throttle SQLite mein, sleep/screen-lock par auto logout, aur backup restore se pehle `integrity_check` + safety snapshot ek behtareen engineering standard hai.

---

## 6. What is WRONG or RISKY (Problems Ranked by Severity)

### CRITICAL (Paise / Data Loss / Security Ka Khatra)

1. **Hardcoded Startup Backdoor (`"taha"` -> `"jameel"`)**
   - **Problem:** Agar Owner account ka username `taha` ho toh app start hote hi chupke se business ka naam, owner ka naam, username aur password hash overwrite karke hardcoded `jameel` password set kar deta hai!
   - **Real Shop Example:** Agar kisi dukaandaar ya staff ka naam Taha ho aur woh Owner ID banaye, agli baar PC restart hote hi uska account lock/hijack ho jayega aur password kisi aur ke hardcoded hash se badal jayega.
   - **Evidence:** `electron/main.mts:551-560`.
   - **Recommended Fix:** Lines `551-560` ko foran code se bilkul remove karein.

2. **`deleteProduct()` Purane Bills Aur Audit Records Tabah Kar Deta Hai**
   - **Problem:** Product delete karne par backend purane `sale_items`, `purchase_items`, `sale_return_items`, `stock_transfer_items`, aur `stock_movements` rows delete kar deta hai jabke parent `sales.total_paisa` aur `purchases.total_paisa` wahi rehte hain! Sath hi agar us product par kabhi Manual Return hua ho toh `manual_return_items` FK constraint ki wajah se delete crash ho jata hai.
   - **Real Shop Example:** Cashier ne pichle mahine Nestle Milk becha (Bill `BILL-010` = Rs 500). Aaj aap product delete kar dein: Bill kholne par items khali nazar aayenge magar total Rs 500 likha hoga, aur mahine ke profit/stock reconciliation mein farq aa jayega.
   - **Evidence:** `electron/database/database.mts:707-731` (`deleteProduct`); `schema.mts` (`manual_return_items` FK).
   - **Recommended Fix:** Jin products par kabhi bhi `sale_items`, `purchase_items`, `stock_movements`, ya `manual_return_items` ho chuke hon unka hard-delete **100% block** karein — sirf `is_active = 0` (`Archive / Deactivate`) allow karein.

3. **`ReportsPage.tsx`, `ExpensesPage.tsx` Aur `ExpiryView` Jhoota / Hardcoded Data Dikhate Hain**
   - **Problem:**
     - `ReportsPage.tsx` mein `Sales Trend`, `Sales by Category`, `Top Products` (`Coca Cola`), `Staff Sales` (`Ali Raza`), `Recent Sales` (`SAL-2026-1258`), aur `Summary` (`Rs 1,843,300 COGS`, `1,258 invoices`) **100% fake static strings** hain — live DB se nahi aate! `Tax Report` tab mein koi tax hai hi nahi.
     - `ExpensesPage.tsx` agar DB `0` ya loading ho toh Rs `3,200` today aur `Rent 32%` (`Rs 60,000`) fake numbers dikhata hai, aur `DateRangeFilter` ka `onChange` wired hi nahi!
     - `InventoryPage.tsx` ka `ExpiryView` random formula `45 + ((idx*37)%360)` se nakli batch aur expiry dates dikhata hai!
   - **Real Shop Example:** Dukaandaar samjhega uski sale aur profit Rs 4.5 lakh hai ya uski dawai/doodh 90 din baad expire honge, jabke asal dukaan mein saman expire ho chuka hoga ya nuksaan ho raha hoga.
   - **Evidence:** `ReportsPage.tsx:35-52, 88-91, 287-750`; `ExpensesPage.tsx:97-109, 163`; `InventoryPage.tsx:791-814`.
   - **Recommended Fix:** Saara static/fallback mock data zero karein (`?? 0`); `ReportsPage` ko real SQL `ReportsRepository` (`electron/database/reports.mts`) se jorein; `ExpensesPage` par `DateRangeFilter` `onChange` lagayein; jab tak real `product_batches` table na bane, fake `ExpiryView` hata dein ya `"Batch tracking not configured"` likhein.

4. **Supplier Opening Balance Pay Hi Nahi Ho Sakta**
   - **Problem:** Naya supplier banate waqt diya gaya `opening_balance_paisa` (`supplier_profiles`) UI table mein total `outstanding` mein jorta hai, magar `supplier_ledger` mein entry nahi banti — aur `paySupplier()` sirf `supplier_ledger` check karke payment block kar deta hai.
   - **Real Shop Example:** Mini mart wale ne pehle se Unilever ke Rs 40,000 dene hain jo usne "Add Supplier" mein opening balance likhe. Jab dene lagega toh software bolega `"Payment cannot exceed supplier outstanding"`!
   - **Evidence:** `electron/database/retail.mts:41-43` (`outstanding`) vs `163-165` (`createSupplier`) vs `227` (`getSnapshot`).
   - **Recommended Fix:** `createSupplier()` mein agar `openingBalancePaisa > 0` ho toh `supplier_ledger` mein `entry_type='opening_balance'` entry dalein (bilkul waise jaise `AccountsRepository.createCustomer` karta hai).

5. **Web / LAN Mode Mein Backups FAKE Stubs Hain**
   - **Problem:** Agar koi shop server mode (Fastify browser) se backup lene ki koshish kare toh `/api/backup/create` jhoot-moot `sizeBytes: 0` success dikhata hai jabke disk par kuch save nahi hota, aur restore/export silent `canceled` returns dete hain.
   - **Real Shop Example:** Owner browser se roz `"Create backup"` dabakar mutmain rahega aur hard disk kharab hone par saara data zero milega!
   - **Evidence:** `server/routes/system.mts:77-98`; `src/services/browserAdapter.ts:114-121`.
   - **Recommended Fix:** Web/Server routes ko real `BackupService` (`electron/backup.mts`) se connect karein ya web UI mein button disable karke Desktop host PC par backup lene ka message dikhayein.

6. **Login Auto-Heal Danger (`Register` Metadata se Overwrite)**
   - **Problem:** `LoginPage.tsx` mein galat password dalne par agar `localStorage` mein `vertexiaRegisteredBusiness` para ho toh yeh khud-ba-khud `auth.setup({ ..., force: true })` chala kar naye user/password se overwrite karne ki koshish karta hai!
   - **Real Shop Example:** Koi bhi banda browser par ghalat username aur apna password dal kar store ki credentials overwrite karne ki koshish kar sakta hai (jab tak backend `setup` already complete ho toh reject kare, par agar setup incomplete ho toh hijack possible).
   - **Evidence:** `src/app/auth/LoginPage.tsx:44-63`.
   - **Recommended Fix:** Login error par automatic `auth.setup()` fallback bilkul hata dein.

---

### HIGH (Rozana Operations Mein Ghalat Hisaab / Chori / Rukaawat)

7. **Held Sale Resume Karte Hi DB Se Delete Ho Jata Hai (Crash Data Loss)**
   - **Problem:** `resumePosSale()` held bill ko cart mein bhejte hi `DELETE FROM held_sales` kar deta hai, aur held bill mein `paymentMethod` aur unsaved customer name bhi store nahi hota.
   - **Real Shop Example:** Cashier ne Rs 8,500 ka bharay hua trolley bill hold se resume kiya; achanak bijli gayi ya window refresh ho gayi -> poora bill gayab! Customer phir se poora cart scan karega.
   - **Evidence:** `electron/database/database.mts:517-541`; `src/features/pos/usePos.ts:271-297`.
   - **Recommended Fix:** `held_sales` ko tab delete karein jab `completePosSale()` commit ho (ek `resumedHeldSaleId` pass karein) ya sirf cashier ke explicit `"Discard"` karne par; sath hi original price snapshot warning dikhayein.

8. **Manual Return (No Bill) Par Zero Price Check & Chori Risk**
   - **Problem:** `createManualReturn()` bina kisi bill ya customer purchase proof ke cashier/manager ko apni marzi ki `unitPricePaisa` daal kar cash refund nikalne deta hai.
   - **Real Shop Example:** Staff Rs 200 wala item Rs 2,000 refund price dal kar `MRET-` bana sakta hai aur drawer se Rs 1,800 extra nikal sakta hai (expected cash balance bhi barabar rahega!).
   - **Evidence:** `electron/database/database.mts:943-1041` (`unitPricePaisa` validation L974-975).
   - **Recommended Fix:** Manual return sirf **Owner/Manager PIN approval** se allow karein, aur price default product ke `selling_price_paisa` par lock ya cap karein.

9. **100% Discount & Below-Cost Sale Par Koi Cap Nahi + Pre-Save Fake Print**
   - **Problem:** POS par `pos.sell` kisi bhi item par 100% discount (`discountBasisPoints <= 10000`) ya khareed qeemat (`unitCostPaisa`) se kam rate par bech sakta hai; aur `Bill Preview` mein `Print` button bill save kiye bina hi slip nikal deta hai!
   - **Real Shop Example:** Cashier gahak ko Bill Preview se kacha print de kar paise pakar le aur `Complete Bill` dabane ki bajaye `Close` aur `Clear Cart` kar de — na inventory kategi na cash drawer barhega!
   - **Evidence:** `database.mts:421, 484`; `PosDialogs.tsx:418-428`; `ProductsPage.tsx:444`.
   - **Recommended Fix:** `Print` se pehle bill ya toh `Completed` save karein ya kachi preview par bada **`"DRAFT / ESTIMATE - NOT A TAX BILL"`** watermark lagayein; aur Cashier role par Max Discount % (e.g. `5%` ya Manager PIN) aur below-cost block lagayein.

10. **Force Close Hamesha Zero Variance (`variance = 0`) Likh Deta Hai**
    - **Problem:** `CashRepository.forceClose()` `counted_cash = expected` likh kar `variance = 0` save kar deta hai.
    - **Real Shop Example:** Cashier shaam ko Rs 4,000 kam rakh kar bhag gaya. Manager ne agle din system kholne ke liye force-close kiya -> Report bolegi Rs 0 short tha! Chori aur accounting discrepancy trace hi nahi hogi.
    - **Evidence:** `electron/database/cash.mts:110-132` (line `127`).
    - **Recommended Fix:** Force-close mein manager se actual physical counted cash zaroor dalwayein (`countedCashPaisa` field add karein) taake asli short/excess report mein aaye.

11. **Product Advanced Tab Ke Fields Dhoka Hain (Saved Nahi Hote)**
    - **Problem:** Product add/edit karte waqt user `GST Rate`, `Storage Shelf`, `Batch & Expiry Tracking`, `Scale Product`, aur `Allow Cashier Discount` set karta hai, magar backend mein columns hi nahi hain — data save nahi hota.
    - **Evidence:** `src/features/products/ProductsPage.tsx:441-459, 855-920`; `electron/database/schema.mts`.
    - **Recommended Fix:** Jo features DB mein exist nahi karte unka UI hata dein ya DB migrations + logic implement karein.

12. **Customer Collection Mein Advance Jama Blocked + Split Payment Missing**
    - **Problem:** Customer agar Rs 4,500 bill par Rs 2,000 cash de kar Rs 2,500 udhaar karwana chahe toh POS par nahi ho sakta. Isi tarah agar kisi ka Rs 1,800 udhaar ho aur woh Rs 2,000 jama karwaye toh system error de deta hai.
    - **Evidence:** `database.mts:507-509`; `accounts.mts:143`.
    - **Recommended Fix:** Multi-tender `sale_payments` (`Cash + Udhaar / JazzCash`) aur `customer_ledger` credit balance (`balance < 0`) already DB query mein supported hai (`accounts.mts:166`) — sirf line `143` check hatana aur split UI lagana baqi hai!

---

### MEDIUM (Performance, Scale, Usability & Governance)

13. **Web `/api/auth/status` `allowedTabs` Bhool Jata Hai**
    - **Problem:** Browser refresh karne par `allowedTabs` null aane se custom tab permissions wapas default role par gir jati hain (`StaffPage` mein di gayi extra tabs sidebar se gayab ho jati hain jabke backend `rolePermissions` se UI mismatch karta hai).
    - **Evidence:** `server/routes/auth.mts:78-93` vs `src/shared/auth-policy.ts:11-17`.
    - **Recommended Fix:** `/api/auth/status` response mein `allowedTabs` shamil karein aur backend route guards ko bhi business settings ke mutabiq sync rakhein.

14. **10,000+ Products & 100,000+ Sales Par POS Slowdown**
    - **Problem:** `getPosBootstrap()` saare active products + saare customers ek hi query mein bhejta hai aur React poori grid render karta hai; `nextDocumentNumber()` har bill par poore `sales` table ke invoice numbers memory mein scan karta hai.
    - **Evidence:** `electron/database/database.mts:395-400`; `electron/database/posting.mts:39-52`; `PosWorkspace.tsx:38-64`.
    - **Recommended Fix:** `nextDocumentNumber` mein sirf `document_sequences.last_value` use karein (har bill par full scan khatam); POS par server-side barcode/prefix search + pagination/virtualization lagayein.

15. **Product Image POS Par Show Nahi Hoti & Paginated Excel Export Adhoora Hai**
    - **Problem:** `ProductsPage` par product image upload hoti hai par `getPosBootstrap()` aur `PosWorkspace.tsx:45` image bhejta/dikhata hi nahi! Doosra, `ProductsPage`, `CustomersPage`, `SalesPage` ke `"Export Excel"` buttons sirf UI par loaded **1 page (10–25 rows)** export karte hain, poora data nahi.
    - **Evidence:** `database.mts:395-397`; `PosWorkspace.tsx:45`; `SalesPage.tsx:51`; `ProductsPage.tsx:1158`.
    - **Recommended Fix:** Excel export ko backend full-dataset endpoint (e.g. `exportProductsCsv` style JSON/Excel stream) se jorein aur POS mein `imageDataUrl` thumbnail optional dikhayein.

16. **Web LAN Traffic Bina HTTPS Encryption Ke Chalta Hai**
    - **Problem:** `0.0.0.0:8080` plain HTTP + WS hai; network par koi bhi login password sniff kar sakta hai.
    - **Evidence:** `server/server.mts:48-66, 100+`.
    - **Recommended Fix:** Production LAN / remote access ke liye self-signed local TLS ya Caddy/Nginx reverse proxy guide aur strict origin checks lagayein.

---

### LOW (Polish & Operational Friction)

17. **Cash Drawer Float / Loose Weight UX & Shortcut Gaps:** POS par `750g` ya `250g` dalne ke liye quick preset chips (`250g, 500g, 1kg`) nahi hain (`usePos.ts:141`), aur `Clear Cart` / `Delete Held Sale` par koi PIN ya audit log nahi banta.
18. **`Audit Events` Viewer UI Missing:** Backend har cheez `audit_events` table mein likhta hai lekin Owner ke liye `"Audit Log"` dekhne ki koi screen app mein **not found** (`src/shared/auth-policy.ts:16`).
19. **Browser `localStorage` Legacy Seed Baggage:** `retailData.storage.ts` aur `seedProducts` ab bhi `vertexia.product-inventory.v1` checks aur purane dummy data code mein rakhte hain jo confuse kar sakte hain.

---

## 7. What to ADD (Value-Ranked Additions for Pakistani Retail)

1. **Configurable Settings Screen (`SettingsPage.tsx`):** Shop Name/Address/Phone for receipts, Receipt Footer (e.g. "Saman ki wapsi 3 din mein"), Paper Size (80mm/58mm thermal), Tax %, Rounding (`Nearest Rs 1/5`), Negative Stock toggle, Max Cashier Discount %.
2. **Split Payment (`Cash + Udhaar` / `Cash + JazzCash`):** Ek bill mein do payment lines lene ki sahulat (`sale_payments` table already multi-row support karti hai!).
3. **Invoice Void + Manager PIN Approval Flow:** Ghalat bane hue bill ko same-day reason aur Owner/Manager password ke sath `status='voided'` karne ka proper button (audit trail + drawer/stock reversal ke sath).
4. **Unit Conversion (`Carton / Pack <-> Piece`):** Purchase mein `10 Cartons @ Rs 2,400` dalte hi automatic `240 Pcs @ Rs 100` stock aur cost update hona.
5. **Customer Credit Limit & Udhaar WhatsApp Reminder:** Customer par max limit (e.g. Rs 10,000) aur overdue alert + WhatsApp ledger summary share link.
6. **Real GST / Tax & FBR POS Integration Ready Layer:** Per-product GST % (`tax_rate_bps`), tax-inclusive vs exclusive calculation, aur FBR fiscalization fields (`fbr_invoice_no`, `qr_code`, `pos_id`).
7. **Thermal Receipt Silent Printing (`58mm`/`80mm`):** Electron `webContents.print({ silent: true })` ya ESC/POS thermal driver taake har gahak par Windows print dialog na khule.
8. **Real Expiry & Batch Table (`product_batches`):** Dairy/bakery/cosmetics ke liye batch-wise stock aur FEFO (pehle expire hone wala pehle bike).
9. **Supplier Opening Balance Ledger Sync & Audit Log Viewer:** Owner ko ek screen par sab staff ki ghalat harkatein (force close, manual return, price edits, cash withdrawals) dikhein.
10. **Automated Offsite / Encrypted Cloud or Google Drive Backup:** Dukaan ka PC jal jaye ya chori ho toh bhi business recover ho sake (encrypted zip + password).

---

## 8. What to REMOVE or SIMPLIFY

1. **Remove Startup Backdoor (`electron/main.mts:551-560`):** `'taha'`/`'jameel'` override code foran delete karein.
2. **Remove ALL Hardcoded Mock Fallbacks:** `ReportsPage.tsx` (`TOP_PRODUCTS`, `STAFF_SALES`, static SVG, `SAL-2026-1258`, Rs 2.48M fallbacks), `ExpensesPage.tsx` (`320000`, `18675000`, `Rent 32%`), aur `InventoryPage.tsx` ka fake `ExpiryView` (`BAT-...` / `(idx*37)%360`) foran hatayein.
3. **Remove Fake UI Controls That Don't Save:** `ProductsPage.tsx` Advanced tab ke unsaved toggles (`taxRate`, `trackExpiry`, `allowDiscount`, `scaleProduct`, `storageShelf`) jab tak backend DB support na ho hata dein.
4. **Simplify Navigation (`StaffPage.tsx:12-28`):** Sidebar mein **15+ tabs** hain (`Sales` aur `Sales History` aur `Returns` aur `Stock Transfers` alag-alag). Chhoti dukaan ke liye `Sales` + `Sales History` ek hi unified `"Bills & Returns"` section ban sakta hai taake cashier confuse na ho.
5. **Remove Legacy In-Browser Mock Storage (`retailData.storage.ts`):** Purana browser demo seed file jo DB ke sath conflict ka confusion deta hai remove karein.
6. **Simplify `Customers` & `Suppliers` Filters:** `All Cities` / `All Groups` jaise dropdowns (`CustomersPage.tsx:38-39`) jinke piche DB mein column hi nahi ya unused hain hata dein.

---

## 9. What to CHANGE (Existing Logic & UX Fixes)

1. **`deleteProduct()` (`database.mts:707`):** Hard delete ki jagah agar product kisi bhi bill/purchase/movement mein use hua ho toh sirf `Deactivate` (`is_active=0`) karein; sirf unused (0 history) products hi delete hon.
2. **`Bill Preview` (`PosDialogs.tsx:320-433`):** Preview par `Print` button se nikalne wali parchi par saaf **`"QUOTATION / UNPAID DRAFT"`** print ho aur `Complete Bill` ke baad final thermal receipt (with `BILL-xxx` invoice number) auto-print/reprint option de!
3. **`Held Sales` (`database.mts:527`):** `Resume` par row turant delete na karein — `status='resumed'` ya complete sale hone par delete karein; sath hi held bill banate waqt ka `unit_price` aur `paymentMethod` preserve karein ya price difference highlight karein.
4. **`Cash Force Close` (`cash.mts:127`):** Manager se actual ginay hue paise (`countedCashPaisa`) input le kar asli `variance_paisa` calculate karein — zero variance force na karein.
5. **`Manual Return` (`database.mts:943`):** Manager/Owner approval + default selling price lock lagayein, aur cashier role par disable rakhein.
6. **`Supplier Opening Balance` (`retail.mts:163`):** `createSupplier()` ko opening balance seedha `supplier_ledger` mein post karna chahiye taake `paySupplier()` chal sake.
7. **`POS Weight & Keyboard Speed`:** Kilogram/Gram products par clicking se preset buttons (`100g, 250g, 500g, 1kg`) khulein aur barcode scan direct global listener se kaam kare (alag modal kholne ki bajaye main POS search par focus rahe).
8. **`ReportsPage` Tabs:** `Overview`, `Sales`, `Profit`, `Inventory`, `Customers`, `Shifts`, `Expenses` har tab par backend `ReportsRepository` (`electron/database/reports.mts`) se live SQL data aur real charts render karein.

---

## 10. Role-Based Review (Asli Shop Ke Log Kya Kahenge)

1. **Kiryana Shop Owner (Low tech, wants speed, udhaar, Urdu):**
   English-only UI, 15 tabs, aur har dafa shift open/close karne ki pabandi usay thaka degi. Customer udhaar chal jata hai magar **split payment (aadha cash, aadha udhaar)** aur **credit limit** na hone se rozana ka kiryana hisaab adhooora lagega. Urdu language aur fast loose-item buttons (250g cheeni, 100g mirch, carton -> pieces) missing hain.
2. **Mini Mart Owner (Stock control, profit, supplier tracking):**
   Weighted-average costing aur low-stock alerts achay hain, magar **fake Expiry tab** aur **hardcoded mock Reports** dekh kar uska bharosa toot sakta hai. Supplier ka purana udhaar (`opening balance`) pay na ho sakna aur `Products` mein tax/shelf fields save na hona usay seedha pareshan karega.
3. **Supermarket Manager (Multi-cashier control, branch reports, FBR):**
   Multi-branch stock transfers aur per-counter shifts achi bunyad hain. Magar **FBR POS integration bilkul nahi hai**, **GST tax logic missing hai**, LAN mode bina HTTPS chalta hai aur web backups fake stubs hain — is liye registered supermarket ise billing ke liye legally use nahi kar sakti. Cashiers par discount limit na hona aur force-close par `0` variance chhupna theft risk barhata hai.
4. **Cashier (Speed, minimal clicks, no confusion):**
   Har sale ke liye **2 extra clicks** lagte hain (`Complete Bill` -> `Bill Preview` -> phir `Complete Bill`), aur thermal silent print na hone se har gahak par print popup tang karega. Barcode scan ke liye alag modal kholna parhna aur weight products par manual `0.75` type karna rush hour (shaam 6–9 baje) mein lambi line lagwa dega.
5. **Accountant (Correct ledgers, audit trail, exports):**
   Backend ka integer `paisa` math, weighted-avg valuation, `expense_reversals`, aur `audit_events` design solid hai! Lekin **fake UI Reports**, **`deleteProduct` se purane `sale_items` udd jana**, **`Audit Log` viewer screen na hona**, aur **Excel export ka sirf current page (10-25 rows) nikalna** kisi bhi accountant ka audit fail karwa dega.

---

## 11. Action Plan

### Phase A: Fix Immediately (Critical Bugs & Data/Money Safety)
1. `electron/main.mts:551-560` ka `'taha'`/`'jameel'` credential overwrite backdoor delete karein.
2. `database.mts:707` mein `deleteProduct()` par historical transaction check lagakar hard-delete block karein (sirf `inactive` allow ho).
3. `ReportsPage.tsx`, `ExpensesPage.tsx` (`DateRangeFilter` + fake fallbacks), aur `InventoryPage.tsx` (`ExpiryView`) ke saare hardcoded mock numbers/charts hata kar real DB data lagayein.
4. `retail.mts:163` mein supplier opening balance ko `supplier_ledger` mein likhein taake payment ho sake.
5. `server/routes/system.mts:77-98` (fake web backup) aur `LoginPage.tsx:44-63` (auto-heal overwrite) fix/disable karein.
6. `PosDialogs.tsx` Preview Print par `"DRAFT"` watermark lagayein aur `cash.mts:127` (`forceClose`) par physical counted cash zaroori karein.

### Phase B: Next 2 Weeks (Core Daily Shop Usability)
1. **Real `SettingsPage`:** Shop name/phone/receipt footer, max cashier discount %, negative stock warning/override, aur 80mm silent thermal receipt printing.
2. **Held Bill Safety + Split Payment (`Cash + Udhaar`):** `resumePosSale` mein premature delete fix karein; split payment aur customer advance credit allow karein.
3. **Invoice Void (Manager PIN) & Manual Return Lock:** `sales.status='voided'` workflow add karein aur Manual Return par Manager approval lagayein.
4. **Full-Dataset Export + Web Session Fix:** Excel/PDF exports poori filtered dataset par lagayein aur `/api/auth/status` mein `allowedTabs` wapas bhejein.

### Phase C: Next 1–2 Months (Scale & Pakistani Retail Power Features)
1. **Unit Conversion:** Carton/Pack -> Pieces buying & selling (`conversion_factor`).
2. **POS Performance:** `nextDocumentNumber()` se full-table scan hatayein (`sales`), `getPosBootstrap()` ko search-indexed/paginated banayein taake 10,000+ products par makkhan chale.
3. **Real Batch & Expiry + Customer Credit Limits + Audit Log Viewer UI.**
4. **Loose Weight Quick Presets (100g, 250g, 500g) & Direct Keyboard Wedge Scanning.**

### Phase D: Later (Growth, Compliance & Remote)
1. **GST & FBR POS Integration** (POSID, USIN, QR Code, tax-inclusive/exclusive calculation).
2. **Urdu / Bilingual Toggle & Thermal ESC/POS Printer Driver.**
3. **Encrypted Cloud Sync / Owner Mobile Dashboard + LAN HTTPS & Offline IndexedDB Queue.**

---

## 12. Final Verdict (Max 10 Lines)

Is system ka **core SQLite billing & ledger engine (`WAL`, `paisa` integer math, idempotency, weighted-avg costing)** kaafi mazboot hai, lekin iski **UI aur operational controls abhi asli Pakistani dukaan par bina fix ke lagane ke qabil nahi hain**. Chhoti **non-FBR Kiryana / Single-PC Mini Mart** tab hi use kar sakti hai jab immediate critical bugs (fake reports, product hard-delete, supplier opening balance bug, aur backdoor) fix ho jayein — **Supermarkets aur FBR Tier-1 stores abhi bilkul use nahi kar sakti**.
**Top 5 Blockers:**
1. **`ReportsPage.tsx`, `ExpensesPage.tsx` & `ExpiryView` ka fake/hardcoded data** (owner ko ghalat munafa aur jhooti expiry dikhata hai).
2. **`electron/main.mts:551-560` startup backdoor & `LoginPage` auto-setup overwrite** (security khatra).
3. **`deleteProduct()` se purane invoices ke items tabah hona** aur **`supplier_profiles.opening_balance_paisa` pay na ho pana**.
4. **Zero Tax/GST, Zero FBR compliance, Zero Unit Conversion (Carton->Piece), aur Zero Split Payment (`Cash + Udhaar`)**.
5. **Cashier control loopholes** (100% / below-cost discount allowed, Pre-save Preview Print chori rasta, `Manual Return` arbitrary price, aur `forceClose` par `variance=0`).
