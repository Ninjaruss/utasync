/**
 * Builds compact JMdict romaji→English gloss data for word pairing.
 *
 * Source: jmdict-simplified (English glosses), streamed line-by-line.
 * Output: public/jmdict-gloss.json — lazy-loaded at runtime; curated
 * overrides in lyricGloss.ts always win. Shape:
 *   { v, source,
 *     romaji: { romaji → gloss },        // word-pairer lemma lookup
 *     kanji:  { surface → romaji },       // word-pairer kanji→romaji bridge
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

const KANJI_CHAR_RE = /[㐀-鿿]/

const TAG = '3.6.2+20260622163854'
const commonOnly = process.argv.includes('--common')
const assetName = commonOnly
  ? `jmdict-eng-common-${TAG}.json.tgz`
  : `jmdict-eng-${TAG}.json.tgz`
const assetUrl = `https://github.com/scriptin/jmdict-simplified/releases/download/${encodeURIComponent(TAG)}/${assetName}`

const SKIP_POS = new Set(['unc', 'ctr', 'suf', 'pref', 'pn', 'int', 'conj'])
const SKIP_GLOSS_TYPES = new Set(['explanation'])

function kanaToRomaji(text) {
  const hira = toHiragana(text.trim())
  return toRomaji(hira).toLowerCase().replace(/[^a-z0-9'-]/g, '')
}

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

    for (const k of word.kana ?? []) {
      const r = kanaToRomaji(k.text)
      if (r.length < 2) continue
      const prev = romaji.get(r)
      if (shouldReplace(prev, gloss, score)) romaji.set(r, { gloss, score })
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
  console.log(
    `\nProcessed ${entries} entries → ${romaji.size} romaji, ${kanji.size} kanji, ` +
      `${Object.keys(kanjiGloss).length} kanji glosses, ${readings.size} reading surfaces`,
  )
  return {
    v: 1,
    source: commonOnly ? 'jmdict-eng-common' : 'jmdict-eng',
    romaji: Object.fromEntries([...romaji.entries()].map(([k, v]) => [k, v.gloss])),
    kanji: Object.fromEntries([...kanji.entries()].map(([k, v]) => [k, v.romaji])),
    kanjiGloss,
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

  const romajiJson = JSON.stringify(data.romaji)
  const kanjiJson = JSON.stringify(data.kanji)
  const kanjiGlossJson = JSON.stringify(data.kanjiGloss)
  const payload = `{"v":1,"source":"${data.source}","romaji":${romajiJson},"kanji":${kanjiJson},"kanjiGloss":${kanjiGlossJson}}`
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
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
