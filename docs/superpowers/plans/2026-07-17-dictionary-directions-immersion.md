# Dictionary — Active-Line Gate + Bidirectional + Immersion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restrict tap-to-look-up to the active lyric line, add English→Japanese lookup on translation words (reverse JMdict), and add an optional immersion mode that shows monolingual definitions (JA→JA via Japanese WordNet, EN→EN via Princeton WordNet).

**Architecture:** New data lives in three lazy-loaded, committed JSON files built by deterministic Node scripts; new runtime resolvers mirror the existing `jmdictGloss.ts` loader; the popover UI is split into a shared `LookupPopoverShell` (positioning + dismiss + close + external link) with two thin bodies (JA, EN). The word pairer and the existing JA→EN gloss path are never touched, so the corpus pairing baseline stays byte-identical.

**Tech Stack:** TypeScript, React, Zustand (settings), Vitest + @testing-library/react, Node ESM build scripts, JMdict (jmdict-simplified), Princeton WordNet (`wordnet-db` npm), Japanese WordNet 1.1 (tab files).

**Spec:** `docs/superpowers/specs/2026-07-17-dictionary-directions-immersion-design.md`

**Reference facts (verified):**
- Loader pattern to mirror: `src/ai-pipeline/jmdictGloss.ts` (fetch-once, `loadPromise`, `lastLoadFailureAt` backoff, `xLoaded()`, `resetXForTests`, `setXForTests`).
- Build-script pattern to mirror: `scripts/build-jmdict-gloss.mjs` (streams `.cache/jmdict/jmdict-eng-3.6.2.json`; `word.kanji[]`/`word.kana[]` each `{text, common, appliesToKanji}`; `word.sense[].gloss[]` each `{lang, text}`).
- Translation words are produced by `splitTranslationLines(text): string[][]` in `src/language/wordColors.ts` — already whitespace-split and stripped of leading/trailing non-letter/number.
- Settings: `src/payment/SettingsStore.ts` (zustand `persist`), `UserSettings` in `src/core/types/index.ts`, `SettingToggle` component in `src/settings/SettingsView.tsx`.
- Tests run with `npx vitest run <path>`. Resolver tests inject data via `setJmdictGlossForTests`; popover/LyricDisplay tests `vi.mock` `lookupWord`.
- `wordnet-db` exposes a `path` to a `dict/` dir with `data.noun|verb|adj|adv`. A `data.*` line: `offset lex_filenum ss_type w_cnt word lex_id [word lex_id …] p_cnt … | gloss`; gloss (definition, then `; "example"`) is the text after ` | `.
- Japanese WordNet tab files: `wnjpn-ok.tab` = `offset-pos⇥lemma⇥tag`; `wnjpn-def.tab` = `offset-pos⇥subid⇥definition` (contains both English and Japanese defs → select Japanese by script detection). JA data is BSD-like; ship the license.

---

## File structure

**Phase 1 (gate + EN→JA):**
- Modify: `src/lyrics/LyricDisplay.tsx` — active-line gate, EN tap wiring, unified tap state.
- Create: `scripts/lib/enjaDict.mjs` — pure reverse-index helpers (testable).
- Create: `scripts/build-enja-dict.mjs` — streams JMdict → `public/enja-dict.json`.
- Create: `public/enja-dict.json` — generated, committed.
- Create: `src/language/english/enjaDict.ts` — lazy loader/accessor.
- Create: `src/language/english/wordLookupEn.ts` — `lookupEnglishWord` + normalize/stem.
- Create: `src/lyrics/LookupPopoverShell.tsx` — shared shell.
- Modify: `src/lyrics/WordLookupPopover.tsx` — render JA body inside the shell (props unchanged).
- Create: `src/lyrics/EnglishWordLookupPopover.tsx` — EN body.
- Modify: `src/lyrics/LyricDisplay.tsx` (`ColoredTranslation`) — tappable translation words.
- Modify: `src/settings/SettingsView.tsx` — tap-lookup description mentions both languages.
- Tests: `tests/scripts/enjaDict.test.ts`, `tests/language/english/wordLookupEn.test.ts`, `tests/lyrics/LookupPopoverShell.test.tsx`, `tests/lyrics/EnglishWordLookupPopover.test.tsx`, additions to `tests/lyrics/LyricDisplay.test.tsx`.

**Phase 2 (immersion):**
- Modify: `src/core/types/index.ts`, `src/payment/SettingsStore.ts` — `immersionDefinitions`.
- Create: `scripts/lib/wordnetDefs.mjs` — pure parse helpers.
- Create: `scripts/build-wordnet-defs.mjs` — emits `public/en-def.json` + `public/wnja-def.json`.
- Create: `public/en-def.json`, `public/wnja-def.json` — generated, committed.
- Create: `public/licenses/WORDNET-LICENSE.txt`, `public/licenses/JAPANESE-WORDNET-LICENSE.txt`.
- Create: `src/language/english/enDict.ts`, `src/language/japanese/jaMonolingual.ts` — loaders.
- Modify: `src/language/english/wordLookupEn.ts` — EN→EN immersion branch.
- Modify: `src/language/japanese/wordLookup.ts` — JA→JA immersion branch + `definitionLang`.
- Modify: `src/lyrics/WordLookupPopover.tsx`, `src/lyrics/EnglishWordLookupPopover.tsx` — read setting, immersion rendering + external link.
- Modify: `src/settings/SettingsView.tsx` — immersion toggle.
- Tests: `tests/scripts/wordnetDefs.test.ts`, `tests/language/english/enDict.test.ts`, `tests/language/japanese/jaMonolingual.test.ts`, additions to resolver/popover/settings tests.

---

# PHASE 1 — Active-line gate + English→Japanese

## Task 1: Restrict Japanese lookup to the active line (Request 1)

**Files:**
- Modify: `src/lyrics/LyricDisplay.tsx:384`
- Test: `tests/lyrics/LyricDisplay.test.tsx`

- [ ] **Step 1: Write the failing tests** — append inside the existing `describe('tap-to-look-up wiring', …)` block in `tests/lyrics/LyricDisplay.test.tsx`:

```tsx
  it('does not open the popover for a word on a non-active line; it seeks instead', () => {
    useLyricsStore.setState({
      lines: [
        { original: '一行目', startTime: 0, endTime: 2, translation: '',
          tokens: [{ surface: '一行目', reading: 'イチギョウメ', pos: '名詞', startIndex: 0, endIndex: 3 }] },
        { original: '躱し', startTime: 2, endTime: 4, translation: '',
          tokens: [{ surface: '躱し', reading: 'カワシ', pos: '動詞', baseForm: '躱す', startIndex: 0, endIndex: 2 }] },
      ],
      activeLine: 0, furiganaMode: 'none', showTranslation: false, lyricsLayout: 'stacked',
    })
    const onLineClick = vi.fn()
    render(<LyricDisplay onLineClick={onLineClick} />)
    fireEvent.click(screen.getByText('躱し')) // word on the NON-active (second) line
    expect(onLineClick).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/lyrics/LyricDisplay.test.tsx -t "non-active line"`
Expected: FAIL — a dialog opens and `onLineClick` is not called (word tap currently intercepts on every line).

- [ ] **Step 3: Implement the gate** — in `src/lyrics/LyricDisplay.tsx`, change the `onWordTap` prop passed to `Line` (currently line ~384):

```tsx
            onWordTap={tapLookupEnabled && isActive ? setWordTap : undefined}
```

- [ ] **Step 4: Run the tap tests to verify pass**

Run: `npx vitest run tests/lyrics/LyricDisplay.test.tsx -t "tap-to-look-up"`
Expected: PASS — the new non-active test passes and the existing active-line tap tests (all single-line, `activeLine: 0`) stay green.

- [ ] **Step 5: Commit**

```bash
git add src/lyrics/LyricDisplay.tsx tests/lyrics/LyricDisplay.test.tsx
git commit -m "fix(lookup): only open the dictionary on the active lyric line"
```

---

## Task 2: Reverse-JMdict build — pure helpers + `enja-dict.json`

**Files:**
- Create: `scripts/lib/enjaDict.mjs`
- Create: `scripts/build-enja-dict.mjs`
- Create: `public/enja-dict.json` (generated)
- Test: `tests/scripts/enjaDict.test.ts`
- Modify: `package.json` (add `build:enja` script)

- [ ] **Step 1: Write the failing test** — `tests/scripts/enjaDict.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { singleWordGlossKey, reverseIndex } from '../../scripts/lib/enjaDict.mjs'

describe('singleWordGlossKey', () => {
  it('accepts a single-word gloss, stripping leading "to "/article/parenthetical', () => {
    expect(singleWordGlossKey('spring')).toBe('spring')
    expect(singleWordGlossKey('to run')).toBe('run')
    expect(singleWordGlossKey('a pacifier')).toBe('pacifier')
    expect(singleWordGlossKey('(vulgar) blowjob')).toBe('blowjob')
  })
  it('rejects multi-word glosses and junk', () => {
    expect(singleWordGlossKey('teething ring')).toBeNull()
    expect(singleWordGlossKey('to go for a walk')).toBeNull()
    expect(singleWordGlossKey('')).toBeNull()
    expect(singleWordGlossKey('a')).toBeNull() // too short after stripping
  })
})

describe('reverseIndex', () => {
  const words = [
    { kanji: [{ text: '春', common: true }], kana: [{ text: 'はる', common: true }],
      sense: [{ partOfSpeech: ['n'], gloss: [{ lang: 'eng', text: 'spring' }, { lang: 'eng', text: 'springtime' }] }] },
    { kanji: [{ text: '泉', common: false }], kana: [{ text: 'いずみ', common: true }],
      sense: [{ partOfSpeech: ['n'], gloss: [{ lang: 'eng', text: 'spring' }, { lang: 'eng', text: 'fountain' }] }] },
  ]
  it('maps an English word to ranked, capped Japanese equivalents (headword+reading)', () => {
    const idx = reverseIndex(words, { cap: 6 })
    expect(idx['spring']).toEqual([
      { w: '春', r: 'はる' }, // both-common outranks kana-only-common
      { w: '泉', r: 'いずみ' },
    ])
    expect(idx['fountain']).toEqual([{ w: '泉', r: 'いずみ' }])
    expect(idx['springtime']).toEqual([{ w: '春', r: 'はる' }])
  })
  it('dedupes by headword and caps', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      kanji: [{ text: `x${i}`, common: false }], kana: [{ text: `かな${i}`, common: false }],
      sense: [{ partOfSpeech: ['n'], gloss: [{ lang: 'eng', text: 'thing' }] }],
    }))
    expect(reverseIndex(many, { cap: 6 })['thing'].length).toBe(6)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/scripts/enjaDict.test.ts`
