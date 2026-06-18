let worker: Worker | null = null
let loaded: Promise<void> | null = null

function getWorker(): Worker {
  if (!worker) worker = new Worker(new URL('./textEmbed.worker.ts', import.meta.url), { type: 'module' })
  return worker
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
  return new Promise((resolve, reject) => {
    const w = getWorker()
    const onMessage = (e: MessageEvent) => {
      if (e.data.type === 'result') { w.removeEventListener('message', onMessage); resolve(e.data.payload) }
      else if (e.data.type === 'error') { w.removeEventListener('message', onMessage); reject(new Error(e.data.payload)) }
    }
    w.addEventListener('message', onMessage)
    w.postMessage({ type: 'embed', payload: { texts } })
  })
}
