/**
 * Builds compact JMdict romaji→English gloss data for word pairing.
 *
 * Source: jmdict-simplified (English glosses), streamed line-by-line.
 * Output: public/jmdict-gloss.json — lazy-loaded at runtime; curated
 * overrides in lyricGloss.ts always win. Shape:
 *   { v, source,
 *     romaji: { romaji → gloss },        // word-pairer lemma lookup
 *     kanji:  { surface → romaji },       // word-pairer kanji→romaji bridge
 *     alt:    { romaji → "g1|g2" },       // sparse; secondary senses for pairing
 *     kanjiGloss: { surface → gloss } }   // sparse; tap-popover only. Present
 *   only for surfaces whose own gloss differs from the romaji-collapsed
 *   fallback (homophone collisions). The pairer never reads kanjiGloss.
 *
 * Usage:
 *   node scripts/build-jmdict-gloss.mjs              # full JMdict (eng)
 *   node scripts/build-jmdict-gloss.mjs --common     # common words only (faster/smaller)
 *
 * Requires a cached or downloaded source file under .cache/jmdict/
 */
import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import { toRomaji, toHiragana } from 'wanakana'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const cacheDir = join(root, '.cache/jmdict')
const outPath = join(root, 'public/jmdict-gloss.json')
const readingsOutPath = join(root, 'public/jmdict-readings.json')
const popoverOutPath = join(root, 'public/jmdict-popover.json')

const KANJI_CHAR_RE = /[㐀-鿿]/

const TAG = '3.6.2+20260622163854'
const commonOnly = process.argv.includes('--common')
const assetName = commonOnly
  ? `jmdict-eng-common-${TAG}.json.tgz`
  : `jmdict-eng-${TAG}.json.tgz`
const assetUrl = `https://github.com/scriptin/jmdict-simplified/releases/download/${encodeURIComponent(TAG)}/${assetName}`

const SKIP_POS = new Set(['unc', 'ctr', 'suf', 'pref', 'pn', 'int', 'conj'])
// The popover shows human-readable definitions, where a pronoun sense IS the
// definition: skipping 'pn' made 君 lead with "monarch" instead of "you" and
// 僕 with "manservant" instead of "I; me". The pairer's firstGloss keeps the
// full skip list — pronouns aren't alignable content words.
const POPOVER_SKIP_POS = new Set([...SKIP_POS].filter((p) => p !== 'pn'))
const SKIP_GLOSS_TYPES = new Set(['explanation'])

