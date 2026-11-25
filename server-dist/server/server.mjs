import fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { VertexiaDatabase } from '../electron/database/database.mjs';
import { AuthRepository } from '../electron/database/auth.mjs';
import { BackupService } from '../electron/backup.mjs';
import { requestActorStorage } from '../electron/database/context.mjs';
import { acquireDatabaseLock } from './lock.mjs';
import { RealtimeSyncServer } from './websocket.mjs';
import { registerAuthRoutes } from './routes/auth.mjs';
import { registerDashboardRoutes } from './routes/dashboard.mjs';
import { registerPosRoutes } from './routes/pos.mjs';
import { registerProductsRoutes } from './routes/products.mjs';
import { registerSalesRoutes } from './routes/sales.mjs';
import { registerCustomersRoutes } from './routes/customers.mjs';
import { registerExpensesRoutes } from './routes/expenses.mjs';
import { registerCashRoutes } from './routes/cash.mjs';
import { registerRetailRoutes } from './routes/retail.mjs';
import { registerReportsRoutes } from './routes/reports.mjs';
import { registerBranchesRoutes } from './routes/branches.mjs';
import { registerSystemRoutes } from './routes/system.mjs';
export const SESSION_COOKIE_NAME = 'vertexia_session';
export function parseCookies(cookieHeader) {
    if (!cookieHeader)
        return {};
    const cookies = {};
    const parts = cookieHeader.split(';');
    for (const part of parts) {
        const idx = part.indexOf('=');
        if (idx < 0)
            continue;
        const key = part.slice(0, idx).trim();
        const val = part.slice(idx + 1).trim();
        try {
            cookies[key] = decodeURIComponent(val);
        }
        catch {
            cookies[key] = val;
        }
    }
    return cookies;
}
export function getSessionToken(request) {
    const cookies = parseCookies(request.headers.cookie);
    return cookies[SESSION_COOKIE_NAME] || null;
}
export function setSessionCookie(reply, token, isSecure = false) {
    const maxAge = 43200; // 12 hours
    const secureFlag = isSecure ? '; Secure' : '';
    reply.header('Set-Cookie', `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureFlag}`);
}
export function clearSessionCookie(reply, isSecure = false) {
    const secureFlag = isSecure ? '; Secure' : '';
    reply.header('Set-Cookie', `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secureFlag}`);
}
export function isSecureRequest(request) {
    return request.protocol === 'https' || request.headers['x-forwarded-proto'] === 'https';
}
export function validateOrigin(request) {
    const origin = request.headers.origin || request.headers.referer;
    if (!origin)
        return true;
    try {
        const url = new URL(origin);
        const host = request.headers.host;
        if (!host)
            return false;
        return url.host === host || url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    }
    catch {
        return false;
    }
}
export function getDefaultDatabasePath() {
    if (process.env.VERTEXIA_DB_PATH) {
        return resolve(process.env.VERTEXIA_DB_PATH);
    }
    if (process.platform === 'win32' && process.env.APPDATA) {
        const appDataPath = join(process.env.APPDATA, 'vertexia-retail-pos', 'data', 'vertexia.db');
        try {
            const appDataDir = dirname(appDataPath);
            mkdirSync(appDataDir, { recursive: true });
            return appDataPath;
        }
        catch {
            // If APPDATA is inaccessible or restricted, fall back to local workspace data directory
        }
    }
    const workspaceDb = join(process.cwd(), 'data', 'vertexia.db');
    try {
        mkdirSync(dirname(workspaceDb), { recursive: true });
    }
    catch { }
    return workspaceDb;
}
export async function createServer(options = {}) {
    const port = options.port ?? (Number(process.env.PORT) || 8080);
    const host = options.host ?? (process.env.HOST || '0.0.0.0');
    const databasePath = options.databasePath ?? getDefaultDatabasePath();
    const staticPath = options.staticPath ?? join(process.cwd(), 'dist');
    // 1. Database & Instance Lock
    let lock = null;
    let db;
    let ownsDatabase = false;
    if (options.database) {
        db = options.database;
    }
    else {
        // Acquire exclusive instance lock before opening database
        lock = acquireDatabaseLock(databasePath, host, port);
        try {
            db = new VertexiaDatabase(databasePath);
            ownsDatabase = true;
        }
        catch (dbError) {
            lock.release();
            throw dbError;
        }
    }
    // 2. Initialize Fastify, Auth Repository & Backup Service
    const auth = options.auth ?? new AuthRepository(db.connection);
    const backups = options.backupService ??
        (databasePath !== ':memory:'
            ? new BackupService(() => db, databasePath, options.backupDirectory ?? join(dirname(databasePath), 'backups'))
            : undefined);
    const app = fastify({
        logger: options.logger ?? (process.env.NODE_ENV === 'test' ? false : { level: 'info' }),
    });
    // Support empty JSON bodies gracefully without throwing 400
    app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
        try {
            const str = typeof body === 'string' ? body.trim() : '';
            const json = str ? JSON.parse(str) : {};
            done(null, json);
        }
        catch (err) {
            done(err, undefined);
        }
    });
    // Establish Request-Scoped AsyncLocalStorage context for authenticated callers
    app.addHook('onRequest', async (request, reply) => {
        const token = getSessionToken(request);
        if (token) {
            const session = auth.authenticateToken(token, false);
            if (session) {
                requestActorStorage.enterWith({
                    userId: session.userId,
                    branchId: session.branchId,
                    role: session.role,
                    sessionToken: token,
                });
            }
        }
    });
    // 3. Structured Error Handling
    app.setErrorHandler((err, request, reply) => {
        const error = err;
        app.log.error({ err, reqId: request.id, url: request.url }, 'Request error occurred');
        const statusCode = typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500;
        reply.status(statusCode).send({
            error: error.name || 'ServerError',
            message: error.message || 'An unexpected server error occurred.',
            statusCode,
        });
    });
    // 4. Health Endpoint (GET /api/health)
    app.get('/api/health', async () => {
        let businessName = 'Unknown';
        let businessId = db.businessId || 'Unknown';
        let branchesCount = 0;
        try {
            const bizRow = db.connection.prepare('SELECT id, name FROM businesses ORDER BY created_at LIMIT 1').get();
            if (bizRow) {
                businessId = String(bizRow.id);
                businessName = String(bizRow.name);
            }
            const countRow = db.connection.prepare('SELECT COUNT(*) as count FROM branches WHERE is_active=1').get();
            if (countRow) {
                branchesCount = Number(countRow.count);
            }
        }
        catch { }
        return {
            status: 'ok',
            timestamp: new Date().toISOString(),
            uptimeSeconds: Math.round(process.uptime() * 100) / 100,
            version: '1.0.0',
            database: {
                connected: true,
                path: databasePath,
                businessId,
                businessName,
                branchesCount,
            },
            server: {
                port,
                host,
            },
        };
    });
    // 5. Initialize Realtime WebSocket Synchronization Server
    const syncServer = new RealtimeSyncServer(auth);
    // Attach HTTP Upgrade handler for /api/events
    app.server.on('upgrade', (req, socket, head) => {
        syncServer.handleUpgrade(req, socket, head);
    });
    // 6. Register Modular Business Routes
    registerAuthRoutes(app, db, auth, syncServer);
    registerDashboardRoutes(app, db, auth, syncServer);
    registerPosRoutes(app, db, auth, syncServer);
    registerProductsRoutes(app, db, auth, syncServer);
    registerSalesRoutes(app, db, auth, syncServer);
    registerCustomersRoutes(app, db, auth, syncServer);
    registerExpensesRoutes(app, db, auth, syncServer);
    registerCashRoutes(app, db, auth, syncServer);
    registerRetailRoutes(app, db, auth, syncServer);
    registerReportsRoutes(app, db, auth, syncServer);
    registerBranchesRoutes(app, db, auth, syncServer);
    registerSystemRoutes(app, db, auth, syncServer, backups);
    // 7. Catch-all for undefined /api/* routes (returns structured JSON 404)
    app.all('/api/*', async (request, reply) => {
        reply.status(404).send({
            error: 'NotFound',
            message: `API endpoint '${request.method} ${request.url}' not found.`,
            statusCode: 404,
        });
    });
    // 7. Static File Serving & SPA Fallback
    const hasDist = existsSync(staticPath) && statSync(staticPath).isDirectory();
    if (hasDist) {
        await app.register(fastifyStatic, {
            root: staticPath,
            prefix: '/',
            wildcard: false,
        });
        // SPA client-side routing fallback: Serve index.html for non-API routes
        const indexPath = join(staticPath, 'index.html');
        if (existsSync(indexPath)) {
            app.setNotFoundHandler((request, reply) => {
                if (request.url.startsWith('/api')) {
                    reply.status(404).send({
                        error: 'NotFound',
                        message: `API endpoint '${request.method} ${request.url}' not found.`,
                        statusCode: 404,
                    });
                    return;
                }
                reply.sendFile('index.html');
            });
        }
    }
    else {
        app.get('/', async (_req, reply) => {
            reply.type('text/html').send(`
        <!DOCTYPE html>
        <html>
          <head><title>Vertexia Retail POS Server</title></head>
          <body style="font-family: system-ui, sans-serif; padding: 2rem; background: #0f172a; color: #f8fafc;">
            <h2>Vertexia Retail POS — Central Server</h2>
            <p style="color: #38bdf8;">Server is running on port ${port}.</p>
            <p>Production frontend assets not found at <code>${staticPath}</code>.</p>
            <p>Run <code>npm run build</code> to compile the frontend, then refresh this page.</p>
            <hr style="border-color: #334155; margin: 1.5rem 0;" />
            <p>Health endpoint: <a style="color: #a78bfa;" href="/api/health">/api/health</a></p>
          </body>
        </html>
      `);
        });
    }
    // 7. Lifecycle Controls
    let isRunning = false;
    const start = async () => {
        if (isRunning) {
            const addr = app.server.address();
            const actualPort = typeof addr === 'object' && addr ? addr.port : port;
            return `http://${host}:${actualPort}`;
        }
        await app.listen({ port, host });
        isRunning = true;
        const addr = app.server.address();
        const actualPort = typeof addr === 'object' && addr ? addr.port : port;
        return `http://${host}:${actualPort}`;
    };
    const stop = async () => {
        if (!isRunning)
            return;
        isRunning = false;
        try {
            syncServer.closeAll();
            await app.close();
        }
        catch { }
        if (lock) {
            lock.release();
        }
        if (ownsDatabase) {
            try {
                db.connection.close();
            }
            catch { }
        }
    };
    return {
        app,
        database: db,
        auth,
        lock,
        syncServer,
        port,
        host,
        start,
        stop,
    };
}
//# sourceMappingURL=server.mjs.map