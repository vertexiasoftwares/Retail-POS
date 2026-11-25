import type { FastifyInstance } from 'fastify';
import type { VertexiaDatabase } from '../../electron/database/database.mjs';
import type { AuthRepository } from '../../electron/database/auth.mjs';
import type { RealtimeSyncServer } from '../websocket.mjs';
import type {
  BusinessSetupInput,
  BusinessUpdateInput,
  StaffCreateInput,
  StaffUpdateInput,
} from '../../src/types/auth.js';
import {
  getSessionToken,
  setSessionCookie,
  clearSessionCookie,
  isSecureRequest,
  validateOrigin,
} from '../server.mjs';
import { enforceAuth } from '../auth-guard.mjs';

export function registerAuthRoutes(
  app: FastifyInstance,
  db: VertexiaDatabase,
  auth: AuthRepository,
  sync?: RealtimeSyncServer
): void {
  // POST /api/auth/login
  app.post('/api/auth/login', async (request, reply) => {
    if (!validateOrigin(request)) {
      return reply.status(403).send({ error: 'Forbidden', message: 'Cross-origin request blocked.', statusCode: 403 });
    }
    const body = request.body as { username?: unknown; password?: unknown } | undefined;
    if (!body || typeof body.username !== 'string' || typeof body.password !== 'string') {
      return reply.status(400).send({ error: 'BadRequest', message: 'Username and password are required.', statusCode: 400 });
    }
    try {
      const { token, session } = await auth.loginWithToken(body.username, body.password);
      const secure = isSecureRequest(request);
      setSessionCookie(reply, token, secure);
      return {
        ok: true,
        session: {
          userId: session.userId,
          name: session.name,
          username: session.username,
          role: session.role,
          businessId: session.businessId,
          businessName: session.businessName,
          branches: session.branches,
          branchId: session.branchId,
          permissions: session.permissions,
          allowedTabs: session.allowedTabs,
          mustChangePassword: session.mustChangePassword,
        },
      };
    } catch (err: any) {
      const secure = isSecureRequest(request);
      clearSessionCookie(reply, secure);
      const message = err?.message || 'Authentication failed.';
      const statusCode = message.includes('Too many') ? 429 : 401;
      return reply.status(statusCode).send({ error: 'AuthError', message, statusCode });
    }
  });

  // GET /api/auth/status
  app.get('/api/auth/status', async (request, reply) => {
    const token = getSessionToken(request);
    const secure = isSecureRequest(request);
    if (!token) {
      const st = auth.status();
      return { needsSetup: st.needsSetup, businessName: st.businessName, session: null };
    }
    const session = auth.authenticateToken(token, true);
    if (!session) {
      clearSessionCookie(reply, secure);
      const st = auth.status();
      return { needsSetup: st.needsSetup, businessName: st.businessName, session: null };
    }
    const st = auth.status(token);
    return {
      needsSetup: st.needsSetup,
      businessName: st.businessName,
      session: {
        userId: session.userId,
        name: session.name,
        username: session.username,
        role: session.role,
        businessId: session.businessId,
        businessName: session.businessName,
        branches: session.branches,
        branchId: session.branchId,
        permissions: session.permissions,
        allowedTabs: session.allowedTabs,
        mustChangePassword: session.mustChangePassword,
      },
    };
  });

  // POST /api/auth/logout
  app.post('/api/auth/logout', async (request, reply) => {
    if (!validateOrigin(request)) {
      return reply.status(403).send({ error: 'Forbidden', message: 'Cross-origin request blocked.', statusCode: 403 });
    }
    const token = getSessionToken(request);
    const secure = isSecureRequest(request);
    if (token) {
      auth.logoutToken(token);
    }
    clearSessionCookie(reply, secure);
    return { ok: true, message: 'Logged out successfully.' };
  });

  // POST /api/auth/select-branch
  app.post('/api/auth/select-branch', async (request, reply) => {
    if (!validateOrigin(request)) {
      return reply.status(403).send({ error: 'Forbidden', message: 'Cross-origin request blocked.', statusCode: 403 });
    }
    const token = getSessionToken(request);
    if (!token) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Sign in before selecting a branch.', statusCode: 401 });
    }
    const body = request.body as { branchId?: unknown } | undefined;
    if (!body || typeof body.branchId !== 'string') {
      return reply.status(400).send({ error: 'BadRequest', message: 'branchId is required.', statusCode: 400 });
    }
    try {
      const session = auth.selectSessionBranch(token, body.branchId);
      return {
        ok: true,
        session: {
          userId: session.userId,
          name: session.name,
          username: session.username,
          role: session.role,
          businessId: session.businessId,
          businessName: session.businessName,
          branches: session.branches,
          branchId: session.branchId,
          permissions: session.permissions,
          allowedTabs: session.allowedTabs,
          mustChangePassword: session.mustChangePassword,
        },
      };
    } catch (err: any) {
      return reply.status(400).send({ error: 'BranchError', message: err?.message || 'Failed to select branch.', statusCode: 400 });
    }
  });

  // POST /api/auth/setup
  app.post('/api/auth/setup', async (request, reply) => {
    if (!validateOrigin(request)) {
      return reply.status(403).send({ error: 'Forbidden', message: 'Cross-origin request blocked.', statusCode: 403 });
    }
    const body = request.body as BusinessSetupInput | undefined;
    if (!body) {
      return reply.status(400).send({ error: 'BadRequest', message: 'Setup parameters required.', statusCode: 400 });
    }
    try {
      const session = await auth.setup(body);
      try {
        const { token } = await auth.loginWithToken(body.username, body.password);
        const secure = isSecureRequest(request);
        setSessionCookie(reply, token, secure);
      } catch {}
      return { ok: true, session };
    } catch (err: any) {
      return reply.status(400).send({ error: 'SetupError', message: err?.message || 'Setup failed.', statusCode: 400 });
    }
  });

  // GET /api/auth/users
  app.get('/api/auth/users', async (request, reply) => {
    const guarded = enforceAuth(request, reply, auth, db, 'users.manage');
    if (!guarded) return;

    try {
      const users = auth.listUsers();
      return users;
    } catch (err: any) {
      return reply.status(400).send({ error: 'UserListError', message: err?.message || 'Failed to list staff users.', statusCode: 400 });
    }
  });

  // POST /api/auth/users
  app.post('/api/auth/users', async (request, reply) => {
    const body = request.body as StaffCreateInput | undefined;
    const guarded = enforceAuth(request, reply, auth, db, 'users.manage', undefined, true);
    if (!guarded) return;

    try {
      const users = await auth.createUser(body!);
      return users;
    } catch (err: any) {
      return reply.status(400).send({ error: 'UserCreateError', message: err?.message || 'Failed to create staff user.', statusCode: 400 });
    }
  });

  // PUT /api/auth/users
  app.put('/api/auth/users', async (request, reply) => {
    const body = request.body as StaffUpdateInput | undefined;
    const guarded = enforceAuth(request, reply, auth, db, 'users.manage', undefined, true);
    if (!guarded) return;

    try {
      const users = auth.updateUser(body!);
      return users;
    } catch (err: any) {
      return reply.status(400).send({ error: 'UserUpdateError', message: err?.message || 'Failed to update staff user.', statusCode: 400 });
    }
  });

  // POST /api/auth/users/reset-password
  app.post('/api/auth/users/reset-password', async (request, reply) => {
    const body = request.body as { userId?: string; password?: string } | undefined;
    if (!body || !body.userId || !body.password) {
      return reply.status(400).send({ error: 'BadRequest', message: 'userId and password are required.', statusCode: 400 });
    }
    const guarded = enforceAuth(request, reply, auth, db, 'users.manage', undefined, true);
    if (!guarded) return;

    try {
      await auth.resetPassword(body.userId, body.password);
      return { ok: true, message: 'Password reset successfully.' };
    } catch (err: any) {
      return reply.status(400).send({ error: 'PasswordResetError', message: err?.message || 'Failed to reset password.', statusCode: 400 });
    }
  });

  // POST /api/auth/change-password
  app.post('/api/auth/change-password', async (request, reply) => {
    if (!validateOrigin(request)) {
      return reply.status(403).send({ error: 'Forbidden', message: 'Cross-origin request blocked.', statusCode: 403 });
    }
    const token = getSessionToken(request);
    if (!token) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Sign in to change password.', statusCode: 401 });
    }
    const body = request.body as { currentPassword?: string; newPassword?: string } | undefined;
    if (!body || !body.currentPassword || !body.newPassword) {
      return reply.status(400).send({ error: 'BadRequest', message: 'Current and new passwords are required.', statusCode: 400 });
    }

    try {
      const session = await auth.changePassword(body.currentPassword, body.newPassword, token);
      return {
        ok: true,
        session: {
          userId: session.userId,
          name: session.name,
          username: session.username,
          role: session.role,
          businessId: session.businessId,
          businessName: session.businessName,
          branches: session.branches,
          branchId: session.branchId,
          permissions: session.permissions,
          allowedTabs: session.allowedTabs,
          mustChangePassword: session.mustChangePassword,
        },
      };
    } catch (err: any) {
      return reply.status(400).send({ error: 'ChangePasswordError', message: err?.message || 'Failed to change password.', statusCode: 400 });
    }
  });

  // POST /api/auth/verify-password
  app.post('/api/auth/verify-password', async (request, reply) => {
    const guarded = enforceAuth(request, reply, auth, db, 'settings.manage', undefined, true);
    if (!guarded) return;
    const body = request.body as { password?: string } | undefined;
    try {
      return await auth.verifyCurrentPassword(body?.password ?? '', guarded.token);
    } catch (err: any) {
      return reply.status(400).send({ error: 'VerifyPasswordError', message: err?.message || 'Incorrect login password.', statusCode: 400 });
    }
  });

  // POST /api/auth/update-business
  app.post('/api/auth/update-business', async (request, reply) => {
    const guarded = enforceAuth(request, reply, auth, db, 'settings.manage', undefined, true);
    if (!guarded) return;
    const body = request.body as BusinessUpdateInput | undefined;
    try {
      const session = await auth.updateBusinessProfile(body!, guarded.token);
      return {
        ok: true,
        session: {
          userId: session.userId,
          name: session.name,
          username: session.username,
          role: session.role,
          businessId: session.businessId,
          businessName: session.businessName,
          branches: session.branches,
          branchId: session.branchId,
          permissions: session.permissions,
          allowedTabs: session.allowedTabs,
          mustChangePassword: session.mustChangePassword,
        },
      };
    } catch (err: any) {
      return reply.status(400).send({ error: 'UpdateBusinessError', message: err?.message || 'Failed to update store details.', statusCode: 400 });
    }
  });
}