function kanaToRomaji(text) {
  const hira = toHiragana(text.trim())
  return toRomaji(hira).toLowerCase().replace(/[^a-z0-9'-]/g, '')
}

/**
 * English words carrying no lexical content, which a JMdict gloss frequently
 * leads with. 前's first sense is "in front (of)", so taking the literal first
 * word gave the pairer "in" as the meaning of a noun meaning "front", and the
 * lexical match against a translation's "front" could never fire.
 *
 * Mirrors ENGLISH_FUNCTION_WORDS in src/core/language.ts (kept as a copy because
 * this script is plain node and that module is TypeScript). Negations are
 * deliberately absent: "no one" must not reduce to "one".
 */
const LEADING_FUNCTION_WORDS = new Set([
  'a', 'an', 'the',
  'in', 'on', 'at', 'to', 'from', 'of', 'for', 'with', 'by', 'as', 'into', 'onto',
  'upon', 'about', 'over', 'under', 'between', 'through', 'during',
  'above', 'below', 'up', 'down', 'out', 'off', 'per', 'via', 'than',
  'and', 'or', 'but', 'nor', 'so', 'yet',
  'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'can', 'could', 'shall', 'should', 'may', 'might', 'must',
])

/** First alignable English word from a JMdict gloss string. */
function pickGlossWord(text) {
  if (!text?.trim()) return null
  let g = text.trim()
  if (SKIP_GLOSS_TYPES.has(g)) return null
  g = g.replace(/^\([^)]*\)\s*/, '')
  if (/^to /i.test(g)) g = g.slice(3)
  const word = g.split(/[\s,;/]+/).find((w) => w && /^[a-zA-Z]/.test(w))
  if (!word) return null
  const clean = word.toLowerCase().replace(/[^a-z'-]/g, '')
  if (clean.length < 2 || clean.length > 24) return null
  return clean
}

/**
 * Like pickGlossWord, but skips leading function words to reach the word that
 * carries the sense: 前's first sense is "in front (of)", whose literal first
 * word is "in".
 *
 * Used ONLY for the secondary-sense list. The primary map is deliberately left
 * on pickGlossWord so it stays byte-identical — changing it was measured to
 * re-route an unrelated line (なくなった "disappeared" → "you"), and the
 * secondary list already makes the real sense reachable.
 *
 * Falls back to the literal first word so an entry that genuinely means a
 * function word keeps it (だけど → "but").
 */
function pickAltGlossWord(text) {
  if (!text?.trim()) return null
  let g = text.trim()
  if (SKIP_GLOSS_TYPES.has(g)) return null
  g = g.replace(/^\([^)]*\)\s*/, '')
  if (/^to /i.test(g)) g = g.slice(3)
  const words = []
  for (const raw of g.split(/[\s,;/]+/)) {
    if (!raw || !/^[a-zA-Z]/.test(raw)) continue
    const clean = raw.toLowerCase().replace(/[^a-z'-]/g, '')
    if (clean.length < 2 || clean.length > 24) continue
    words.push(clean)
  }
  if (!words.length) return null
  return words.find((w) => !LEADING_FUNCTION_WORDS.has(w)) ?? words[0]
}

/** A single readable definition line, trimmed of JMdict qualifiers and capped. */
function cleanGloss(text) {
  if (!text?.trim()) return null
  let g = text.trim()
  if (SKIP_GLOSS_TYPES.has(g)) return null
  // Drop a leading qualifier like "(usu. in kana)" that isn't part of the meaning.
  g = g.replace(/^\([^)]*\)\s*/, '').trim()
  if (!g) return null
  if (g.length > 60) g = g.slice(0, 60).trim()
  return g
}

/**
 * Full first-sense definition for the tap-lookup popover: up to 3 gloss lines of
 * the first usable sense, joined "; " (the popover splits on ";"). Unlike
 * firstGloss (one alignable word for the pairer), this preserves the readable
 * definition — "past; bygone days", not "the".
 */
function fullGloss(senses) {
  const collect = (requireContentPos) => {
    for (const sense of senses ?? []) {
      const pos = sense.partOfSpeech ?? []
      if (requireContentPos && pos.some((p) => POPOVER_SKIP_POS.has(p))) continue
      const items = []
      for (const g of sense.gloss ?? []) {
        if (g.lang && g.lang !== 'eng') continue
        const c = cleanGloss(g.text)
        if (c) items.push(c)
        if (items.length >= 3) break
      }
      if (items.length) return items.join('; ')
    }
    return null
  }
  return collect(true) ?? collect(false)
}

function firstGloss(senses) {
  for (const sense of senses ?? []) {
    const pos = sense.partOfSpeech ?? []
    if (pos.some((p) => SKIP_POS.has(p))) continue
    for (const g of sense.gloss ?? []) {
      if (g.lang && g.lang !== 'eng') continue
      const w = pickGlossWord(g.text)
      if (w) return w
    }
  }
  for (const sense of senses ?? []) {
    for (const g of sense.gloss ?? []) {
      if (g.lang && g.lang !== 'eng') continue
      const w = pickGlossWord(g.text)
      if (w) return w
    }
  }
  return null
}

/** How many distinct sense-leading words to keep per key (see `alt` below). */
const MAX_ALT_GLOSSES = 2

/**
 * One leading content word per SENSE, deduped and capped.
 *
 * The pairer stores a single gloss per key, so a word with several senses can
 * only ever match one English word: 前's winning sense is "in front (of)" →
 * "front", which makes the temporal "before" unreachable, and a curated entry
 * pinning "before" makes "front" unreachable in turn. Either way a translation
 * using the other sense finds no lexical match and the token drops to embedding
 * noise (前 → "Far").
 *
 * The entry's own primary is deliberately INCLUDED rather than excluded: the
 * gloss that wins at runtime may be a curated override rather than this entry's
 * first sense, so the list has to stand on its own.
 */
function altGlossWords(senses) {
  const out = []
  const seen = new Set()
  for (const sense of senses ?? []) {
    const pos = sense.partOfSpeech ?? []
    if (pos.some((p) => SKIP_POS.has(p))) continue
    for (const g of sense.gloss ?? []) {
      if (g.lang && g.lang !== 'eng') continue
      const w = pickAltGlossWord(g.text)
      if (!w || seen.has(w)) continue
      seen.add(w)
      out.push(w)
      break // one word per sense — synonyms within a sense add no coverage
    }
    if (out.length >= MAX_ALT_GLOSSES) break
  }
  return out
}

function entryScore(word) {
  let score = 0
  if (word.kana?.some((k) => k.common)) score += 4
  if (word.kanji?.some((k) => k.common)) score += 2
  return score
}

function isCommonEntry(word) {
  return word.kana?.some((k) => k.common) || word.kanji?.some((k) => k.common)
}

function shouldReplace(existing, gloss, score) {
  if (!existing) return true
  if (score > existing.score) return true
  if (score < existing.score) return false
  // Prefer shorter single-word glosses for alignment matching.
  return gloss.length < existing.gloss.length
}

async function ensureSourceJson() {
  mkdirSync(cacheDir, { recursive: true })
  const candidates = commonOnly
    ? [
        join(cacheDir, `jmdict-eng-common-${TAG}.json`),
        join(cacheDir, 'jmdict-eng-common-3.6.2.json'),
      ]
    : [
        join(cacheDir, `jmdict-eng-${TAG}.json`),
        join(cacheDir, 'jmdict-eng-3.6.2.json'),
      ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }

  const tgzPath = join(cacheDir, assetName)
  if (!existsSync(tgzPath)) {
    console.log(`Downloading ${assetUrl} ...`)
    execSync(`curl -fsSL -o "${tgzPath}" "${assetUrl}"`, { stdio: 'inherit' })
  }
  console.log('Extracting...')
  execSync(`tar -xzf "${tgzPath}" -C "${cacheDir}"`, { stdio: 'inherit' })
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  throw new Error(`No jmdict JSON found in ${cacheDir} after extract`)
}

/** Kana forms applicable to a given kanji surface (JMdict appliesToKanji). */
function kanaFormsFor(word, surface) {
  return (word.kana ?? []).filter((kr) => {
    const applies = kr.appliesToKanji ?? ['*']
    return applies.includes('*') || applies.includes(surface)
  })
}

async function processFile(jsonPath) {
  const romaji = new Map()
  const kanji = new Map()
  // Popover dictionary: kanji surface → Map<hiragana reading, { g, score }>. One
  // entry per homograph reading (辛い: からい / つらい) so the tap popover can
  // disambiguate by the token's reading. Holds the FULL first-sense definition,
  // not the pairer's single word. Read only by the popover.
  const popover = new Map()
  // surface → { common: Set<hiragana>, uncommon: Set<hiragana> } across ALL
  // entries sharing the surface (角 collects かど, かく, つの from 3 entries).
  const readings = new Map()
  let lines = 0
  let entries = 0

  const input = createReadStream(jsonPath, { encoding: 'utf8' })

  const rl = createInterface({ input, crlfDelay: Infinity })
  let inWords = false

  for await (const line of rl) {
    lines++
  const trimmed = line.trim()
    if (!inWords) {
      if (trimmed === '"words": [' || trimmed.endsWith('"words": [')) inWords = true
      continue
    }
    if (trimmed === ']' || trimmed === '],') break
    if (!trimmed.startsWith('{')) continue

    const jsonLine = trimmed.endsWith(',') ? trimmed.slice(0, -1) : trimmed
    let word
    try {
      word = JSON.parse(jsonLine)
    } catch {
      continue
    }
    entries++

    // Reading inventory — collected before any gloss/common filtering so every
    // entry contributes its legitimate readings (used to validate sung readings).
    for (const k of word.kanji ?? []) {
      const surface = k.text?.trim()
      if (!surface || surface.length > 8 || !KANJI_CHAR_RE.test(surface)) continue
      for (const kr of kanaFormsFor(word, surface)) {
        const reading = toHiragana(kr.text?.trim() ?? '')
        if (!reading) continue
        let buckets = readings.get(surface)
        if (!buckets) {
          buckets = { common: new Set(), uncommon: new Set() }
          readings.set(surface, buckets)
        }
        if (kr.common) {
          buckets.common.add(reading)
          buckets.uncommon.delete(reading)
        } else if (!buckets.common.has(reading)) {
          buckets.uncommon.add(reading)
        }
      }
    }

    if (commonOnly && !isCommonEntry(word)) continue

    const gloss = firstGloss(word.sense)
    if (!gloss) continue
    const score = entryScore(word)

    // Popover: store the full first-sense definition per kanji surface + reading.
    const popoverDef = fullGloss(word.sense)
    if (popoverDef) {
      for (const k of word.kanji ?? []) {
        const surface = k.text?.trim()
        if (!surface || surface.length > 8 || !KANJI_CHAR_RE.test(surface)) continue
        const forms = kanaFormsFor(word, surface)
        const commonForms = forms.filter((kr) => kr.common)
        for (const kr of commonForms.length ? commonForms : forms) {
          const reading = toHiragana(kr.text?.trim() ?? '')
          if (!reading) continue
          let byReading = popover.get(surface)
          if (!byReading) {
            byReading = new Map()
            popover.set(surface, byReading)
          }
          const prev = byReading.get(reading)
          // Higher-scored (common) entry wins a given surface+reading.
          if (!prev || score > prev.score) byReading.set(reading, { g: popoverDef, score })
        }
      }

      // Kana headwords too: kana-written lyric tokens (この, これ, とりわけ)
      // never match a kanji surface, so without kana keys they fell through to
      // the pairer's romaji homophone chain, which collapses across entries
      // (この → 九 "nine" via its rare この reading). Restricted to common
      // entries to keep the artifact small. Homophones share one kana key, so
      // ranking decides what a kana-written token shows: kana-NATIVE entries
      // (usually-kana "uk" tag, or no kanji form at all) own their kana keys —
      // 此処 "here" must beat 個々 "individual" for ここ — with a pronoun
      // nudge to settle non-uk ties the way songs use them (きみ → 君 "you",
      // not 黄身 "egg yolk"). 九's この isn't a common form, so it never gets
      // keyed at all. Keys keep JMdict's own script — katakana loanwords stay
      // katakana, matching kuromoji surfaces/baseForms.
      if (isCommonEntry(word)) {
        const kanaNative =
          !(word.kanji?.length) || (word.sense ?? []).some((s) => (s.misc ?? []).includes('uk'))
        const pos0 = word.sense?.[0]?.partOfSpeech ?? []
        // Kana-key score, from scratch (NOT entryScore): a common KANJI form
        // means the word is normally written in kanji — it makes the entry a
        // weaker owner of a kana key, so only kana-common counts here (君 "you"
        // must beat 黄身 "egg yolk" for きみ). Pronoun and adverb first senses
        // are conventionally kana-written even without the uk tag (きみ, いま
        // "now" over 居間 "living room"); an aux-v sense marks a core
        // grammaticalized verb (居る, owner of いる, over 要る).
        const kanaScore =
          (word.kana?.some((k) => k.common) ? 4 : 0) +
          (kanaNative ? 8 : 0) +
          (pos0.includes('pn') ? 2 : 0) +
          (pos0.includes('adv') ? 1 : 0) +
          ((word.sense ?? []).some((s) => (s.partOfSpeech ?? []).includes('aux-v')) ? 2 : 0)
        const forms = (word.kana ?? []).filter(
          // sk = search-only, ok = outdated, ik = irregular: never display keys.
          (kr) => !(kr.tags ?? []).some((t) => t === 'sk' || t === 'ok' || t === 'ik'),
        )
        const commonForms = forms.filter((kr) => kr.common)
        for (const kr of commonForms.length ? commonForms : forms) {
          const kanaKey = kr.text?.trim()
          if (!kanaKey || kanaKey.length > 12) continue
          const reading = toHiragana(kanaKey)
          let byReading = popover.get(kanaKey)
          if (!byReading) {
            byReading = new Map()
            popover.set(kanaKey, byReading)
          }
          const prev = byReading.get(reading)
          if (!prev || kanaScore > prev.score) byReading.set(reading, { g: popoverDef, score: kanaScore })
        }
      }
    }

    for (const k of word.kana ?? []) {
      const r = kanaToRomaji(k.text)
      if (r.length < 2) continue
      const prev = romaji.get(r)
      if (shouldReplace(prev, gloss, score)) romaji.set(r, { gloss, score, alt: altGlossWords(word.sense) })
    }

    for (const k of word.kanji ?? []) {
      const surface = k.text?.trim()
      if (!surface || surface.length > 8) continue
      for (const kr of word.kana ?? []) {
        const r = kanaToRomaji(kr.text)
        if (r.length < 2) continue
        const prev = kanji.get(surface)
        // Track the winning entry's own gloss alongside its romaji so the
        // popover can show a surface-specific definition instead of the
        // romaji-collapsed one (see the sparse kanjiGloss map below).
        if (!prev || score >= prev.score) kanji.set(surface, { romaji: r, score, gloss })
        break
      }
    }

    if (entries % 25000 === 0) {
      process.stdout.write(`\r  ${entries} entries, ${romaji.size} romaji keys...`)
    }
  }

  // Sparse surface→gloss map for the tap-lookup popover. A kanji surface's own
  // gloss is stored ONLY when it differs from what the romaji fallback would
  // return for that surface's romaji key — i.e. only for homophone-collided
  // surfaces (億/置く both romanize "oku"; without this 億 would inherit 置く's
  // "put"). This keeps the map small and leaves the romaji/kanji maps (read by
  // the word pairer) byte-identical. The pairer ignores kanjiGloss entirely.
  const kanjiGloss = Object.fromEntries(
    [...kanji.entries()].flatMap(([surface, v]) => {
      const romajiGloss = romaji.get(v.romaji)?.gloss
      return v.gloss && v.gloss !== romajiGloss ? [[surface, v.gloss]] : []
    }),
  )
  // Popover entries: readings sorted by score (common first) so the popover leads
  // with the primary sense when the token reading doesn't pin a specific homograph.
  const popoverEntries = Object.fromEntries(
    [...popover.entries()].map(([surface, byReading]) => [
      surface,
      [...byReading.entries()]
        .sort((a, b) => b[1].score - a[1].score)
        .map(([r, v]) => ({ r, g: v.g })),
    ]),
  )
  console.log(
    `\nProcessed ${entries} entries → ${romaji.size} romaji, ${kanji.size} kanji, ` +
      `${Object.keys(kanjiGloss).length} kanji glosses, ${Object.keys(popoverEntries).length} popover surfaces, ` +
      `${readings.size} reading surfaces`,
  )
  return {
    v: 1,
    source: commonOnly ? 'jmdict-eng-common' : 'jmdict-eng',
    romaji: Object.fromEntries([...romaji.entries()].map(([k, v]) => [k, v.gloss])),
    // Sparse secondary senses, "|"-joined. Only keys whose entry carries a sense
    // beyond the one already stored in `romaji` appear, so this adds nothing for
    // the single-sense majority.
    alt: Object.fromEntries(
      [...romaji.entries()].flatMap(([k, v]) => {
        const senses = v.alt ?? []
        // Emit only when the entry means something beyond the stored gloss, but
        // emit the FULL list including that gloss: the value returned at runtime
        // may be a curated override (mae → "before"), which would otherwise make
        // this entry's own primary sense ("front") unreachable.
        return senses.some((w) => w !== v.gloss) ? [[k, senses.join('|')]] : []
      }),
    ),
    kanji: Object.fromEntries([...kanji.entries()].map(([k, v]) => [k, v.romaji])),
    kanjiGloss,
    popover: popoverEntries,
    readings: Object.fromEntries(
      [...readings.entries()].map(([surface, b]) => {
        const common = [...b.common].join(',')
        const uncommon = [...b.uncommon].join(',')
        // "common1,common2|uncommon1"; no pipe when all common, leading pipe when none.
        return [surface, uncommon ? `${common}|${uncommon}` : common]
      }),
    ),
  }
}

async function main() {
  const jsonPath = await ensureSourceJson()
  console.log(`Building gloss from ${jsonPath} ...`)
  const data = await processFile(jsonPath)

  const altJson = JSON.stringify(data.alt)
  const romajiJson = JSON.stringify(data.romaji)
  const kanjiJson = JSON.stringify(data.kanji)
  const kanjiGlossJson = JSON.stringify(data.kanjiGloss)
  const payload = `{"v":1,"source":"${data.source}","romaji":${romajiJson},"kanji":${kanjiJson},"kanjiGloss":${kanjiGlossJson},"alt":${altJson}}`
  writeFileSync(outPath, payload)

  const mb = (Buffer.byteLength(payload) / 1024 / 1024).toFixed(2)
  console.log(
    `Wrote ${outPath} (${mb} MB, ${Object.keys(data.romaji).length} romaji, ` +
      `${Object.keys(data.kanjiGloss).length} kanji-gloss entries)`,
  )

  const readingsPayload = `{"v":1,"source":"${data.source}","readings":${JSON.stringify(data.readings)}}`
  writeFileSync(readingsOutPath, readingsPayload)
  const rmb = (Buffer.byteLength(readingsPayload) / 1024 / 1024).toFixed(2)
  console.log(`Wrote ${readingsOutPath} (${rmb} MB, ${Object.keys(data.readings).length} surfaces)`)

  const popoverPayload = `{"v":1,"source":"${data.source}","entries":${JSON.stringify(data.popover)}}`
  writeFileSync(popoverOutPath, popoverPayload)
  const pmb = (Buffer.byteLength(popoverPayload) / 1024 / 1024).toFixed(2)
  console.log(`Wrote ${popoverOutPath} (${pmb} MB, ${Object.keys(data.popover).length} surfaces)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
