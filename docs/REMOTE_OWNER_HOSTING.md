# Vertexia Remote Owner Console — Build & Hosting Guide (PC + Android PWA)

The Remote Owner Console (`remote-owner/`) is built completely separately from the frozen Shop Desktop/LAN POS UI (`src/`). It communicates exclusively with the Railway Cloud Gateway (`/api/cloud/*` and WebSocket `/api/cloud/events`) so the shop owner can monitor sales, adjust products/stock, inspect cash shifts, revoke counters, verify/download backups, and change their owner password even when the Shop Main PC is turned off.

## 1. Build the Static PWA Bundle
Set `VITE_CLOUD_API_URL` to your deployed Railway Cloud Gateway URL before building:

```powershell
$env:VITE_CLOUD_API_URL = "https://retail-pos-production-c8813513.up.railway.app"
npm run build:remote
```

Output directory: `remote-dist/` (`index.html`, `manifest.webmanifest`, `sw.js`, icons, and static hashed assets).

> Note: Owners can also edit/save their Railway Gateway URL right on the Remote Owner Login screen if deploying a generic bundle. Passwords are **never** stored in browser `localStorage` or service worker caches.

## 2. Hosting Options
Deploy `remote-dist/` cleanly as a static SPA:

- **Cloudflare Pages / Vercel / Netlify:**
  - Build command: `npm run build:remote`
  - Output directory: `remote-dist`
  - Environment variable: `VITE_CLOUD_API_URL=https://retail-pos-production-c8813513.up.railway.app`
- **Nginx / Caddy / Static Bucket:**
  - Serve `remote-dist/` over HTTPS with SPA fallback (`try_files $uri /index.html;`) and HTTPS -> HTTP redirects.
  - Ensure `sw.js` and `manifest.webmanifest` are served with `Cache-Control: no-cache` so app updates roll out immediately.

## 3. Configure Strict CORS on Railway
After obtaining your production HTTPS origin (for example `https://owner.amsmart.pk`), set it in Railway Variables:

```env
CLOUD_CORS_ORIGINS=https://owner.amsmart.pk
```

For multiple origins (e.g. local preview + custom domain), comma-separate exact origins without spaces or trailing slashes:

```env
CLOUD_CORS_ORIGINS=https://owner.amsmart.pk,http://localhost:4174
```

Wildcard (`*`) is never emitted by the Cloud Gateway.

## 4. Installing on Android & PC
- **Android Chrome:** Open the hosted Remote Owner URL -> sign in -> tap browser menu -> **Add to Home screen** / **Install app** (or tap the **Install App** button when prompted).
- **Windows/macOS Chrome or Edge:** Click the address-bar **Install** icon to run as an independent standalone desktop window.
