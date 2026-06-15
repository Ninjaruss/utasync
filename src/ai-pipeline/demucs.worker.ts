/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web'

let session: ort.InferenceSession | null = null

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data

  if (type === 'load') {
    self.postMessage({ type: 'progress', payload: { status: 'loading', progress: 0 } })
    session = await ort.InferenceSession.create('/models/demucs-v1.onnx', {
      executionProviders: ['webgpu', 'wasm'],
    })
    self.postMessage({ type: 'loaded' })
    return
  }

  if (type === 'separate') {
    if (!session) { self.postMessage({ type: 'error', payload: 'Model not loaded' }); return }
    const { audioData } = payload as { audioData: Float32Array }

    const inputTensor = new ort.Tensor('float32', audioData, [1, 1, audioData.length])
    const feeds: Record<string, ort.Tensor> = { input: inputTensor }
    const results = await session.run(feeds)

    const vocalsData = results[Object.keys(results)[0]].data as Float32Array
    self.postMessage({ type: 'result', payload: vocalsData }, [vocalsData.buffer])
  }
}
