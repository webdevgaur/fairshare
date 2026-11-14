/**
 * Thin wrapper over the browser Notification API.
 *
 * All functions are safe no-ops in headless / test environments and when the
 * user has not granted permission. Notifications only fire while the page is
 * open (local-only), matching the F6 spec.
 */

function notificationAvailable(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

/**
 * Request Notification API permission if it hasn't been decided yet.
 * Resolves to `true` only if we end up with permission granted.
 */
export function ensureNotificationPermission(): Promise<boolean> {
  if (!notificationAvailable()) return Promise.resolve(false)
  const permission = Notification.permission
  if (permission === 'granted') return Promise.resolve(true)
  if (permission === 'denied') return Promise.resolve(false)
  try {
    return Notification.requestPermission().then((p) => p === 'granted')
  } catch {
    return Promise.resolve(false)
  }
}

export interface NotifyActivityOptions {
  title: string
  body: string
  tag?: string
}

/**
 * Show a local-only browser notification for new activity (a remote expense
 * or comment). No-ops when the Notification API is unavailable or permission
 * is not granted.
 */
export function notifyActivity({ title, body, tag }: NotifyActivityOptions): void {
  if (!notificationAvailable()) return
  if (Notification.permission !== 'granted') return
  try {
    new Notification(title, { body, tag })
  } catch {
    // Headless / restricted contexts can still throw — swallow it.
  }
}
