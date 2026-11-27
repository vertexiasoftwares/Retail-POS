import { AsyncLocalStorage } from 'node:async_hooks'

export interface RequestActorContext {
  userId: string
  branchId: string
  role?: string
  sessionToken?: string
  counterId?: string
  ipAddress?: string
}

export const requestActorStorage = new AsyncLocalStorage<RequestActorContext>()

export function getRequestContext(): RequestActorContext | undefined {
  return requestActorStorage.getStore()
}

export function getActiveCounterId(): string {
  return requestActorStorage.getStore()?.counterId || 'counter-1'
}

export function runWithContext<T>(context: RequestActorContext, fn: () => T): T {
  return requestActorStorage.run(context, fn)
}
