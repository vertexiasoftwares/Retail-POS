# Vertexia Retail POS — MongoDB Atlas + Hosting Deployment Guide

## 1. Architecture Overview
- **Local Shop Main PC:** Electron + React + Fastify + SQLite (authoritative offline-first POS for 1–20 LAN counters).
- **Cloud Database:** MongoDB Atlas (M0 Free Forever tier — 512 MB storage, TLS, zero 30-day expiry).
- **Cloud API:** Hosting-independent Fastify Node.js API (`cloud-dist/cloud-server/index.mjs`) binding `0.0.0.0:$PORT` in production.
- **Remote Owner PWA:** Static SPA (`remote-dist/`) hosted separately on Cloudflare Pages / Vercel / Netlify / Render Static Sites, communicating exclusively via HTTPS (`/api/cloud/*`) with `sessionStorage` Bearer tokens.

---

## 2. MongoDB Atlas Setup (Free M0 Tier)
1. Create a free account at MongoDB Atlas (no credit card required).
2. Create an **M0 Free** cluster (choose a nearby region such as Singapore `ap-southeast-1` or Mumbai `ap-south-1`).
3. Under **Database Access**, create a dedicated database user (`vertexia_cloud_app`) with strong random password and **Read and write to any database** (or scoped to `vertexia_cloud`).
4. Under **Network Access**, add your Cloud API host outbound IPs (or `0.0.0.0/0` if deploying on dynamic free PaaS IPs such as Render/Koyeb, protected by strong credentials + TLS).
5. Copy the **Drivers (Node.js)** SRV connection string:
   `mongodb+srv://vertexia_cloud_app:<PASSWORD>@<cluster>.mongodb.net/?retryWrites=true&w=majority`
6. Never expose `MONGODB_URI` to the browser or `remote-owner/` frontend variables.
7. On Cloud API startup, `connectMongoCloudStore()` automatically creates all 28 collections and unique tenant indexes (`{ shopUuid, ... }`).

---

## 3. Cloud API Hosting Options (Evaluated)

| Platform | Credit Card Required? | Commercial Use | Free Limits & Caveats | Best Fit |
| --- | --- | --- | --- | --- |
| **Render (Free Web Service)** | **No** | Allowed | 750 hrs/mo, 512 MB RAM; **sleeps after 15 min idle (~50s cold start)**; ephemeral disk | **Best zero-card starting host** (cloud backups are stored in MongoDB, so ephemeral disk does not lose backups) |
| **Koyeb (Free Web Service)** | **No** (region-dependent checks) | Allowed | 1 free micro container; scales to zero when idle | Alternative zero-card Docker/Git host |
| **Google Cloud Run (Always Free)** | **Yes (billing card required)** | Allowed | 2M requests/mo, 360k GB-s, fast cold starts | Best free option **if** you have a billing card |
| **Render Starter / Hetzner / DO VPS** | Yes ($4–$7/mo) | Allowed | Always-on 24/7, zero cold starts, persistent WS optional | Lowest-cost upgrade when shop traffic needs zero cold-start latency |

> **Why Vercel is not used for Cloud API:** Vercel Serverless Functions do not run a long-lived Fastify server or WebSocket connections reliably. Host `remote-dist/` on Vercel/Cloudflare Pages if desired, and host `cloud-server` on Render / Koyeb / Cloud Run / VPS.

---

## 4. Required Environment Variables

### Cloud API Server (`cloud-server`)
| Variable | Requirement |
| --- | --- |
| `NODE_ENV` | `production` |
| `MONGODB_URI` | Server-side MongoDB Atlas connection string |
| `MONGODB_DB_NAME` | `vertexia_cloud` (default) |
| `CLOUD_JWT_SECRET` | Random >= 32 characters (64 hex chars recommended) |
| `CLOUD_NODE_HMAC_SECRET` | Random >= 32 characters — must match Main PC `CLOUD_NODE_HMAC_SECRET` |
| `CLOUD_CORS_ORIGINS` | Exact comma-separated HTTPS origin(s) of Remote Owner PWA (e.g. `https://owner.vertexia.pages.dev`). No `*` |

### Shop Main PC (Windows User Environment Variables)
| Variable | Requirement |
| --- | --- |
| `VERTEXIA_CLOUD_URL` | Your deployed Cloud API HTTPS URL (no trailing slash) |
| `CLOUD_NODE_HMAC_SECRET` | Exact match with Cloud API `CLOUD_NODE_HMAC_SECRET` |
| `VERTEXIA_SYNC_INTERVAL_MS` | Optional sync interval in ms (default `10000`) |

---

## 5. Deploy Cloud API on Render (Example — Zero Card)
1. Push branch `feature/mongodb-cloud-sync` (or merge to `main` after verification).
2. In Render Dashboard -> **New +** -> **Web Service** (or use `render.yaml` Blueprint).
3. Build Command: `npm install --include=dev && npm run build:cloud`
4. Start Command: `node cloud-dist/cloud-server/index.mjs`
5. Health Check Path: `/api/cloud/health`
6. Add `MONGODB_URI`, `CLOUD_JWT_SECRET`, `CLOUD_NODE_HMAC_SECRET`, `CLOUD_CORS_ORIGINS`, `NODE_ENV=production`.
7. Verify `GET https://<your-service>.onrender.com/api/cloud/health` returns `{"status":"ok","database":"mongodb",...}`.

---

## 6. Migration Safety & Rollback Plan
1. **Rollback to PostgreSQL/Railway:** The previous Supabase PostgreSQL + Railway implementation remains intact on Git branch `main`. Live Supabase schemas (`vtx_central` and `vtx_shop_*`) are untouched.
2. **Switch Main PC Back:** To roll back, point `VERTEXIA_CLOUD_URL` back to the prior gateway URL and restart Main PC POS. Local SQLite outbox/data remain 100% intact.
