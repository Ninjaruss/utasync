/** Pure parsers for WordNet definition data. No I/O. */

const HAS_JA = /[぀-ヿ一-鿿々]/

/** Parse one Princeton `data.*` line → { words, definition } or null for non-data lines. */
export function parseWordnetDataLine(line) {
  if (!/^\d{8}\s/.test(line)) return null // data lines start with an 8-digit offset
  const bar = line.indexOf(' | ')
  if (bar < 0) return null
  const head = line.slice(0, bar).trim().split(/\s+/)
  // head: offset lex_filenum ss_type w_cnt [word lex_id]...
  const wCnt = parseInt(head[3], 16)
  const words = []
  for (let i = 0; i < wCnt; i++) {
    const w = head[4 + i * 2]
    if (!w) break
    words.push(w.replace(/\([apr]\)$/, '').replace(/_/g, ' ').toLowerCase())
  }
  const gloss = line.slice(bar + 3)
  // Definition = gloss up to the first "; \"" (start of an example), else whole gloss.
  const exIdx = gloss.indexOf('; "')
  const definition = (exIdx >= 0 ? gloss.slice(0, exIdx) : gloss).trim()
  return { words, definition }
}

/** Parse one `wnjpn-def.tab` line → { synset, def } (def kept verbatim). */
export function parseWnjaDefLine(line) {
  const parts = line.split('\t')
  return { synset: parts[0], def: parts[parts.length - 1]?.trim() ?? '' }
}

/** Join `wnjpn-ok.tab` lemma lines with parsed defs → { lemma → [jaDef] }, JA-only, capped. */
export function indexWnjaDefs(okLines, parsedDefs, { cap = 3 } = {}) {
  const synsetDef = new Map()
  for (const { synset, def } of parsedDefs) {
    if (!def || !HAS_JA.test(def)) continue // Japanese-script definitions only
    if (!synsetDef.has(synset)) synsetDef.set(synset, def)
  }
  const out = Object.create(null) // avoid Object.prototype key collisions (e.g. lemma "constructor")
  for (const line of okLines) {
    const [synset, lemma] = line.split('\t')
    const def = synsetDef.get(synset)
    if (!synset || !lemma || !def) continue
    const bucket = (out[lemma] ??= [])
    if (bucket.length < cap && !bucket.includes(def)) bucket.push(def)
  }
  return out
}

/** Build { word → [definition] } from Princeton data lines, capped. */
export function indexEnDefs(dataLines, { cap = 3 } = {}) {
  const out = Object.create(null) // avoid Object.prototype key collisions (e.g. word "constructor")
  for (const line of dataLines) {
    const parsed = parseWordnetDataLine(line)
    if (!parsed || !parsed.definition) continue
    for (const w of parsed.words) {
      const bucket = (out[w] ??= [])
      if (bucket.length < cap && !bucket.includes(parsed.definition)) bucket.push(parsed.definition)
    }
  }
  return out
}
