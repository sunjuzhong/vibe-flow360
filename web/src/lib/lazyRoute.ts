import type { ComponentType } from 'react'

export const lazyRouteReloadKey = 'vibesim.lazy-route-reload'

type RouteModule = { default: ComponentType }
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

let attemptedSignature: string | null = null

function failureSignature(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error)
  if (!/(dynamically imported module|module script|loading chunk|chunkloaderror)/i.test(message)) return null
  return message
}

export async function importLazyRoute<T extends RouteModule>(
  importer: () => Promise<T>,
  storage: StorageLike = window.sessionStorage,
  reload: () => void = () => window.location.reload(),
): Promise<T> {
  try {
    const module = await importer()
    attemptedSignature = null
    try {
      storage.removeItem(lazyRouteReloadKey)
    } catch {
      // A successful import needs no recovery state, even if storage is blocked.
    }
    return module
  } catch (error) {
    const signature = failureSignature(error)
    if (!signature) throw error

    let previousAttempt = attemptedSignature
    try {
      previousAttempt = storage.getItem(lazyRouteReloadKey) ?? previousAttempt
    } catch {
      // The in-memory guard still prevents a loop while this document is alive.
    }
    if (previousAttempt !== signature) {
      attemptedSignature = signature
      try {
        storage.setItem(lazyRouteReloadKey, signature)
      } catch {
        // Reload recovery still works when session storage is unavailable.
      }
      reload()
    }
    throw error
  }
}

export function clearLazyRouteRecovery(storage: Pick<Storage, 'removeItem'> = window.sessionStorage) {
  attemptedSignature = null
  try {
    storage.removeItem(lazyRouteReloadKey)
  } catch {
    // The user can still perform a manual reload when storage is unavailable.
  }
}
