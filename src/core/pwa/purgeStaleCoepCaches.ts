/** One-time purge of Workbox caches from builds that precached index.html with COEP headers. */
const PURGE_FLAG = 'utasync:coep-cache-purged:v3'

export async function purgeStaleCoepCaches(): Promise<void> {
  if (typeof window === 'undefined' || typeof caches === 'undefined') return
  try {
    if (localStorage.getItem(PURGE_FLAG) === '1') return
    const keys = await caches.keys()
    await Promise.all(
      keys
        .filter((name) => name.startsWith('utasync-') && !name.includes('v3'))
        .map((name) => caches.delete(name)),
    )
    localStorage.setItem(PURGE_FLAG, '1')
  } catch {
    /* storage or cache API blocked */
  }
}
