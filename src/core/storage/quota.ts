export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  return navigator.storage.persist()
}

export async function estimateQuota(): Promise<{ used: number; total: number; ratio: number }> {
  if (!navigator.storage?.estimate) return { used: 0, total: 0, ratio: 0 }
  const { usage = 0, quota = 1 } = await navigator.storage.estimate()
  return { used: usage, total: quota, ratio: usage / quota }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}
