# Vertexia Remote Owner Console — Web & Android PWA Hosting Guide

The Remote Owner Console (`remote-owner/`) is built separately from the frozen Shop Desktop/LAN POS UI (`src/`). It communicates exclusively with the Vertexia Cloud API (`/api/cloud/*`) backed by MongoDB Atlas, using **ordinary HTTPS polling** by default so it works reliably on free-tier hosts that sleep idle containers.

## 1. Build the Static PWA Bundle
Set `VITE_CLOUD_API_URL` to your deployed Cloud API URL before building:

```powershell
$env:VITE_CLOUD_API_URL = "https://your-cloud-api.onrender.com"
npm run build:remote
```

Output directory: `remote-dist/` (`index.html`, `manifest.webmanifest`, `sw.js`, icons, and static hashed assets).

> Passwords are never stored in `localStorage` or service worker caches. Sessions use `sessionStorage` Bearer tokens with automatic sign-out on `401`.

## 2. Hosting Options (Free & Commercial-Friendly)
Deploy `remote-dist/` on any static HTTPS CDN:
- **Cloudflare Pages / Netlify / Vercel / Render Static Sites:**
  - Build command: `npm run build:remote`
  - Output directory: `remote-dist`
  - Build environment variable: `VITE_CLOUD_API_URL=https://your-cloud-api.onrender.com`
- Ensure `sw.js` and `manifest.webmanifest` are served with `Cache-Control: no-cache` and SPA fallback rewrites unknown routes to `/index.html`.

## 3. Configure Strict CORS on Cloud API
Add your exact hosted HTTPS origin (without trailing slash) to the Cloud API environment variable:

```env
CLOUD_CORS_ORIGINS=https://your-remote-owner.pages.dev
```

## 4. Installing on Android & PC
- **Android Chrome:** Open the hosted Remote Owner URL -> sign in -> tap browser menu -> **Add to Home screen** / **Install app** (or tap **Install App** when prompted).
- **PC Chrome / Edge:** Click the **Install** icon in the address bar to launch as a standalone desktop window.
