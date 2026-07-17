/** Pure helpers for the reverse (English→Japanese) JMdict index. No I/O. */

const ARTICLE_RE = /^(?:a|an|the)\s+/i

/** Normalized single-word gloss key, or null if the gloss is multi-word/junk. */
export function singleWordGlossKey(text) {
  if (!text) return null
  let g = text.trim()
  g = g.replace(/^\([^)]*\)\s*/, '') // leading "(vulgar) "
  g = g.replace(ARTICLE_RE, '')
  if (/^to\s+/i.test(g)) g = g.slice(3)
  g = g.trim()
  if (!g || /\s/.test(g)) return null // must be a single token after stripping
  const clean = g.toLowerCase().replace(/[^a-z'-]/g, '')
  if (clean.length < 2 || clean.length > 24) return null
  return clean
}

/** Representative headword: first common kanji → first kanji → first common kana → first kana. */
export function headwordFor(word) {
  const kanji = word.kanji ?? []
  const kana = word.kana ?? []
  const commonKanji = kanji.find((k) => k.common)
  if (commonKanji) return commonKanji.text
  if (kanji[0]) return kanji[0].text
  const commonKana = kana.find((k) => k.common)
  if (commonKana) return commonKana.text
  return kana[0]?.text ?? null
}

/** Representative reading: first common kana → first kana. Null when the headword is itself kana. */
export function readingFor(word, headword) {
  const kana = word.kana ?? []
  const reading = (kana.find((k) => k.common) ?? kana[0])?.text ?? null
  return reading && reading !== headword ? reading : null
}

function entryScore(word) {
  let s = 0
  if ((word.kana ?? []).some((k) => k.common)) s += 4
  if ((word.kanji ?? []).some((k) => k.common)) s += 2
  return s
}

/** Build { enWord → [{w, r}] } from an array of JMdict word entries. */
export function reverseIndex(words, { cap = 6 } = {}) {
  // enWord → Map<headword, {w, r, score}>
  const acc = new Map()
  for (const word of words) {
    const w = headwordFor(word)
    if (!w) continue
    const r = readingFor(word, w)
    const score = entryScore(word)
    const keys = new Set()
    for (const sense of word.sense ?? []) {
      for (const g of sense.gloss ?? []) {
        if (g.lang && g.lang !== 'eng') continue
        const key = singleWordGlossKey(g.text)
        if (key) keys.add(key)
      }
    }
    for (const key of keys) {
      let bucket = acc.get(key)
      if (!bucket) { bucket = new Map(); acc.set(key, bucket) }
      const prev = bucket.get(w)
      if (!prev || score > prev.score) bucket.set(w, { w, r, score })
    }
  }
  const out = {}
  for (const [key, bucket] of [...acc.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const ranked = [...bucket.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, cap)
      .map(({ w, r }) => ({ w, r }))
    out[key] = ranked
  }
  return out
}
