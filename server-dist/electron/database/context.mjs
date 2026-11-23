import { AsyncLocalStorage } from 'node:async_hooks';
export const requestActorStorage = new AsyncLocalStorage();
export function getRequestContext() {
    return requestActorStorage.getStore();
}
export function runWithContext(context, fn) {
    return requestActorStorage.run(context, fn);
}
//# sourceMappingURL=context.mjs.map