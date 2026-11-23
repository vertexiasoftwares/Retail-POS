import { requestActorStorage } from '../electron/database/context.mjs';
import { getSessionToken, validateOrigin } from './server.mjs';
export function enforceAuth(request, reply, auth, database, permission, branchId, checkCsrf = false) {
    if (checkCsrf && !validateOrigin(request)) {
        reply.status(403).send({
            error: 'Forbidden',
            message: 'Cross-origin request blocked.',
            statusCode: 403,
        });
        return null;
    }
    const token = getSessionToken(request);
    if (!token) {
        reply.status(401).send({
            error: 'Unauthorized',
            message: 'Sign in to access this resource.',
            statusCode: 401,
        });
        return null;
    }
    try {
        const session = auth.requireToken(token, permission, branchId);
        requestActorStorage.enterWith({
            userId: session.userId,
            branchId: session.branchId,
            role: session.role,
            sessionToken: token,
        });
        database.setActor(session.userId);
        return { session, token };
    }
    catch (err) {
        const message = err?.message || 'Access denied.';
        const isUnauth = message.includes('Session expired') || message.includes('temporary password') || message.includes('Sign in');
        const statusCode = isUnauth ? 401 : 403;
        reply.status(statusCode).send({
            error: isUnauth ? 'Unauthorized' : 'Forbidden',
            message,
            statusCode,
        });
        return null;
    }
}
export function ensureOperationId(body, _userId) {
    let opId = (body && typeof body.operationId === 'string' && body.operationId.trim())
        ? body.operationId.trim()
        : `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    if (!opId.startsWith('op-')) {
        opId = `op-${opId}`;
    }
    return {
        ...body,
        operationId: opId.slice(0, 100),
    };
}
//# sourceMappingURL=auth-guard.mjs.map