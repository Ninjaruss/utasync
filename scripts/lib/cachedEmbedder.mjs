/**
 * File-backed embedding cache so pairing audits are deterministic and runnable
 * in CI without the embed model. The cache maps text -> rounded unit vector
 * (see ROUND_DECIMALS); vectors are re-normalized on load so rounding never
 * accumulates. Generate/extend the cache with:
 *   npx tsx scripts/audit-corpus.mjs --pairing --write-embed-cache
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const ROUND_DECIMALS = 4

function renormalize(vec) {
  let norm = 0
  for (const v of vec) norm += v * v
  norm = Math.sqrt(norm)
  if (!(norm > 0)) return vec
  return vec.map((v) => v / norm)
}

function roundVec(vec) {
  const f = 10 ** ROUND_DECIMALS
  return vec.map((v) => Math.round(v * f) / f)
}

/**
 * Wrap an embedTexts-shaped function with a JSON file cache.
 *
 * - `fallback` present: cache misses go to the model and extend the in-memory
 *   cache; call `flush()` to persist (used by --write-embed-cache).
 * - `fallback` absent (CI): a miss throws, pointing at the regen command —
 *   a silently re-downloaded model would make the guard non-deterministic.
 */
export function createCachedEmbedTexts({ cachePath, fallback = null }) {
  const cache = new Map()
  if (existsSync(cachePath)) {
    const raw = JSON.parse(readFileSync(cachePath, 'utf8'))
    for (const [text, vec] of Object.entries(raw)) cache.set(text, renormalize(vec))
  } else if (!fallback) {
    throw new Error(
      `Embedding cache missing at ${cachePath} — generate it with: npx tsx scripts/audit-corpus.mjs --pairing --write-embed-cache`,
    )
  }
  let dirty = false

  async function embedTexts(texts) {
    const missing = texts.filter((t) => !cache.has(t))
    if (missing.length > 0) {
      if (!fallback) {
        throw new Error(
          `Embedding cache miss for ${missing.length} text(s) (first: ${JSON.stringify(missing[0])}) — regenerate with: npx tsx scripts/audit-corpus.mjs --pairing --write-embed-cache`,
        )
      }
      const uniq = [...new Set(missing)]
      const vecs = await fallback(uniq)
      uniq.forEach((t, i) => cache.set(t, renormalize(roundVec(vecs[i]))))
      dirty = true
    }
    return texts.map((t) => cache.get(t))
  }

  function flush() {
    if (!dirty && existsSync(cachePath)) return false
    const out = {}
    for (const [text, vec] of [...cache.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      out[text] = roundVec(vec)
    }
    writeFileSync(cachePath, JSON.stringify(out) + '\n')
    return true
  }

  return { embedTexts, flush, size: () => cache.size }
}