Expected: FAIL — `scripts/lib/enjaDict.mjs` does not exist.

- [ ] **Step 3: Write `scripts/lib/enjaDict.mjs`**

```js
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
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/scripts/enjaDict.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the build script `scripts/build-enja-dict.mjs`** (streams the same JMdict source as `build-jmdict-gloss.mjs`):

```js
/**
 * Builds the reverse English→Japanese dictionary for the tap-lookup popover.
 * Source: jmdict-simplified (same cached file as build-jmdict-gloss.mjs).
 * Output: public/enja-dict.json — { v, source, entries: { enWord → [{w, r}] } }.
 * Lazy-loaded at runtime; only fetched when a user taps an English word.
 *
 * Usage: node scripts/build-enja-dict.mjs
 */
import { createReadStream, existsSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { reverseIndex } from './lib/enjaDict.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const cacheDir = join(root, '.cache/jmdict')
const outPath = join(root, 'public/enja-dict.json')

function sourceJson() {
  for (const name of ['jmdict-eng-3.6.2.json']) {
    const p = join(cacheDir, name)
    if (existsSync(p)) return p
  }
  throw new Error(`No jmdict JSON in ${cacheDir}. Run scripts/build-jmdict-gloss.mjs first (it downloads + extracts the source).`)
}

async function main() {
  const jsonPath = sourceJson()
  console.log(`Building enja-dict from ${jsonPath} ...`)
  const words = []
  const rl = createInterface({ input: createReadStream(jsonPath, { encoding: 'utf8' }), crlfDelay: Infinity })
  let inWords = false
  for await (const line of rl) {
    const trimmed = line.trim()
    if (!inWords) { if (trimmed.endsWith('"words": [')) inWords = true; continue }
    if (trimmed === ']' || trimmed === '],') break
    if (!trimmed.startsWith('{')) continue
    const jsonLine = trimmed.endsWith(',') ? trimmed.slice(0, -1) : trimmed
    try { words.push(JSON.parse(jsonLine)) } catch { /* skip */ }
  }
  const entries = reverseIndex(words, { cap: 6 })
  const payload = JSON.stringify({ v: 1, source: 'jmdict-eng', entries })
  writeFileSync(outPath, payload)
  const mb = (Buffer.byteLength(payload) / 1024 / 1024).toFixed(2)
  console.log(`Wrote ${outPath} (${mb} MB, ${Object.keys(entries).length} English keys)`)
}

main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 6: Add npm script + generate the JSON**

In `package.json` `scripts`, add: `"build:enja": "node scripts/build-enja-dict.mjs"`.

Run: `npm run build:enja`
Expected: writes `public/enja-dict.json`; prints size (a few MB) and a five-figure English-key count. If it prints the "No jmdict JSON" error, run `node scripts/build-jmdict-gloss.mjs` once first.

- [ ] **Step 7: Sanity-check the output**

Run: `node -e "const j=require('./public/enja-dict.json'); console.log(j.entries['spring']?.slice(0,3), j.entries['umbrella']?.slice(0,2))"`
Expected: arrays of `{w, r}` objects with plausible Japanese (e.g. spring → 春/泉…, umbrella → 傘).

- [ ] **Step 8: Commit**

```bash
git add scripts/lib/enjaDict.mjs scripts/build-enja-dict.mjs public/enja-dict.json package.json tests/scripts/enjaDict.test.ts
git commit -m "feat(lookup): build reverse English->Japanese dictionary from JMdict"
```

---

## Task 3: `enjaDict.ts` runtime loader

**Files:**
- Create: `src/language/english/enjaDict.ts`
- Test: `tests/language/english/enjaDict.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/language/english/enjaDict.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from 'vitest'
import { loadEnjaDict, getEnjaEntries, enjaDictLoaded, resetEnjaDictCache, setEnjaDictForTests } from '../../../src/language/english/enjaDict'

afterEach(() => { resetEnjaDictCache(); vi.unstubAllGlobals() })

describe('enjaDict loader', () => {
  it('reports not-loaded before a load, loaded after', async () => {
    expect(enjaDictLoaded()).toBe(false)
    setEnjaDictForTests({ v: 1, source: 'test', entries: { spring: [{ w: '春', r: 'はる' }] } })
    expect(enjaDictLoaded()).toBe(true)
    expect(getEnjaEntries('spring')).toEqual([{ w: '春', r: 'はる' }])
    expect(getEnjaEntries('missing')).toBeUndefined()
  })

  it('returns null on fetch failure and reports not-loaded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    expect(await loadEnjaDict()).toBeNull()
    expect(enjaDictLoaded()).toBe(false)
  })

  it('loads and caches the JSON on success', async () => {
    const body = { v: 1, source: 'jmdict-eng', entries: { umbrella: [{ w: '傘', r: 'かさ' }] } }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) }))
    const data = await loadEnjaDict()
    expect(data?.entries.umbrella).toEqual([{ w: '傘', r: 'かさ' }])
    expect(getEnjaEntries('umbrella')).toEqual([{ w: '傘', r: 'かさ' }])
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/language/english/enjaDict.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write `src/language/english/enjaDict.ts`** (mirrors `jmdictGloss.ts`, without the prefix index):

```ts
/** Lazy-loaded reverse English→Japanese dictionary (built by scripts/build-enja-dict.mjs). */

export interface EnjaEntry { w: string; r: string | null }
export interface EnjaDictData {
  v: number
  source: string
  entries: Record<string, EnjaEntry[]>
}

let data: EnjaDictData | null = null
let loadPromise: Promise<EnjaDictData | null> | null = null
let lastLoadFailureAt = 0
const LOAD_RETRY_BACKOFF_MS = 60_000

export function loadEnjaDict(): Promise<EnjaDictData | null> {
  if (data) return Promise.resolve(data)
  if (loadPromise) return loadPromise
  if (lastLoadFailureAt && Date.now() - lastLoadFailureAt < LOAD_RETRY_BACKOFF_MS) return Promise.resolve(null)
  loadPromise = (async () => {
    try {
      const res = await fetch('/enja-dict.json')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const parsed = (await res.json()) as EnjaDictData
      data = { v: parsed.v ?? 1, source: parsed.source ?? 'jmdict-eng', entries: parsed.entries ?? {} }
      lastLoadFailureAt = 0
      return data
    } catch {
      loadPromise = null
      lastLoadFailureAt = Date.now()
      return null
    }
  })()
  return loadPromise
}

export function enjaDictLoaded(): boolean { return data !== null }

export function getEnjaEntries(word: string): EnjaEntry[] | undefined {
  return data?.entries[word.trim().toLowerCase()]
}

export function resetEnjaDictCache(): void { data = null; loadPromise = null; lastLoadFailureAt = 0 }
export function setEnjaDictForTests(payload: EnjaDictData): void { data = payload; loadPromise = Promise.resolve(payload) }
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/language/english/enjaDict.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/language/english/enjaDict.ts tests/language/english/enjaDict.test.ts
git commit -m "feat(lookup): lazy loader for the reverse English->Japanese dictionary"
```

---

## Task 4: `wordLookupEn.ts` resolver (normalize/stem + equivalents)

**Files:**
- Create: `src/language/english/wordLookupEn.ts`
- Test: `tests/language/english/wordLookupEn.test.ts`

The final signature includes an `opts.immersion` flag now (implemented as translation-only in Phase 1; the immersion branch is filled in Phase 2 Task 13) to avoid a later signature change.

- [ ] **Step 1: Write the failing test** — `tests/language/english/wordLookupEn.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { normalizeEnglishWord, hasLatinLetter, stemCandidates, lookupEnglishWord } from '../../../src/language/english/wordLookupEn'
import { setEnjaDictForTests, resetEnjaDictCache } from '../../../src/language/english/enjaDict'

afterEach(() => resetEnjaDictCache())

describe('normalizeEnglishWord / hasLatinLetter', () => {
  it('lowercases and strips surrounding punctuation', () => {
    expect(normalizeEnglishWord('“Spring,”')).toBe('spring')
    expect(normalizeEnglishWord('run!')).toBe('run')
  })
  it('detects whether a raw token has any latin letter', () => {
    expect(hasLatinLetter('spring')).toBe(true)
    expect(hasLatinLetter('…')).toBe(false)
    expect(hasLatinLetter('123')).toBe(false)
  })
})

describe('stemCandidates', () => {
  it('offers base-form candidates for common suffixes', () => {
    expect(stemCandidates('springs')).toContain('spring')
    expect(stemCandidates('making')).toContain('make')
    expect(stemCandidates('liked')).toContain('like')
    expect(stemCandidates('quickly')).toContain('quick')
    expect(stemCandidates("dog's")).toContain('dog')
  })
})

describe('lookupEnglishWord (translation direction)', () => {
  it('returns null for a token with no latin letters', async () => {
    setEnjaDictForTests({ v: 1, source: 't', entries: {} })
    expect(await lookupEnglishWord('…')).toBeNull()
  })

  it('returns Japanese equivalents for an exact match', async () => {
    setEnjaDictForTests({ v: 1, source: 't', entries: { spring: [{ w: '春', r: 'はる' }] } })
    const r = await lookupEnglishWord('Spring')
    expect(r).toMatchObject({ headword: 'spring', definitionLang: 'ja' })
    expect(r!.equivalents).toEqual([{ ja: '春', reading: 'はる' }])
  })

  it('falls back to a stemmed match when the exact form misses', async () => {
    setEnjaDictForTests({ v: 1, source: 't', entries: { umbrella: [{ w: '傘', r: 'かさ' }] } })
    const r = await lookupEnglishWord('umbrellas')
    expect(r!.equivalents).toEqual([{ ja: '傘', reading: 'かさ' }])
  })

  it('reports no equivalents (but dictionaryAvailable) for an unknown word', async () => {
    setEnjaDictForTests({ v: 1, source: 't', entries: {} })
    const r = await lookupEnglishWord('xyzzy')
    expect(r!.equivalents).toEqual([])
    expect(r!.dictionaryAvailable).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/language/english/wordLookupEn.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write `src/language/english/wordLookupEn.ts`**

```ts
import { loadEnjaDict, getEnjaEntries, enjaDictLoaded } from './enjaDict'

export interface EnEquivalent { ja: string; reading: string | null }
export interface EnWordLookupResult {
  /** The normalized English word (display headword). */
  headword: string
  /** Language of the returned definition content. */
  definitionLang: 'ja' | 'en'
  /** Japanese equivalents — populated when definitionLang === 'ja'. */
  equivalents: EnEquivalent[]
  /** English definitions — populated when definitionLang === 'en' (Phase 2). */
  definitions: string[]
  /** False when the underlying dictionary failed to load (offline). */
  dictionaryAvailable: boolean
}

export function hasLatinLetter(raw: string): boolean {
  return /[a-z]/i.test(raw)
}

export function normalizeEnglishWord(raw: string): string {
  return raw
    .replace(/[‘’‛]/g, "'")
    .toLowerCase()
    .replace(/^[^a-z]+|[^a-z]+$/g, '')
}

/** Best-effort base-form candidates (exact form first). Not a full lemmatizer. */
export function stemCandidates(word: string): string[] {
  const c = [word]
  if (word.endsWith("'s")) c.push(word.slice(0, -2))
  if (word.endsWith('ies') && word.length > 4) c.push(word.slice(0, -3) + 'y')
  if (word.endsWith('es') && word.length > 4) c.push(word.slice(0, -2))
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) c.push(word.slice(0, -1))
  if (word.endsWith('ed') && word.length > 4) { c.push(word.slice(0, -2)); c.push(word.slice(0, -1)) }
  if (word.endsWith('ing') && word.length > 5) { c.push(word.slice(0, -3)); c.push(word.slice(0, -3) + 'e') }
  if (word.endsWith('ly') && word.length > 4) c.push(word.slice(0, -2))
  return [...new Set(c)]
}

/**
 * Look up an English translation word. Immersion off → Japanese equivalents
 * (reverse JMdict). Immersion on → English definitions (Phase 2). Null for a
 * token with no latin letters (punctuation) so the popover unmounts.
 */
export async function lookupEnglishWord(
  raw: string,
  opts: { immersion?: boolean } = {},
): Promise<EnWordLookupResult | null> {
  if (!hasLatinLetter(raw)) return null
  const headword = normalizeEnglishWord(raw)
  if (!headword) return null

  if (opts.immersion) {
    // Filled in Phase 2 (Task 13). Until then, immersion has no data → treat as
    // "definitions unavailable" so the popover degrades gracefully.
    return { headword, definitionLang: 'en', equivalents: [], definitions: [], dictionaryAvailable: false }
  }

  await loadEnjaDict()
  let hit: { w: string; r: string | null }[] | undefined
  for (const cand of stemCandidates(headword)) {
    hit = getEnjaEntries(cand)
    if (hit) break
  }
  return {
    headword,
    definitionLang: 'ja',
    equivalents: (hit ?? []).map((e) => ({ ja: e.w, reading: e.r })),
    definitions: [],
    dictionaryAvailable: enjaDictLoaded(),
  }
}

export function jishoSearchUrl(query: string): string {
  return `https://jisho.org/search/${encodeURIComponent(query)}`
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/language/english/wordLookupEn.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/language/english/wordLookupEn.ts tests/language/english/wordLookupEn.test.ts
git commit -m "feat(lookup): English word resolver with normalize/stem + JA equivalents"
```

---

## Task 5: Extract `LookupPopoverShell` (refactor, no behavior change)

**Files:**
- Create: `src/lyrics/LookupPopoverShell.tsx`
- Modify: `src/lyrics/WordLookupPopover.tsx`
- Test: `tests/lyrics/LookupPopoverShell.test.tsx`

- [ ] **Step 1: Write the failing shell test** — `tests/lyrics/LookupPopoverShell.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LookupPopoverShell } from '../../src/lyrics/LookupPopoverShell'

const link = { href: 'https://jisho.org/search/x', label: 'jisho.org ↗' }

describe('LookupPopoverShell', () => {
  it('renders a labelled dialog with the body, close button, and external link', () => {
    render(
      <LookupPopoverShell ariaLabel="Dictionary entry for x" anchorRect={null} externalLink={link} onClose={() => {}}>
        <p>body</p>
      </LookupPopoverShell>,
    )
    expect(screen.getByRole('dialog', { name: 'Dictionary entry for x' })).toBeTruthy()
    expect(screen.getByText('body')).toBeTruthy()
    expect(screen.getByRole('link').getAttribute('href')).toBe(link.href)
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
  })

  it('sits above the player dock in the bottom-card layout', () => {
    render(
      <LookupPopoverShell ariaLabel="x" anchorRect={null} externalLink={link} onClose={() => {}}>
        <p>body</p>
      </LookupPopoverShell>,
    )
    expect((screen.getByRole('dialog') as HTMLElement).style.bottom).toBe('calc(var(--player-dock-height, 96px) + 12px)')
  })

  it('anchors below the word and clamps to the right edge', () => {
    render(
      <LookupPopoverShell ariaLabel="x" anchorRect={{ left: 1000, top: 100, bottom: 120, right: 1020 } as DOMRect} externalLink={link} onClose={() => {}}>
        <p>body</p>
      </LookupPopoverShell>,
    )
    const dialog = screen.getByRole('dialog') as HTMLElement
    expect(dialog.style.top).toBe('128px')
    expect(dialog.style.left).toBe('728px') // 1024 - 288 - 8
  })

  it('closes on outside pointerdown and swallows the following click, one-shot', () => {
    const onClose = vi.fn()
    const onSibling = vi.fn()
    render(
      <div>
        <button type="button" onClick={onSibling}>seek</button>
        <LookupPopoverShell ariaLabel="x" anchorRect={null} externalLink={link} onClose={onClose}><p>body</p></LookupPopoverShell>
      </div>,
    )
    const sibling = screen.getByRole('button', { name: 'seek' })
    fireEvent.pointerDown(sibling)
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(sibling)
    expect(onSibling).not.toHaveBeenCalled()
    fireEvent.click(sibling)
    expect(onSibling).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/lyrics/LookupPopoverShell.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Write `src/lyrics/LookupPopoverShell.tsx`** (moves the positioning + dismissal + close + link verbatim out of `WordLookupPopover`):

```tsx
import { useEffect, useRef } from 'react'

export interface ExternalLink { href: string; label: string }

interface Props {
  ariaLabel: string
  anchorRect: DOMRect | null
  externalLink: ExternalLink
  onClose: () => void
  children: React.ReactNode
}

const CARD_WIDTH = 288
const CARD_EST_HEIGHT = 160

/** Shared chrome for tap-lookup cards: positioning, outside-tap dismissal,
 * close button, and the external dictionary link. Body-agnostic. */
export function LookupPopoverShell({ ariaLabel, anchorRect, externalLink, onClose, children }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  // Dismiss on outside pointerdown (capture) + swallow the completing click so
  // it doesn't seek the lyric row underneath. One-shot; self-removes on a timer.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current || ref.current.contains(e.target as Node)) return
      let timer = 0
      function remove() { document.removeEventListener('click', swallow, true); window.clearTimeout(timer) }
      function swallow(ce: MouseEvent) { ce.stopPropagation(); ce.preventDefault(); remove() }
      document.addEventListener('click', swallow, true)
      timer = window.setTimeout(remove, 400)
      onClose()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [onClose])

  const narrow = window.innerWidth < 640
  const anchored = !narrow && anchorRect !== null
  const fitsBelow = anchorRect !== null && anchorRect.bottom + 8 + CARD_EST_HEIGHT <= window.innerHeight
  const style = anchored
    ? {
        left: Math.max(8, Math.min(anchorRect.left, window.innerWidth - CARD_WIDTH - 8)),
        ...(fitsBelow ? { top: anchorRect.bottom + 8 } : { bottom: window.innerHeight - anchorRect.top + 8 }),
      }
    : { bottom: 'calc(var(--player-dock-height, 96px) + 12px)' }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={ariaLabel}
      onClick={(e) => e.stopPropagation()}
      style={style}
      className={[
        anchored ? 'fixed w-72' : 'fixed inset-x-3 mx-auto max-w-sm',
        'z-30 rounded-xl border border-cinnabar-accent/60 bg-cinnabar-900 p-3 space-y-1.5 shadow-xl text-left',
      ].join(' ')}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute top-0 right-0 w-11 h-11 flex items-center justify-center text-white/40 hover:text-white/80 touch-manipulation transition-colors duration-150 ease-out"
      >
        <span aria-hidden className="text-sm leading-none">✕</span>
      </button>
      {children}
      <a
        href={externalLink.href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block text-xs text-cinnabar-accent underline underline-offset-2 touch-manipulation"
      >
        {externalLink.label}
      </a>
    </div>
  )
}
```

- [ ] **Step 4: Refactor `src/lyrics/WordLookupPopover.tsx` to use the shell** — replace the returned JSX (keep all data-fetching/`result` logic and the `result===null` unmount effect; drop the moved positioning/dismiss/close/link code and the `CARD_WIDTH`/`CARD_EST_HEIGHT` constants). The body becomes:

```tsx
import { useEffect, useState } from 'react'
import type { Token } from '../core/types'
import { lookupWord, jishoSearchUrl, type WordLookupResult } from '../language/japanese/wordLookup'
import { useSettingsStore } from '../payment/SettingsStore'
import { LookupPopoverShell } from './LookupPopoverShell'

interface Props {
  token: Token
  anchorRect: DOMRect | null
  onClose: () => void
}

export function WordLookupPopover({ token, anchorRect, onClose }: Props) {
  const [resolved, setResolved] = useState<{ token: Token; result: WordLookupResult | null } | null>(null)
  const result: WordLookupResult | null | 'loading' = resolved && resolved.token === token ? resolved.result : 'loading'
  const readingMode = useSettingsStore((s) => s.readingMode)

  useEffect(() => {
    let cancelled = false
    void lookupWord(token, readingMode).then((r) => { if (!cancelled) setResolved({ token, result: r }) })
    return () => { cancelled = true }
  }, [token, readingMode])

  useEffect(() => { if (result === null) onClose() }, [result, onClose])
  if (result === null) return null

  const loading = result === 'loading'
  const headword = loading ? token.surface : result.headword
  const reading = loading ? null : result.reading
  const pos = loading ? null : result.posLabel ?? result.pos
  const glosses = loading ? [] : result.glosses

  return (
    <LookupPopoverShell
      ariaLabel={`Dictionary entry for ${headword}`}
      anchorRect={anchorRect}
      externalLink={{ href: jishoSearchUrl(headword), label: 'jisho.org ↗' }}
      onClose={onClose}
    >
      <div className="flex items-baseline gap-2 flex-wrap pr-9">
        <span lang="ja" className="font-jp text-lg font-semibold text-white">{headword}</span>
        {reading && reading !== headword && (
          <span lang="ja" className="font-jp text-sm text-cinnabar-accent/90">{reading}</span>
        )}
        {!loading && result.dictionaryReading && (
          <span lang="ja" className="font-jp text-xs text-white/40">dictionary: {result.dictionaryReading}</span>
        )}
        {pos && <span className="text-[10px] text-white/40">{pos}</span>}
      </div>
      {loading ? (
        <p className="text-xs text-white/40">Looking up…</p>
      ) : glosses.length > 0 ? (
        <p className="text-sm text-white/80 text-pretty">{glosses.join('; ')}</p>
      ) : result.dictionaryAvailable ? (
        <p className="text-xs text-white/40">No definition found.</p>
      ) : (
        <p className="text-xs text-white/40">Definitions unavailable.</p>
      )}
    </LookupPopoverShell>
  )
}
```

- [ ] **Step 5: Run shell + existing popover tests to verify pass**

Run: `npx vitest run tests/lyrics/LookupPopoverShell.test.tsx tests/lyrics/WordLookupPopover.test.tsx`
Expected: PASS — both suites green (the existing popover DOM/behavior is unchanged; positioning/dismiss/close/link now come from the shell).

- [ ] **Step 6: Commit**

```bash
git add src/lyrics/LookupPopoverShell.tsx src/lyrics/WordLookupPopover.tsx tests/lyrics/LookupPopoverShell.test.tsx
git commit -m "refactor(lookup): extract shared LookupPopoverShell (positioning + dismiss)"
```

---

## Task 6: `EnglishWordLookupPopover`

**Files:**
- Create: `src/lyrics/EnglishWordLookupPopover.tsx`
- Test: `tests/lyrics/EnglishWordLookupPopover.test.tsx`

- [ ] **Step 1: Write the failing test** — `tests/lyrics/EnglishWordLookupPopover.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { EnglishWordLookupPopover } from '../../src/lyrics/EnglishWordLookupPopover'

const lookupEnglishWord = vi.fn()
vi.mock('../../src/language/english/wordLookupEn', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/language/english/wordLookupEn')>()
  return { ...actual, lookupEnglishWord: (w: string, o?: unknown) => lookupEnglishWord(w, o) }
})

describe('EnglishWordLookupPopover', () => {
  beforeEach(() => lookupEnglishWord.mockReset())

  it('shows the English headword and Japanese equivalents', async () => {
    lookupEnglishWord.mockResolvedValue({ headword: 'spring', definitionLang: 'ja', equivalents: [{ ja: '春', reading: 'はる' }, { ja: '泉', reading: 'いずみ' }], definitions: [], dictionaryAvailable: true })
    render(<EnglishWordLookupPopover word="Spring" anchorRect={null} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('春')).toBeTruthy())
    expect(screen.getByText('はる')).toBeTruthy()
    expect(screen.getByText('泉')).toBeTruthy()
    expect(screen.getByText('spring')).toBeTruthy()
  })

  it('links to jisho.org for the English word', async () => {
    lookupEnglishWord.mockResolvedValue({ headword: 'spring', definitionLang: 'ja', equivalents: [], definitions: [], dictionaryAvailable: true })
    render(<EnglishWordLookupPopover word="spring" anchorRect={null} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByRole('link')).toBeTruthy())
    expect(screen.getByRole('link').getAttribute('href')).toBe('https://jisho.org/search/spring')
  })

  it('shows a not-found message when there are no equivalents', async () => {
    lookupEnglishWord.mockResolvedValue({ headword: 'xyzzy', definitionLang: 'ja', equivalents: [], definitions: [], dictionaryAvailable: true })
    render(<EnglishWordLookupPopover word="xyzzy" anchorRect={null} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('No definition found.')).toBeTruthy())
  })

  it('renders nothing (and closes) for a null result', async () => {
    lookupEnglishWord.mockResolvedValue(null)
    const onClose = vi.fn()
    const { container } = render(<EnglishWordLookupPopover word="…" anchorRect={null} onClose={onClose} />)
    await waitFor(() => expect(container.firstChild).toBeNull())
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/lyrics/EnglishWordLookupPopover.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Write `src/lyrics/EnglishWordLookupPopover.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { lookupEnglishWord, jishoSearchUrl, type EnWordLookupResult } from '../language/english/wordLookupEn'
import { LookupPopoverShell } from './LookupPopoverShell'

interface Props {
  word: string
  anchorRect: DOMRect | null
  onClose: () => void
}

export function EnglishWordLookupPopover({ word, anchorRect, onClose }: Props) {
  const [resolved, setResolved] = useState<{ word: string; result: EnWordLookupResult | null } | null>(null)
  const result: EnWordLookupResult | null | 'loading' = resolved && resolved.word === word ? resolved.result : 'loading'

  // Phase 1: translation-only. The immersion flag is wired in Phase 2 (Task 15).
  useEffect(() => {
    let cancelled = false
    void lookupEnglishWord(word).then((r) => { if (!cancelled) setResolved({ word, result: r }) })
    return () => { cancelled = true }
  }, [word])

  useEffect(() => { if (result === null) onClose() }, [result, onClose])
  if (result === null) return null

  const loading = result === 'loading'
  const headword = loading ? word : result.headword
  const equivalents = loading ? [] : result.equivalents
  const definitions = loading ? [] : result.definitions
  const isJa = !loading && result.definitionLang === 'ja'

  return (
    <LookupPopoverShell
      ariaLabel={`Dictionary entry for ${headword}`}
      anchorRect={anchorRect}
      externalLink={{ href: jishoSearchUrl(headword), label: 'jisho.org ↗' }}
      onClose={onClose}
    >
      <div className="flex items-baseline gap-2 flex-wrap pr-9">
        <span lang="en" className="text-lg font-semibold text-white">{headword}</span>
      </div>
      {loading ? (
        <p className="text-xs text-white/40">Looking up…</p>
      ) : isJa ? (
        equivalents.length > 0 ? (
          <ul className="space-y-0.5">
            {equivalents.map((e, i) => (
              <li key={i} lang="ja" className="font-jp text-sm text-white/80">
                {e.ja}{e.reading && e.reading !== e.ja ? <span className="text-cinnabar-accent/80 text-xs ml-1">{e.reading}</span> : null}
              </li>
            ))}
          </ul>
        ) : result.dictionaryAvailable ? (
          <p className="text-xs text-white/40">No definition found.</p>
        ) : (
          <p className="text-xs text-white/40">Definitions unavailable.</p>
        )
      ) : definitions.length > 0 ? (
        <p lang="en" className="text-sm text-white/80 text-pretty">{definitions.join('; ')}</p>
      ) : result.dictionaryAvailable ? (
        <p className="text-xs text-white/40">No definition found.</p>
      ) : (
        <p className="text-xs text-white/40">Definitions unavailable.</p>
      )}
    </LookupPopoverShell>
  )
}
```

The `definitionLang === 'en'` branch is dormant in Phase 1 (the resolver only returns `'ja'` outside immersion); Phase 2 Task 15 wires the setting so it activates.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/lyrics/EnglishWordLookupPopover.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lyrics/EnglishWordLookupPopover.tsx tests/lyrics/EnglishWordLookupPopover.test.tsx
git commit -m "feat(lookup): English word popover (headword + Japanese equivalents)"
```

---

## Task 7: Wire English taps into `LyricDisplay` (active line only)

**Files:**
- Modify: `src/lyrics/LyricDisplay.tsx` (`ColoredTranslation`, `Line`, `LyricDisplay`)
- Test: `tests/lyrics/LyricDisplay.test.tsx`

- [ ] **Step 1: Write the failing tests** — append a new `describe` in `tests/lyrics/LyricDisplay.test.tsx`:

```tsx
describe('English tap-to-look-up wiring', () => {
  const enLine = (activeLine: number) => ({
    lines: [{
      original: '君', startTime: 0, endTime: 2, translation: 'you spring',
      tokens: [{ surface: '君', pos: '名詞', startIndex: 0, endIndex: 1, alignmentIndices: [0] }],
    }],
    activeLine,
  })

  beforeEach(() => {
    useLyricsStore.setState({ furiganaMode: 'none', showTranslation: true, lyricsLayout: 'stacked' })
    useSettingsStore.setState({ tapLookupEnabled: true, readingMode: 'dictionary' })
  })

  it('opens the English popover when a translation word on the active line is tapped', async () => {
    useLyricsStore.setState(enLine(0))
    const onLineClick = vi.fn()
    render(<LyricDisplay onLineClick={onLineClick} />)
    fireEvent.click(screen.getByText('spring'))
    expect(onLineClick).not.toHaveBeenCalled()
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })

  it('does not open the English popover for a translation word on a non-active line', () => {
    useLyricsStore.setState({
      lines: [
        { original: '一', startTime: 0, endTime: 2, translation: 'one', tokens: [{ surface: '一', pos: '名詞', startIndex: 0, endIndex: 1, alignmentIndices: [0] }] },
        { original: '二', startTime: 2, endTime: 4, translation: 'two', tokens: [{ surface: '二', pos: '名詞', startIndex: 0, endIndex: 1, alignmentIndices: [0] }] },
      ],
      activeLine: 0,
    })
    const onLineClick = vi.fn()
    render(<LyricDisplay onLineClick={onLineClick} />)
    fireEvent.click(screen.getByText('two')) // translation word on the non-active line
    expect(onLineClick).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
```

Also mock the English resolver at the top of the file (next to the existing `wordLookup` mock):

```tsx
vi.mock('../../src/language/english/wordLookupEn', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/language/english/wordLookupEn')>()
  return { ...actual, lookupEnglishWord: vi.fn().mockResolvedValue({ headword: 'spring', definitionLang: 'ja', equivalents: [{ ja: '春', reading: 'はる' }], definitions: [], dictionaryAvailable: true }) }
})
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/lyrics/LyricDisplay.test.tsx -t "English tap"`
Expected: FAIL — translation words are not tappable yet.

- [ ] **Step 3: Implement in `src/lyrics/LyricDisplay.tsx`.**

(a) Add imports and a tap type:

```tsx
import { EnglishWordLookupPopover } from './EnglishWordLookupPopover'
import { hasLatinLetter } from '../language/english/wordLookupEn'
```

Add a unified tap union near the top. Keep the existing `interface WordTap { token: Token; rect: DOMRect }` — `Line`'s `onWordTap` callback still uses it; `ActiveTap` is only `LyricDisplay`'s popover state:

```tsx
type ActiveTap =
  | { kind: 'ja'; token: Token; rect: DOMRect }
  | { kind: 'en'; word: string; rect: DOMRect }
```

(b) Add an `onEnglishWordTap` prop to `ColoredTranslation` and attach it to each word span:

```tsx
function ColoredTranslation({
  line,
  hovered,
  onHover,
  onEnglishWordTap,
}: {
  line: TimedLine
  hovered: HoveredPair | null
  onHover: (pair: HoveredPair | null) => void
  onEnglishWordTap?: (tap: { word: string; rect: DOMRect }) => void
}) {
  // …unchanged setup…
          return (
            <span
              key={globalIndex}
              style={tokenBorderStyle(color, highlighted)}
              onMouseEnter={() => onHover({ target: globalIndex })}
              onMouseLeave={() => onHover(null)}
              onClick={onEnglishWordTap ? (e) => {
                if (!hasLatinLetter(word)) return
                e.stopPropagation()
                onEnglishWordTap({ word, rect: e.currentTarget.getBoundingClientRect() })
              } : undefined}
            >
              {word}{i < words.length - 1 ? ' ' : ''}
            </span>
          )
  // …unchanged…
}
```

(c) Thread `onEnglishWordTap` through `Line` → the `translationEl` `ColoredTranslation`. Add it to `Line`'s props and pass it only where `ColoredTranslation` is rendered:

```tsx
        <ColoredTranslation line={line} hovered={hoveredPair} onHover={setHoveredPair} onEnglishWordTap={onEnglishWordTap} />
```

Add `onEnglishWordTap?: (tap: { word: string; rect: DOMRect }) => void` to `Line`'s prop type.

(d) In `LyricDisplay`, replace `wordTap`/`setWordTap` with the unified state and pass both handlers only to the active line:

```tsx
  const [tap, setTap] = useState<ActiveTap | null>(null)
  // …
        return (
          <Line
            key={i}
            line={line}
            isActive={isActive}
            loopHighlight={loopHighlight}
            onLineClick={onLineClick}
            lineRef={isActive ? activeRef : undefined}
            onWordTap={tapLookupEnabled && isActive ? (t) => setTap({ kind: 'ja', token: t.token, rect: t.rect }) : undefined}
            onEnglishWordTap={tapLookupEnabled && isActive ? (t) => setTap({ kind: 'en', word: t.word, rect: t.rect }) : undefined}
          />
        )
      })}
      {tap?.kind === 'ja' && (
        <WordLookupPopover token={tap.token} anchorRect={tap.rect} onClose={() => setTap(null)} />
      )}
      {tap?.kind === 'en' && (
        <EnglishWordLookupPopover word={tap.word} anchorRect={tap.rect} onClose={() => setTap(null)} />
      )}
```

(`Line` keeps its existing `onWordTap?: (tap: WordTap) => void` prop; `LyricDisplay` now passes an inline adapter to it.)

- [ ] **Step 4: Run the full LyricDisplay suite**

Run: `npx vitest run tests/lyrics/LyricDisplay.test.tsx`
Expected: PASS — new English tap tests pass; all existing tests (JA tap, coloring, hover, centering) stay green.

- [ ] **Step 5: Commit**

```bash
git add src/lyrics/LyricDisplay.tsx tests/lyrics/LyricDisplay.test.tsx
git commit -m "feat(lookup): tap English translation words on the active line to look them up"
```

---

## Task 8: Settings copy — tap-lookup mentions both languages

**Files:**
- Modify: `src/settings/SettingsView.tsx`

- [ ] **Step 1: Update the description** — change the `SettingToggle` for "Tap word lookup":

```tsx
        <SettingToggle
          title="Tap word lookup"
          description="Tap a Japanese word for its reading and meaning, or an English translation word for its Japanese meaning. Turn off if you use an extension like Yomitan."
          checked={tapLookupEnabled}
          onToggle={() => setTapLookupEnabled(!tapLookupEnabled)}
        />
```

- [ ] **Step 2: Typecheck + run the settings suite**

Run: `npx vitest run tests/settings/tapLookup.test.ts && npx tsc --noEmit`
Expected: PASS / no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/settings/SettingsView.tsx
git commit -m "docs(settings): tap-lookup copy covers both lookup directions"
```

---

## Phase 1 verification

- [ ] Run the full suite: `npx vitest run` → all green.
- [ ] Regenerate corpus baseline check (must be unchanged): `node scripts/audit-corpus.mjs` → pairing metrics identical to the committed baseline (new code never touches the pairer).
- [ ] Manual smoke (dev server via the `verify-live-before-done` skill): active line — tap a Japanese word → JA popover; tap an English translation word → JA-equivalents popover; tap a word on a *non-active* line → the line seeks, no popover.

---

# PHASE 2 — Immersion (monolingual definitions)

## Task 9: `immersionDefinitions` setting

**Files:**
- Modify: `src/core/types/index.ts` (`UserSettings`)
- Modify: `src/payment/SettingsStore.ts`
- Test: `tests/settings/immersion.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/settings/immersion.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { useSettingsStore } from '../../src/payment/SettingsStore'

describe('immersionDefinitions setting', () => {
  it('defaults to off', () => {
    expect(useSettingsStore.getState().immersionDefinitions).toBe(false)
  })
  it('can be toggled', () => {
    useSettingsStore.getState().setImmersionDefinitions(true)
    expect(useSettingsStore.getState().immersionDefinitions).toBe(true)
    useSettingsStore.getState().setImmersionDefinitions(false)
    expect(useSettingsStore.getState().immersionDefinitions).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/settings/immersion.test.ts`
Expected: FAIL — field/setter missing.

- [ ] **Step 3: Add the field + setter.** In `src/core/types/index.ts`, inside `UserSettings` (after `tapLookupEnabled`):

```ts
  /** Show definitions in the word's own language (JA→JA, EN→EN) for immersion. */
  immersionDefinitions: boolean
```

In `src/payment/SettingsStore.ts`: add `setImmersionDefinitions: (enabled: boolean) => void` to `SettingsState`, `immersionDefinitions: false` to the initial state, and `setImmersionDefinitions: (immersionDefinitions) => set({ immersionDefinitions }),` to the actions.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/settings/immersion.test.ts && npx tsc --noEmit`
Expected: PASS / no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/core/types/index.ts src/payment/SettingsStore.ts tests/settings/immersion.test.ts
git commit -m "feat(settings): add immersionDefinitions toggle (default off)"
```

---

## Task 10: WordNet build — pure parsers + `en-def.json` + `wnja-def.json` + licenses

**Files:**
- Modify: `package.json` (add `wordnet-db` devDependency + `build:defs` script)
- Create: `scripts/lib/wordnetDefs.mjs`
- Create: `scripts/build-wordnet-defs.mjs`
- Create: `public/en-def.json`, `public/wnja-def.json` (generated)
- Create: `public/licenses/WORDNET-LICENSE.txt`, `public/licenses/JAPANESE-WORDNET-LICENSE.txt`
- Test: `tests/scripts/wordnetDefs.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/scripts/wordnetDefs.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseWordnetDataLine, parseWnjaDefLine, indexWnjaDefs } from '../../scripts/lib/wordnetDefs.mjs'

describe('parseWordnetDataLine (Princeton data.*)', () => {
  it('extracts lemmas and the definition (drops the "; example")', () => {
    // offset lex_filenum ss_type w_cnt=02: two words, p_cnt 000, then | gloss
    const line = '00445055 04 n 02 spring 0 springtime 0 000 | the season of growth; "the emerging buds"'
    const r = parseWordnetDataLine(line)
    expect(r.words).toEqual(['spring', 'springtime'])
    expect(r.definition).toBe('the season of growth')
  })
  it('replaces underscores and drops adjective markers, ignores comment lines', () => {
    expect(parseWordnetDataLine('  1 this is licence text')).toBeNull()
    const r = parseWordnetDataLine('00001740 03 a 01 able(p) 0 000 | having the power')
    expect(r.words).toEqual(['able'])
  })
})

describe('parseWnjaDefLine + indexWnjaDefs (Japanese WordNet)', () => {
  it('keeps only Japanese-script definitions and joins to lemmas', () => {
    const defLines = [
      '00445055-n\t0\t成長する季節', // Japanese → keep
      '00445055-n\t1\tthe season of growth', // English → drop
    ]
    const okLines = ['00445055-n\t春\thand', '00445055-n\t泉\thand']
    const parsedDefs = defLines.map(parseWnjaDefLine)
    const idx = indexWnjaDefs(okLines, parsedDefs, { cap: 3 })
    expect(idx['春']).toEqual(['成長する季節'])
    expect(idx['泉']).toEqual(['成長する季節'])
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/scripts/wordnetDefs.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write `scripts/lib/wordnetDefs.mjs`**

```js
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
  const out = {}
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
  const out = {}
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
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/scripts/wordnetDefs.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the WordNet data dependency**

Run: `npm install --save-dev wordnet-db`
Expected: `wordnet-db` added under devDependencies (ships `dict/data.*`).

- [ ] **Step 6: Write `scripts/build-wordnet-defs.mjs`**

```js
/**
 * Builds monolingual definition data for immersion mode.
 *  - public/en-def.json  : Princeton WordNet, { word → [definition] }
 *  - public/wnja-def.json: Japanese WordNet, { lemma → [Japanese definition] }
 *
 * Sources:
 *  - English: the `wordnet-db` npm package (dict/data.{noun,verb,adj,adv}).
 *  - Japanese: .cache/wnja/wnjpn-ok.tab + wnjpn-def.tab. If absent, download the
 *    gzipped tab files from the Japanese WordNet (bond-lab) and extract them into
 *    .cache/wnja/ first. See public/licenses/JAPANESE-WORDNET-LICENSE.txt.
 *
 * Usage: node scripts/build-wordnet-defs.mjs
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { indexEnDefs, parseWnjaDefLine, indexWnjaDefs } from './lib/wordnetDefs.mjs'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

function buildEn() {
  const dbPath = require('wordnet-db').path // → node_modules/wordnet-db/dict
  const lines = []
  for (const f of ['data.noun', 'data.verb', 'data.adj', 'data.adv']) {
    lines.push(...readFileSync(join(dbPath, f), 'utf8').split('\n'))
  }
  const entries = indexEnDefs(lines, { cap: 3 })
  const payload = JSON.stringify({ v: 1, source: 'princeton-wordnet-3.1', entries })
  writeFileSync(join(root, 'public/en-def.json'), payload)
  console.log(`en-def.json: ${(Buffer.byteLength(payload) / 1e6).toFixed(2)} MB, ${Object.keys(entries).length} words`)
}

function buildJa() {
  const dir = join(root, '.cache/wnja')
  const okPath = join(dir, 'wnjpn-ok.tab')
  const defPath = join(dir, 'wnjpn-def.tab')
  if (!existsSync(okPath) || !existsSync(defPath)) {
    throw new Error(`Missing ${okPath} / ${defPath}. Download wnjpn-ok.tab.gz and wnjpn-def.tab.gz from https://bond-lab.github.io/wnja/eng/downloads.html and extract into .cache/wnja/`)
  }
  const okLines = readFileSync(okPath, 'utf8').split('\n').filter(Boolean)
  const parsedDefs = readFileSync(defPath, 'utf8').split('\n').filter(Boolean).map(parseWnjaDefLine)
  const entries = indexWnjaDefs(okLines, parsedDefs, { cap: 3 })
  const payload = JSON.stringify({ v: 1, source: 'japanese-wordnet-1.1', entries })
  writeFileSync(join(root, 'public/wnja-def.json'), payload)
  console.log(`wnja-def.json: ${(Buffer.byteLength(payload) / 1e6).toFixed(2)} MB, ${Object.keys(entries).length} lemmas`)
}

buildEn()
buildJa()
```

- [ ] **Step 7: Add licenses + npm script + generate**

Create `public/licenses/WORDNET-LICENSE.txt` (copy from `node_modules/wordnet-db/LICENSE` or the Princeton WordNet license text) and `public/licenses/JAPANESE-WORDNET-LICENSE.txt` (the Japanese WordNet BSD-like license text from the wn-ja distribution). Add `"build:defs": "node scripts/build-wordnet-defs.mjs"` to `package.json` scripts.

Run: `npm run build:defs`
Expected: writes both JSONs with plausible sizes (a few MB each) and five-figure entry counts. If it throws about missing `.cache/wnja/…`, download+extract the two tab files first (URL printed in the error), then re-run.

- [ ] **Step 8: Sanity check**

Run: `node -e "const e=require('./public/en-def.json').entries, j=require('./public/wnja-def.json').entries; console.log('spring:', e.spring?.[0]); console.log('春:', j['春']?.[0])"`
Expected: an English definition for `spring` and a Japanese-script definition for `春`.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json scripts/lib/wordnetDefs.mjs scripts/build-wordnet-defs.mjs public/en-def.json public/wnja-def.json public/licenses tests/scripts/wordnetDefs.test.ts
git commit -m "feat(immersion): build monolingual definition data (WordNet + Japanese WordNet)"
```

---

## Task 11: `enDict.ts` loader (EN→EN)

**Files:**
- Create: `src/language/english/enDict.ts`
- Test: `tests/language/english/enDict.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/language/english/enDict.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from 'vitest'
import { loadEnDict, getEnDefinitions, enDictLoaded, resetEnDictCache, setEnDictForTests } from '../../../src/language/english/enDict'

afterEach(() => { resetEnDictCache(); vi.unstubAllGlobals() })

describe('enDict loader', () => {
  it('injects and reads definitions', () => {
    setEnDictForTests({ v: 1, source: 't', entries: { spring: ['the season of growth'] } })
    expect(enDictLoaded()).toBe(true)
    expect(getEnDefinitions('Spring')).toEqual(['the season of growth'])
    expect(getEnDefinitions('missing')).toBeUndefined()
  })
  it('returns null and stays not-loaded on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    expect(await loadEnDict()).toBeNull()
    expect(enDictLoaded()).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/language/english/enDict.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write `src/language/english/enDict.ts`**

```ts
/** Lazy-loaded English monolingual definitions (built by scripts/build-wordnet-defs.mjs). */

export interface EnDictData {
  v: number
  source: string
  entries: Record<string, string[]>
}

let data: EnDictData | null = null
let loadPromise: Promise<EnDictData | null> | null = null
let lastLoadFailureAt = 0
const LOAD_RETRY_BACKOFF_MS = 60_000

export function loadEnDict(): Promise<EnDictData | null> {
  if (data) return Promise.resolve(data)
  if (loadPromise) return loadPromise
  if (lastLoadFailureAt && Date.now() - lastLoadFailureAt < LOAD_RETRY_BACKOFF_MS) return Promise.resolve(null)
  loadPromise = (async () => {
    try {
      const res = await fetch('/en-def.json')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const parsed = (await res.json()) as EnDictData
      data = { v: parsed.v ?? 1, source: parsed.source ?? 'princeton-wordnet', entries: parsed.entries ?? {} }
      lastLoadFailureAt = 0
      return data
    } catch {
      loadPromise = null
      lastLoadFailureAt = Date.now()
      return null
    }
  })()
  return loadPromise
}

export function enDictLoaded(): boolean { return data !== null }

export function getEnDefinitions(word: string): string[] | undefined {
  return data?.entries[word.trim().toLowerCase()]
}

export function resetEnDictCache(): void { data = null; loadPromise = null; lastLoadFailureAt = 0 }
export function setEnDictForTests(payload: EnDictData): void { data = payload; loadPromise = Promise.resolve(payload) }
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/language/english/enDict.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/language/english/enDict.ts tests/language/english/enDict.test.ts
git commit -m "feat(immersion): lazy loader for English monolingual definitions"
```

---

## Task 12: `jaMonolingual.ts` loader + lookup (JA→JA)

**Files:**
- Create: `src/language/japanese/jaMonolingual.ts`
- Test: `tests/language/japanese/jaMonolingual.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/language/japanese/jaMonolingual.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { lookupJaDefinition, jaMonolingualLoaded, resetJaMonolingualCache, setJaMonolingualForTests } from '../../../src/language/japanese/jaMonolingual'
import type { Token } from '../../../src/core/types'

const tok = (patch: Partial<Token> & { surface: string }): Token => ({ startIndex: 0, endIndex: patch.surface.length, ...patch })

afterEach(() => resetJaMonolingualCache())

describe('lookupJaDefinition', () => {
  it('resolves by baseForm first, then surface', () => {
    setJaMonolingualForTests({ v: 1, source: 't', entries: { '走る': ['速く移動する'] } })
    expect(jaMonolingualLoaded()).toBe(true)
    expect(lookupJaDefinition(tok({ surface: '走っ', baseForm: '走る' }))).toEqual(['速く移動する'])
  })
  it('returns undefined for a lemma not in the dictionary', () => {
    setJaMonolingualForTests({ v: 1, source: 't', entries: {} })
    expect(lookupJaDefinition(tok({ surface: 'ゑ' }))).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/language/japanese/jaMonolingual.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write `src/language/japanese/jaMonolingual.ts`**

```ts
/** Lazy-loaded Japanese monolingual definitions (built by scripts/build-wordnet-defs.mjs). */
import type { Token } from '../../core/types'

export interface JaMonolingualData {
  v: number
  source: string
  entries: Record<string, string[]>
}

let data: JaMonolingualData | null = null
let loadPromise: Promise<JaMonolingualData | null> | null = null
let lastLoadFailureAt = 0
const LOAD_RETRY_BACKOFF_MS = 60_000

export function loadJaMonolingual(): Promise<JaMonolingualData | null> {
  if (data) return Promise.resolve(data)
  if (loadPromise) return loadPromise
  if (lastLoadFailureAt && Date.now() - lastLoadFailureAt < LOAD_RETRY_BACKOFF_MS) return Promise.resolve(null)
  loadPromise = (async () => {
    try {
      const res = await fetch('/wnja-def.json')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const parsed = (await res.json()) as JaMonolingualData
      data = { v: parsed.v ?? 1, source: parsed.source ?? 'japanese-wordnet', entries: parsed.entries ?? {} }
      lastLoadFailureAt = 0
      return data
    } catch {
      loadPromise = null
      lastLoadFailureAt = Date.now()
      return null
    }
  })()
  return loadPromise
}

export function jaMonolingualLoaded(): boolean { return data !== null }

export function getJaDefinitions(lemma: string): string[] | undefined {
  return data?.entries[lemma]
}

/** Definitions for a token, trying its dictionary (base) form then its surface. */
export function lookupJaDefinition(token: Token): string[] | undefined {
  return (token.baseForm ? getJaDefinitions(token.baseForm) : undefined) ?? getJaDefinitions(token.surface)
}

export function resetJaMonolingualCache(): void { data = null; loadPromise = null; lastLoadFailureAt = 0 }
export function setJaMonolingualForTests(payload: JaMonolingualData): void { data = payload; loadPromise = Promise.resolve(payload) }
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/language/japanese/jaMonolingual.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/language/japanese/jaMonolingual.ts tests/language/japanese/jaMonolingual.test.ts
git commit -m "feat(immersion): lazy loader + token lookup for Japanese monolingual definitions"
```

---

## Task 13: EN→EN immersion branch in `wordLookupEn.ts`

**Files:**
- Modify: `src/language/english/wordLookupEn.ts`
- Test: `tests/language/english/wordLookupEn.test.ts`

- [ ] **Step 1: Write the failing test** — append to `tests/language/english/wordLookupEn.test.ts`:

```ts
import { setEnDictForTests, resetEnDictCache } from '../../../src/language/english/enDict'

describe('lookupEnglishWord (immersion / EN→EN)', () => {
  afterEach(() => resetEnDictCache())
  it('returns English definitions when immersion is on', async () => {
    setEnDictForTests({ v: 1, source: 't', entries: { spring: ['the season of growth'] } })
    const r = await lookupEnglishWord('Spring', { immersion: true })
    expect(r).toMatchObject({ headword: 'spring', definitionLang: 'en' })
    expect(r!.definitions).toEqual(['the season of growth'])
    expect(r!.equivalents).toEqual([])
  })
  it('reports no definition (dictionaryAvailable true) for an unknown word in immersion', async () => {
    setEnDictForTests({ v: 1, source: 't', entries: {} })
    const r = await lookupEnglishWord('xyzzy', { immersion: true })
    expect(r!.definitions).toEqual([])
    expect(r!.dictionaryAvailable).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/language/english/wordLookupEn.test.ts -t immersion`
Expected: FAIL — immersion branch returns `dictionaryAvailable:false` / no definitions.

- [ ] **Step 3: Implement.** In `src/language/english/wordLookupEn.ts`, replace the Phase-1 immersion stub with a real branch using `enDict`:

```ts
import { loadEnDict, getEnDefinitions, enDictLoaded } from './enDict'
// …
  if (opts.immersion) {
    await loadEnDict()
    let defs: string[] | undefined
    for (const cand of stemCandidates(headword)) {
      defs = getEnDefinitions(cand)
      if (defs) break
    }
    return {
      headword,
      definitionLang: 'en',
      equivalents: [],
      definitions: defs ?? [],
      dictionaryAvailable: enDictLoaded(),
    }
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/language/english/wordLookupEn.test.ts`
Expected: PASS (all English resolver tests).

- [ ] **Step 5: Commit**

```bash
git add src/language/english/wordLookupEn.ts tests/language/english/wordLookupEn.test.ts
git commit -m "feat(immersion): English monolingual definitions in the English resolver"
```

---

## Task 14: JA→JA immersion branch + `definitionLang` in `wordLookup.ts`

**Files:**
- Modify: `src/language/japanese/wordLookup.ts`
- Test: `tests/language/japanese/wordLookup.test.ts`

- [ ] **Step 1: Write the failing tests** — append to `tests/language/japanese/wordLookup.test.ts`:

```ts
import { setJaMonolingualForTests, resetJaMonolingualCache } from '../../../src/language/japanese/jaMonolingual'

describe('lookupWord immersion (JA→JA)', () => {
  afterEach(() => resetJaMonolingualCache())

  it('returns the Japanese definition and definitionLang "ja" when immersion is on', async () => {
    setJaMonolingualForTests({ v: 1, source: 't', entries: { '走る': ['速く移動する'] } })
    const r = await lookupWord(tok({ surface: '走っ', reading: 'ハシッ', pos: '動詞', baseForm: '走る' }), 'dictionary', { immersion: true })
    expect(r!.definitionLang).toBe('ja')
    expect(r!.glosses).toEqual(['速く移動する'])
  })

  it('falls back to reading-only (no gloss) when there is no Japanese definition', async () => {
    setJaMonolingualForTests({ v: 1, source: 't', entries: {} })
    const r = await lookupWord(tok({ surface: '走っ', reading: 'ハシッ', pos: '動詞', baseForm: '走る' }), 'dictionary', { immersion: true })
    expect(r!.definitionLang).toBe('ja')
    expect(r!.glosses).toEqual([])
    expect(r!.reading).toBe('はしっ')
  })

  it('leaves non-immersion output on the English path (definitionLang "en")', async () => {
    const r = await lookupWord(tok({ surface: '躱し', reading: 'カワシ', pos: '動詞', baseForm: '躱す' }))
    expect(r!.definitionLang).toBe('en')
    expect(r!.glosses).toEqual(['to dodge', 'to evade'])
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/language/japanese/wordLookup.test.ts -t immersion`
Expected: FAIL — `lookupWord` has no immersion param / no `definitionLang`.

- [ ] **Step 3: Implement.** In `src/language/japanese/wordLookup.ts`:

(a) Add `definitionLang: 'en' | 'ja'` to `WordLookupResult`.

(b) Import the JA monolingual loader:

```ts
import { loadJaMonolingual, lookupJaDefinition, jaMonolingualLoaded } from './jaMonolingual'
```

(c) Change the signature and branch. Replace the current gloss computation + return with:

```ts
export async function lookupWord(
  token: Token,
  readingMode: ReadingMode = 'dictionary',
  opts: { immersion?: boolean } = {},
): Promise<WordLookupResult | null> {
  if (!hasJapanese(token.surface)) return null
  await Promise.all([prepareJmdictStemIndex(), loadJmdictReadings()])

  const headword = token.baseForm ?? token.surface
  const kana = token.reading ?? (KANA_ONLY.test(token.surface) ? token.surface : undefined)
  const jmdictReading = kana ? undefined : jmdictFallbackReading(headword) ?? jmdictFallbackReading(token.surface)
  const dictReading = kana ? katakanaToHiragana(kana) : jmdictReading ?? null
  const sung = shouldPromoteSungReading(token, readingMode) && token.audioReading ? katakanaToHiragana(token.audioReading) : null
  const reading = sung ?? dictReading

  if (opts.immersion) {
    await loadJaMonolingual()
    const defs = lookupJaDefinition(token)
    return {
      headword,
      reading,
      dictionaryReading: sung && dictReading && dictReading !== sung ? dictReading : null,
      pos: token.pos ?? null,
      posLabel: posLabelFor(token),
      glosses: defs ?? [],
      dictionaryAvailable: jaMonolingualLoaded(),
      definitionLang: 'ja',
    }
  }

  const gloss = isGrammarToken(token)
    ? grammarGloss(token) ?? subsidiaryVerbLexicalGloss(token, headword, kana)
    : lexicalGloss(token, headword, kana)

  return {
    headword,
    reading,
    dictionaryReading: sung && dictReading && dictReading !== sung ? dictReading : null,
    pos: token.pos ?? null,
    posLabel: posLabelFor(token),
    glosses: gloss ? gloss.split(/\s*;\s*/).filter(Boolean) : [],
    dictionaryAvailable: jmdictGlossLoaded(),
    definitionLang: 'en',
  }
}
```

- [ ] **Step 4: Run to verify pass (and confirm non-immersion is unchanged)**

Run: `npx vitest run tests/language/japanese/wordLookup.test.ts`
Expected: PASS — immersion tests pass; every pre-existing `lookupWord` test still passes (non-immersion glosses byte-identical, just an added `definitionLang: 'en'` field).

- [ ] **Step 5: Commit**

```bash
git add src/language/japanese/wordLookup.ts tests/language/japanese/wordLookup.test.ts
git commit -m "feat(immersion): Japanese monolingual definitions in the Japanese resolver"
```

---

## Task 15: Immersion rendering in both popovers (JA weblio link, EN definitions)

**Files:**
- Modify: `src/lyrics/WordLookupPopover.tsx`
- Modify: `src/lyrics/EnglishWordLookupPopover.tsx`
- Test: `tests/lyrics/WordLookupPopover.test.tsx`
- Test: `tests/lyrics/EnglishWordLookupPopover.test.tsx`

Both popovers were built translation-only in Phase 1. This task reads `immersionDefinitions` in each and passes `{ immersion }` to its resolver: the Japanese popover gains the JA-definition rendering + weblio link; the English popover activates its already-present `definitionLang === 'en'` branch.

- [ ] **Step 1: Write the failing tests** — append to `tests/lyrics/WordLookupPopover.test.tsx`:

```tsx
import { useSettingsStore } from '../../src/payment/SettingsStore'

it('passes the immersion flag and links to weblio 国語辞書 when immersion is on', async () => {
  useSettingsStore.setState({ immersionDefinitions: true })
  lookupWord.mockResolvedValue({ headword: '走る', reading: 'はしる', pos: '動詞', posLabel: 'verb', glosses: ['速く移動する'], dictionaryAvailable: true, definitionLang: 'ja' })
  render(<WordLookupPopover token={token} anchorRect={null} onClose={() => {}} />)
  await waitFor(() => expect(screen.getByText('速く移動する')).toBeTruthy())
  expect(screen.getByRole('link').getAttribute('href')).toBe(`https://www.weblio.jp/content/${encodeURIComponent('走る')}`)
  useSettingsStore.setState({ immersionDefinitions: false })
})
```

Update the `WordLookupPopover` mock to forward the second argument so the component's `immersion` option is exercised:

```tsx
vi.mock('../../src/language/japanese/wordLookup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/language/japanese/wordLookup')>()
  return { ...actual, lookupWord: (token: Token, mode?: unknown, opts?: unknown) => lookupWord(token, mode, opts) }
})
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/lyrics/WordLookupPopover.test.tsx -t immersion`
Expected: FAIL — the popover always links to jisho and never passes `immersion`.

- [ ] **Step 3: Implement in `src/lyrics/WordLookupPopover.tsx`.** Read the setting, pass it to `lookupWord`, and choose the external link:

```tsx
  const immersion = useSettingsStore((s) => s.immersionDefinitions)
  // …
  useEffect(() => {
    let cancelled = false
    void lookupWord(token, readingMode, { immersion }).then((r) => { if (!cancelled) setResolved({ token, result: r }) })
    return () => { cancelled = true }
  }, [token, readingMode, immersion])
  // …
  const externalLink = immersion
    ? { href: `https://www.weblio.jp/content/${encodeURIComponent(headword)}`, label: 'weblio 国語辞書 ↗' }
    : { href: jishoSearchUrl(headword), label: 'jisho.org ↗' }
```

Pass `externalLink={externalLink}` to `LookupPopoverShell`. When a JA definition is missing in immersion (`glosses.length === 0` && `dictionaryAvailable`), the existing "No definition found." branch already renders — acceptable as the "定義なし" fallback alongside the reading and weblio link.

- [ ] **Step 4: Run the popover suite**

Run: `npx vitest run tests/lyrics/WordLookupPopover.test.tsx`
Expected: PASS — immersion test passes; existing (non-immersion) tests still link to jisho and stay green.

- [ ] **Step 5: Wire immersion into the English popover** — first add a failing test to `tests/lyrics/EnglishWordLookupPopover.test.tsx`:

```tsx
import { useSettingsStore } from '../../src/payment/SettingsStore'

it('passes immersion and shows English definitions when immersion is on', async () => {
  useSettingsStore.setState({ immersionDefinitions: true })
  lookupEnglishWord.mockResolvedValue({ headword: 'spring', definitionLang: 'en', equivalents: [], definitions: ['the season of growth'], dictionaryAvailable: true })
  render(<EnglishWordLookupPopover word="spring" anchorRect={null} onClose={() => {}} />)
  await waitFor(() => expect(screen.getByText('the season of growth')).toBeTruthy())
  expect(lookupEnglishWord).toHaveBeenCalledWith('spring', { immersion: true })
  useSettingsStore.setState({ immersionDefinitions: false })
})
```

Run: `npx vitest run tests/lyrics/EnglishWordLookupPopover.test.tsx -t immersion` → FAIL (component never reads the setting / never passes `{ immersion }`).

Then implement in `src/lyrics/EnglishWordLookupPopover.tsx` — add the import `import { useSettingsStore } from '../payment/SettingsStore'`, read the setting, and pass it:

```tsx
  const immersion = useSettingsStore((s) => s.immersionDefinitions)
  useEffect(() => {
    let cancelled = false
    void lookupEnglishWord(word, { immersion }).then((r) => { if (!cancelled) setResolved({ word, result: r }) })
    return () => { cancelled = true }
  }, [word, immersion])
```

Run: `npx vitest run tests/lyrics/EnglishWordLookupPopover.test.tsx` → PASS (immersion + existing translation tests green).

- [ ] **Step 6: Commit**

```bash
git add src/lyrics/WordLookupPopover.tsx src/lyrics/EnglishWordLookupPopover.tsx tests/lyrics/WordLookupPopover.test.tsx tests/lyrics/EnglishWordLookupPopover.test.tsx
git commit -m "feat(immersion): both popovers show monolingual definitions when immersion is on"
```

---

## Task 16: Immersion settings toggle

**Files:**
- Modify: `src/settings/SettingsView.tsx`

- [ ] **Step 1: Destructure the new setting** — add `immersionDefinitions, setImmersionDefinitions` to the `useSettingsStore()` destructure at the top of the component.

- [ ] **Step 2: Add the toggle row** — directly after the "Tap word lookup" `SettingToggle`:

```tsx
        <SettingToggle
          title="Immersion (monolingual) definitions"
          description="Define words in their own language — Japanese words get Japanese definitions, English words get English. For advanced learners. Needs Tap word lookup on."
          checked={immersionDefinitions}
          onToggle={() => setImmersionDefinitions(!immersionDefinitions)}
        />
```

- [ ] **Step 3: Typecheck + settings tests**

Run: `npx tsc --noEmit && npx vitest run tests/settings`
Expected: no type errors; settings tests green.

- [ ] **Step 4: Commit**

```bash
git add src/settings/SettingsView.tsx
git commit -m "feat(immersion): settings toggle for monolingual definitions"
```

---

## Phase 2 verification

- [ ] Full suite: `npx vitest run` → all green.
- [ ] Corpus baseline unchanged: `node scripts/audit-corpus.mjs` → pairing metrics identical (immersion never touches the pairer or the JA→EN gloss chain).
- [ ] Typecheck: `npx tsc --noEmit` → clean.
- [ ] Manual smoke (dev server, `verify-live-before-done` skill), immersion **on**: tap a Japanese word → Japanese definition (or reading + "No definition found" + weblio link when uncovered); tap an English translation word → English definition. Immersion **off**: JA→English and EN→Japanese as in Phase 1.
- [ ] Bundle-size note: record the three JSON sizes in the PR description; confirm each loads only on the relevant tap (network tab shows `enja-dict.json` on first EN tap, `en-def.json`/`wnja-def.json` only with immersion on).

---

## Self-review notes (author)

- **Spec coverage:** active-line gate (T1); EN→JA reverse dict (T2–T4, T7); shell refactor + EN popover (T5–T6); settings copy (T8); immersion setting (T9); WordNet/wn-ja data + licenses (T10); loaders (T11–T12); immersion resolver branches (T13–T14); immersion popover rendering + link (T15); immersion toggle (T16); fallbacks (T14 reading-only, T15 "No definition found" + weblio, loaders' `dictionaryAvailable`); safety re-verified in both phase-verification sections.
- **Signature stability:** `lookupEnglishWord(word, opts?)` and `lookupWord(token, mode, opts?)` are introduced with their final shape in Phase 1 (opts optional) so Phase 2 only fills the immersion branch — no resolver-signature change. The popover call-sites add the `{ immersion }` argument in Phase 2 (T15); this is the only call-site churn and it's covered by T15's tests. `WordLookupResult.definitionLang` is added in T14; the EN result type (`EnWordLookupResult`) carries `definitionLang` from T4.
- **Deferred (from spec):** doubled-consonant stems (running→run), multi-word reverse glosses, token-less translation lines, native 国語辞典 register, per-direction immersion.
