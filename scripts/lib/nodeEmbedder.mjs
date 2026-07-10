/**
 * Direct (non-worker) loader for the same multilingual embedding model used in
 * production (src/ai-pipeline/textEmbed.worker.ts), for running real-model audits
 * from Node. The app's textEmbedder.ts requires a browser Worker, which isn't
 * available outside the browser — this mirrors its embed logic without it.
 */
import { pipeline, env } from '@huggingface/transformers'

env.allowLocalModels = false
env.useBrowserCache = false

const EMBED_MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2'
const EMBED_CHUNK = 24

let extractorPromise = null

function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = pipeline('feature-extraction', EMBED_MODEL, { dtype: 'q8' })
  }
  return extractorPromise
}

/** Same shape as src/ai-pipeline/textEmbedder.ts embedTexts: one normalized vector per text, in order. */
export async function embedTexts(texts) {
  if (texts.length === 0) return []
  const extractor = await getExtractor()
  const vecs = []
  for (let start = 0; start < texts.length; start += EMBED_CHUNK) {
    const chunk = texts.slice(start, start + EMBED_CHUNK)
    const output = await extractor(chunk, { pooling: 'mean', normalize: true })
    const dim = output.dims[1]
    for (let i = 0; i < chunk.length; i++) {
      vecs.push(Array.from(output.data.slice(i * dim, (i + 1) * dim)))
    }
  }
  return vecs
}
