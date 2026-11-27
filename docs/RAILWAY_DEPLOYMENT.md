# Vertexia Retail POS — Railway Cloud Gateway Deployment Guide

## 1. Prerequisites
- Single-cluster Supabase PostgreSQL database with SSL enabled (`DATABASE_CENTRAL_URL` using Supabase Supavisor session pooler IPv4 URI + `?sslmode=require`).
- Node.js 22+ runtime (Railway / Railpack automatic install).
- Shop Main PC Windows desktop POS running with matching `VERTEXIA_CLOUD_URL` and `CLOUD_NODE_HMAC_SECRET`.

## 2. Required Railway Variables
Set the following environment variables in the Railway service **Variables** tab (never commit real secrets to Git):

| Variable | Example / Requirement |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_CENTRAL_URL` | `postgresql://postgres.<project>:<password>@aws-1-<region>.pooler.supabase.com:5432/postgres?sslmode=require` |
| `CLOUD_JWT_SECRET` | Minimum 32 random bytes (64 hex chars) |
| `CLOUD_NODE_HMAC_SECRET` | Minimum 32 random bytes (64 hex chars), exact match with Shop Main PC `CLOUD_NODE_HMAC_SECRET` |
| `CLOUD_CORS_ORIGINS` | Comma-separated exact origins of your Remote Owner PWA, e.g. `https://owner.vertexia.app` (no wildcard `*`) |
| `PG_BACKUP_DIR` | `/data/backups/cloud` (matching Railway Persistent Volume mount path) |
| `PG_POOL_MAX` | `20` |

> **Important:** Railway sets `PORT` automatically and the gateway binds to `0.0.0.0:$PORT` via `cloud-server/config/env.mts`. Leave `CLOUD_PORT` unset in Railway unless intentionally overriding locally.

## 3. Railway Persistent Volume Setup (Backups)
Cloud backups write SHA-256 verified JSON archives per shop into `<PG_BACKUP_DIR>/<shopUuid>/`:
1. In your Railway service, open **Volumes** -> **Add Volume**.
2. Set the mount path to `/data/backups/cloud`.
3. Set `PG_BACKUP_DIR=/data/backups/cloud` in Railway Variables.
4. Redeploy once so container backups persist across restarts and deployments.

## 4. Build & Start Configuration
- Railpack installs dependencies during the install phase. Keep the custom build command focused cleanly on compiling TypeScript without re-running `npm ci` over an open lock:
  - Build command: `npm run build:cloud`
  - Start command: `node cloud-dist/cloud-server/index.mjs`

## 5. Verification Checklist After Manual Deploy
1. Verify health check:
   `GET https://<your-railway-domain>/api/cloud/health` -> expects HTTP `200` with `{"status":"ok","service":"vertexia-cloud-gateway",...}`.
2. Verify CORS preflight for your hosted Remote Owner origin returns `204` + exact `Access-Control-Allow-Origin` and unknown origins return `403`.
3. Confirm Main PC `HybridSyncEngine` logs a successful cycle against `/api/cloud/sync/register-node`, `/api/cloud/sync/push`, and `/api/cloud/sync/pull`.
4. Do NOT drop or modify existing `vtx_central` or active shop schemas (`vtx_shop_*`) during redeploys; schema migrations run idempotently on startup (`vtx_central.schema_migrations` / `schema_migrations`).

## 6. Cloud Backup & Restore Scope
- **Supported via Cloud Console:** Generate SHA-256 verified JSON tenant snapshots (`POST /api/cloud/owner/backups/create`), verify checksums (`GET /api/cloud/owner/backups/:file/verify`), and download archives (`GET /api/cloud/owner/backups/:file/download`).
- **Main PC Authoritative Restore:** Restoring a shop's live operational ledger onto SQLite remains Main PC Desktop-only (Settings -> Backup & Restore) to prevent duplicate invoices or broken fiscal stock valuation.

## 7. Rollback Procedure
- In Railway **Deployments**, click **Redeploy** / **Rollback** on the last healthy deployment revision.
- If `CLOUD_NODE_HMAC_SECRET` or `CLOUD_JWT_SECRET` was changed erroneously, restore the previous variable values in Railway and synchronize `CLOUD_NODE_HMAC_SECRET` on the Shop Main PC User Environment Variables, then restart the Desktop POS application.
