/** Cache/dedup key: lowercase ASCII words collapse case; CJK surfaces stay as-is. */
export function embedCacheKey(text: string): string {
  const trimmed = text.trim()
  // eslint-disable-next-line no-control-regex -- \x00-\x7F is an ASCII range check, not a control char
  if (/^[\x00-\x7F]+$/.test(trimmed)) return trimmed.toLowerCase()
  return trimmed
}

/**
 * Collapses duplicate texts so the embedder runs once per unique string.
 * `indexMap[i]` is the index into `unique` for the i-th input text.
 */
export function dedupeTexts(texts: string[]): { unique: string[]; indexMap: number[] } {
  const keyToIndex = new Map<string, number>()
  const unique: string[] = []
  const indexMap: number[] = []
  for (const text of texts) {
    const key = embedCacheKey(text)
    let idx = keyToIndex.get(key)
    if (idx === undefined) {
      idx = unique.length
      keyToIndex.set(key, idx)
      unique.push(text)
    }
    indexMap.push(idx)
  }
  return { unique, indexMap }
}

/** Expands per-unique vectors back to the original text order. */
export function expandVectors(uniqueVecs: number[][], indexMap: number[]): number[][] {
  return indexMap.map((i) => uniqueVecs[i])
}
