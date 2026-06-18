// Worker is intentionally long-lived for the app's session (never terminate()d) so the
// model only loads once; concurrent embedTexts() calls share it and are disambiguated by requestId.
let worker: Worker | null = null
let loaded: Promise<void> | null = null
let nextRequestId = 0

function getWorker(): Worker {
  if (!worker) worker = new Worker(new URL('./textEmbed.worker.ts', import.meta.url), { type: 'module' })
  return worker
}

/** True if a worker response payload's requestId matches the id of the call awaiting it. */
export function isMatchingResponse(payload: { requestId?: number }, requestId: number): boolean {
  return payload?.requestId === requestId
}

function ensureLoaded(): Promise<void> {
  if (!loaded) {
    loaded = new Promise((resolve, reject) => {
      const w = getWorker()
      const onMessage = (e: MessageEvent) => {
        if (e.data.type === 'loaded') { w.removeEventListener('message', onMessage); resolve() }
        else if (e.data.type === 'error') { w.removeEventListener('message', onMessage); reject(new Error(e.data.payload)) }
      }
      w.addEventListener('message', onMessage)
      w.postMessage({ type: 'load' })
    })
  }
  return loaded
}

/** Embeds a batch of texts on-device via a worker-hosted multilingual model. One vector per input text, in the same order. */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  await ensureLoaded()
  const requestId = nextRequestId++
  return new Promise((resolve, reject) => {
    const w = getWorker()
    const onMessage = (e: MessageEvent) => {
      if (!isMatchingResponse(e.data.payload, requestId)) return
      if (e.data.type === 'result') { w.removeEventListener('message', onMessage); resolve(e.data.payload.vecs) }
      else if (e.data.type === 'error') { w.removeEventListener('message', onMessage); reject(new Error(e.data.payload.message)) }
    }
    w.addEventListener('message', onMessage)
    w.postMessage({ type: 'embed', payload: { texts, requestId } })
  })
}
