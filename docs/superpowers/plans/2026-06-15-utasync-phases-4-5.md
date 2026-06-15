# Utasync Implementation Plan — Phases 4–5

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Utasync with language features, cloze mode, monetisation, and app store polish (Phases 4–5 of 5).

**Prerequisite:** Phases 1–3 plan (`2026-06-15-utasync-phases-1-3.md`) must be complete and all tests passing.

**Architecture:** Feature slices `language/`, `cloze/`, `payment/`, `settings/` added to the existing hybrid feature-slice structure. All imports from `core/` only.

**Tech Stack:** kuromoji.js, kuroshiro, wanakana, compromise, jose, LemonSqueezy overlay

---

## PHASE 4 — Language Features & Cloze

### Task 25: Japanese tokenizer

**Files:**
- Create: `src/language/japanese/tokenizer.ts`
- Create: `tests/language/japanese/tokenizer.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/language/japanese/tokenizer.test.ts
import { describe, it, expect } from 'vitest'
import { tokenizeJapanese } from '../../../src/language/japanese/tokenizer'

describe('tokenizeJapanese', () => {
  it('tokenizes a simple sentence', async () => {
    const tokens = await tokenizeJapanese('星に願いを')
    expect(tokens.length).toBeGreaterThan(0)
    expect(tokens[0].surface).toBeTruthy()
  })

  it('includes reading for kanji', async () => {
    const tokens = await tokenizeJapanese('星')
    const star = tokens.find((t) => t.surface === '星')
    expect(star?.reading).toBeTruthy()
  })

  it('includes part of speech', async () => {
    const tokens = await tokenizeJapanese('走る')
    const verb = tokens.find((t) => t.surface === '走る')
    expect(verb?.pos).toMatch(/動詞|verb/i)
  })
})
```

- [ ] **Step 2: Run test — expect fail**

```bash
npx vitest run tests/language/japanese/tokenizer.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/language/japanese/tokenizer.ts
import kuromoji from 'kuromoji'
import type { Token } from '../../core/types'

let builder: any = null

function getTokenizer(): Promise<any> {
  if (builder) return Promise.resolve(builder)
  return new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath: '/dict' }).build((err: any, tokenizer: any) => {
      if (err) reject(err)
      else { builder = tokenizer; resolve(tokenizer) }
    })
  })
}

export async function tokenizeJapanese(text: string): Promise<Token[]> {
  const tokenizer = await getTokenizer()
  const raw: any[] = tokenizer.tokenize(text)

  let index = 0
  return raw.map((t): Token => {
    const startIndex = index
    index += t.surface_form.length
    return {
      surface: t.surface_form,
      reading: t.reading,
      pos: t.pos,
      startIndex,
      endIndex: index,
    }
  })
}
```

> **Note:** kuromoji requires its dictionary files to be served from `/dict`. Copy `node_modules/kuromoji/dict` to `public/dict` or configure Vite to serve them.

- [ ] **Step 4: Copy kuromoji dict to public**

```bash
cp -r node_modules/kuromoji/dict public/dict
```

- [ ] **Step 5: Run test — expect pass**

```bash
npx vitest run tests/language/japanese/tokenizer.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/language/japanese/tokenizer.ts tests/language/japanese/tokenizer.test.ts public/dict
git commit -m "feat: add Japanese tokenizer using kuromoji"
```

---

### Task 26: Japanese phonetics (romaji/furigana)

**Files:**
- Create: `src/language/japanese/phonetics.ts`
- Create: `tests/language/japanese/phonetics.test.ts`

- [ ] **Step 1: Write test**

```ts
// tests/language/japanese/phonetics.test.ts
import { describe, it, expect } from 'vitest'
import { toRomaji, toFurigana } from '../../../src/language/japanese/phonetics'

describe('toRomaji', () => {
  it('converts hiragana to romaji', async () => {
    const result = await toRomaji('ほし')
    expect(result).toBe('hoshi')
  })

  it('converts kanji sentence with readings', async () => {
    const result = await toRomaji('星に願いを')
    expect(result.toLowerCase()).toContain('hoshi')
  })
})

describe('toFurigana', () => {
  it('returns HTML with ruby annotations', async () => {
    const result = await toFurigana('星')
    expect(result).toContain('<ruby>')
    expect(result).toContain('<rt>')
  })
})
```

- [ ] **Step 2: Run — expect fail**

```bash
npx vitest run tests/language/japanese/phonetics.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/language/japanese/phonetics.ts
import Kuroshiro from 'kuroshiro'
import KuromojiAnalyzer from 'kuroshiro-analyzer-kuromoji'

let kuroshiro: Kuroshiro | null = null

async function getKuroshiro(): Promise<Kuroshiro> {
  if (kuroshiro) return kuroshiro
  kuroshiro = new Kuroshiro()
  await kuroshiro.init(new KuromojiAnalyzer({ dictPath: '/dict' }))
  return kuroshiro
}

export async function toRomaji(text: string): Promise<string> {
  const k = await getKuroshiro()
  return k.convert(text, { to: 'romaji', mode: 'spaced', romajiSystem: 'hepburn' })
}

export async function toFurigana(text: string): Promise<string> {
  const k = await getKuroshiro()
  return k.convert(text, { to: 'hiragana', mode: 'furigana' })
}

export async function toKatakana(text: string): Promise<string> {
  const k = await getKuroshiro()
  return k.convert(text, { to: 'katakana' })
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
npx vitest run tests/language/japanese/phonetics.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/language/japanese/phonetics.ts tests/language/japanese/phonetics.test.ts
git commit -m "feat: add Japanese romaji and furigana conversion via kuroshiro"
```

---

### Task 27: Japanese grammar highlighting

**Files:**
- Create: `src/language/japanese/grammar.ts`
- Create: `tests/language/japanese/grammar.test.ts`

- [ ] **Step 1: Write test**

```ts
// tests/language/japanese/grammar.test.ts
import { describe, it, expect } from 'vitest'
import { detectGrammarPatterns, type GrammarAnnotation } from '../../../src/language/japanese/grammar'

describe('detectGrammarPatterns', () => {
  it('detects ている pattern', () => {
    const annotations = detectGrammarPatterns('待っている')
    const hit = annotations.find((a) => a.pattern.includes('ている'))
    expect(hit).toBeTruthy()
    expect(hit?.explanation).toBeTruthy()
  })

  it('detects ない negative form', () => {
    const annotations = detectGrammarPatterns('行かない')
    const hit = annotations.find((a) => a.pattern.includes('ない'))
    expect(hit).toBeTruthy()
  })

  it('returns empty array for plain text', () => {
    const annotations = detectGrammarPatterns('猫')
    expect(annotations).toEqual([])
  })
})
```

- [ ] **Step 2: Run — expect fail**

```bash
npx vitest run tests/language/japanese/grammar.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/language/japanese/grammar.ts
export interface GrammarAnnotation {
  pattern: string
  explanation: string
  startIndex: number
  endIndex: number
}

interface GrammarRule {
  pattern: RegExp
  label: string
  explanation: string
}

const RULES: GrammarRule[] = [
  { pattern: /[てで]いる/g, label: '〜ている', explanation: 'Ongoing action or state (progressive/resultant state)' },
  { pattern: /[てで]いた/g, label: '〜ていた', explanation: 'Was doing / had been in a state (past progressive)' },
  { pattern: /なければならない/g, label: '〜なければならない', explanation: 'Must do / have to (strong obligation)' },
  { pattern: /なくてはいけない/g, label: '〜なくてはいけない', explanation: 'Must do (obligation, slightly softer)' },
  { pattern: /ことができる/g, label: '〜ことができる', explanation: 'Ability to do something (can / be able to)' },
  { pattern: /たことがある/g, label: '〜たことがある', explanation: 'Have experience of doing (experiential perfect)' },
  { pattern: /[てで]も/g, label: '〜ても', explanation: 'Even if / even though (concessive)' },
  { pattern: /[てで]から/g, label: '〜てから', explanation: 'After doing (sequential action)' },
  { pattern: /ために/g, label: '〜ために', explanation: 'For the purpose of / because of' },
  { pattern: /ような/g, label: '〜ような', explanation: 'Like / similar to (comparison)' },
  { pattern: /ないで/g, label: '〜ないで', explanation: 'Without doing / please don\'t do' },
  { pattern: /[かき]った/g, label: '〜た (past)', explanation: 'Past tense verb ending' },
  { pattern: /ない(?!で)/g, label: '〜ない', explanation: 'Negative verb form (plain negative)' },
]

export function detectGrammarPatterns(text: string): GrammarAnnotation[] {
  const annotations: GrammarAnnotation[] = []
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = rule.pattern.exec(text)) !== null) {
      annotations.push({
        pattern: rule.label,
        explanation: rule.explanation,
        startIndex: match.index,
        endIndex: match.index + match[0].length,
      })
    }
  }
  return annotations
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
npx vitest run tests/language/japanese/grammar.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/language/japanese/grammar.ts tests/language/japanese/grammar.test.ts
git commit -m "feat: add Japanese grammar pattern detection with explanations"
```

---

### Task 28: English tokenizer + phonetics (IPA)

**Files:**
- Create: `src/language/english/tokenizer.ts`
- Create: `src/language/english/phonetics.ts`
- Create: `tests/language/english/phonetics.test.ts`

- [ ] **Step 1: Write test**

```ts
// tests/language/english/phonetics.test.ts
import { describe, it, expect } from 'vitest'
import { wordToIPA, sentenceToIPA } from '../../../src/language/english/phonetics'

describe('wordToIPA', () => {
  it('returns IPA for common word', async () => {
    const ipa = await wordToIPA('star')
    expect(ipa).toMatch(/stɑ|stɔ/)
  })

  it('returns null for unknown word', async () => {
    const ipa = await wordToIPA('xyzabc')
    expect(ipa).toBeNull()
  })
})

describe('sentenceToIPA', () => {
  it('converts known words', async () => {
    const result = await sentenceToIPA('I love music')
    expect(result).toContain('/')
  })
})
```

- [ ] **Step 2: Run — expect fail**

```bash
npx vitest run tests/language/english/phonetics.test.ts
```

- [ ] **Step 3: Implement tokenizer**

```ts
// src/language/english/tokenizer.ts
import nlp from 'compromise'
import type { Token } from '../../core/types'

export function tokenizeEnglish(text: string): Token[] {
  const doc = nlp(text)
  const terms = doc.terms().json() as Array<{ text: string; offset: { start: number; length: number }; tags: Record<string, boolean> }>
  return terms.map((t): Token => ({
    surface: t.text,
    pos: Object.keys(t.tags)[0] ?? 'unknown',
    startIndex: t.offset.start,
    endIndex: t.offset.start + t.offset.length,
  }))
}
```

- [ ] **Step 4: Implement IPA phonetics**

The CMUdict subset is loaded from Cache Storage as a JSON file served at `/cmudict.json`.

```ts
// src/language/english/phonetics.ts
let dict: Record<string, string> | null = null

async function getCMUDict(): Promise<Record<string, string>> {
  if (dict) return dict
  const res = await fetch('/cmudict.json')
  dict = await res.json()
  return dict!
}

// CMUdict uses ARPABET; convert to simplified IPA
const ARPABET_TO_IPA: Record<string, string> = {
  AA: 'ɑ', AE: 'æ', AH: 'ʌ', AO: 'ɔ', AW: 'aʊ', AY: 'aɪ',
  B: 'b', CH: 'tʃ', D: 'd', DH: 'ð', EH: 'ɛ', ER: 'ɝ',
  EY: 'eɪ', F: 'f', G: 'g', HH: 'h', IH: 'ɪ', IY: 'i',
  JH: 'dʒ', K: 'k', L: 'l', M: 'm', N: 'n', NG: 'ŋ',
  OW: 'oʊ', OY: 'ɔɪ', P: 'p', R: 'r', S: 's', SH: 'ʃ',
  T: 't', TH: 'θ', UH: 'ʊ', UW: 'u', V: 'v', W: 'w',
  Y: 'j', Z: 'z', ZH: 'ʒ',
}

function arpabetToIPA(phones: string): string {
  return phones.split(' ')
    .map((p) => ARPABET_TO_IPA[p.replace(/[0-9]/g, '')] ?? p.toLowerCase())
    .join('')
}

export async function wordToIPA(word: string): Promise<string | null> {
  const d = await getCMUDict()
  const entry = d[word.toUpperCase()]
  if (!entry) return null
  return `/${arpabetToIPA(entry)}/`
}

export async function sentenceToIPA(text: string): Promise<string> {
  const words = text.split(/\s+/)
  const ipas = await Promise.all(words.map((w) => wordToIPA(w.replace(/[^a-zA-Z']/g, ''))))
  return words.map((w, i) => ipas[i] ?? w).join(' ')
}
```

- [ ] **Step 5: Build CMUdict JSON subset**

```bash
# Download CMUdict and convert to JSON (run once, output to public/)
node -e "
const fs = require('fs');
const lines = fs.readFileSync('cmudict.dict', 'utf8').split('\n');
const dict = {};
for (const line of lines) {
  if (line.startsWith(';;;')) continue;
  const [word, ...phones] = line.trim().split(/\s+/);
  if (word && !word.includes('(')) dict[word] = phones.join(' ');
}
fs.writeFileSync('public/cmudict.json', JSON.stringify(dict));
console.log('Written', Object.keys(dict).length, 'entries');
" 
```

> Download CMUdict from `http://svn.code.sf.net/p/cmusphinx/code/trunk/cmudict/cmudict-0.7b` first, save as `cmudict.dict`.

- [ ] **Step 6: Run test — expect pass**

```bash
npx vitest run tests/language/english/phonetics.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add src/language/english/tokenizer.ts src/language/english/phonetics.ts \
  tests/language/english/phonetics.test.ts public/cmudict.json
git commit -m "feat: add English tokenizer (compromise) and IPA phonetics (CMUdict)"
```

---

### Task 29: English grammar highlighting

**Files:**
- Create: `src/language/english/grammar.ts`
- Create: `tests/language/english/grammar.test.ts`

- [ ] **Step 1: Write test**

```ts
// tests/language/english/grammar.test.ts
import { describe, it, expect } from 'vitest'
import { detectEnglishGrammar } from '../../../src/language/english/grammar'

describe('detectEnglishGrammar', () => {
  it('detects present perfect', () => {
    const hits = detectEnglishGrammar("I've been waiting")
    expect(hits.some((h) => h.pattern.toLowerCase().includes('perfect'))).toBe(true)
  })

  it('detects phrasal verb', () => {
    const hits = detectEnglishGrammar('give up')
    expect(hits.some((h) => h.pattern.toLowerCase().includes('phrasal'))).toBe(true)
  })

  it('returns empty for plain noun', () => {
    expect(detectEnglishGrammar('cat')).toEqual([])
  })
})
```

- [ ] **Step 2: Run — expect fail**

```bash
npx vitest run tests/language/english/grammar.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/language/english/grammar.ts
import nlp from 'compromise'
import type { GrammarAnnotation } from '../japanese/grammar'

const PHRASAL_VERBS = [
  'give up', 'look up', 'look for', 'put off', 'take off', 'turn on', 'turn off',
  'get up', 'go on', 'come back', 'find out', 'make up', 'pick up', 'set up',
  'run out', 'break down', 'carry on', 'hold on', 'move on', 'show up',
]

export function detectEnglishGrammar(text: string): GrammarAnnotation[] {
  const annotations: GrammarAnnotation[] = []
  const lower = text.toLowerCase()
  const doc = nlp(text)

  // Present perfect: has/have + past participle
  if (doc.match('(has|have|#PresentPerfect)').found || /\b(have|has|'ve)\s+\w+ed\b/.test(lower)) {
    const idx = lower.search(/(have|has|'ve)\s+\w/)
    if (idx >= 0) {
      annotations.push({
        pattern: 'Present Perfect',
        explanation: 'Connects past action to the present. Japanese: 〜たことがある / 〜ている',
        startIndex: idx,
        endIndex: idx + 12,
      })
    }
  }

  // Present perfect continuous: has/have been + -ing
  if (/\b(have|has|'ve)\s+been\s+\w+ing\b/.test(lower)) {
    const idx = lower.search(/(have|has|'ve)\s+been/)
    annotations.push({
      pattern: 'Present Perfect Continuous',
      explanation: 'Ongoing action that started in the past. Japanese: 〜し続けている',
      startIndex: idx,
      endIndex: idx + 15,
    })
  }

  // Contractions
  const contractionMatches = [...lower.matchAll(/\b(i'm|you're|he's|she's|it's|we're|they're|i've|i'll|can't|won't|don't|doesn't|didn't)\b/g)]
  for (const m of contractionMatches) {
    annotations.push({
      pattern: 'Contraction',
      explanation: `"${m[0]}" is a contraction. Full form: ${expandContraction(m[0])}`,
      startIndex: m.index!,
      endIndex: m.index! + m[0].length,
    })
  }

  // Phrasal verbs
  for (const pv of PHRASAL_VERBS) {
    const idx = lower.indexOf(pv)
    if (idx >= 0) {
      annotations.push({
        pattern: `Phrasal Verb: "${pv}"`,
        explanation: `"${pv}" is a phrasal verb with a unique meaning. Look it up in context.`,
        startIndex: idx,
        endIndex: idx + pv.length,
      })
    }
  }

  return annotations
}

function expandContraction(c: string): string {
  const map: Record<string, string> = {
    "i'm": 'I am', "you're": 'you are', "he's": 'he is / he has',
    "she's": 'she is / she has', "it's": 'it is / it has',
    "we're": 'we are', "they're": 'they are', "i've": 'I have',
    "i'll": 'I will', "can't": 'cannot', "won't": 'will not',
    "don't": 'do not', "doesn't": 'does not', "didn't": 'did not',
  }
  return map[c] ?? c
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
npx vitest run tests/language/english/grammar.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/language/english/grammar.ts tests/language/english/grammar.test.ts
git commit -m "feat: add English grammar detection (perfect, contractions, phrasal verbs)"
```

---

### Task 30: WordAlignment component

**Files:**
- Create: `src/language/WordAlignment.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/language/WordAlignment.tsx
import React, { useState } from 'react'
import type { Token, GrammarAnnotation } from '../core/types'

// Re-export GrammarAnnotation from core types for shared use
// (add GrammarAnnotation to src/core/types/index.ts):
// export interface GrammarAnnotation { pattern: string; explanation: string; startIndex: number; endIndex: number }

interface Props {
  tokens: Token[]
  grammarAnnotations: GrammarAnnotation[]
  onTokenHover?: (token: Token | null) => void
}

export function WordAlignment({ tokens, grammarAnnotations, onTokenHover }: Props) {
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null)

  function annotationForRange(start: number, end: number): GrammarAnnotation | null {
    return grammarAnnotations.find(
      (a) => a.startIndex <= start && a.endIndex >= end
    ) ?? null
  }

  return (
    <div className="relative flex flex-wrap gap-0.5 justify-center">
      {tokens.map((token, i) => {
        const grammar = annotationForRange(token.startIndex, token.endIndex)
        return (
          <span
            key={i}
            className={[
              'cursor-pointer transition-colors rounded px-0.5',
              grammar ? 'border-b-2 border-dotted border-cinnabar-accent' : '',
            ].join(' ')}
            onMouseEnter={(e) => {
              if (grammar) {
                const rect = e.currentTarget.getBoundingClientRect()
                setTooltip({ text: `${grammar.pattern}: ${grammar.explanation}`, x: rect.left, y: rect.top - 8 })
              }
              onTokenHover?.(token)
            }}
            onMouseLeave={() => { setTooltip(null); onTokenHover?.(null) }}
          >
            {token.surface}
          </span>
        )
      })}

      {tooltip && (
        <div
          className="fixed z-50 bg-cinnabar-900 border border-cinnabar-800 text-white text-xs rounded-lg px-3 py-2 max-w-xs pointer-events-none shadow-xl"
          style={{ left: tooltip.x, top: tooltip.y, transform: 'translate(-50%, -100%)' }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Integrate into LyricDisplay**

In `src/lyrics/LyricDisplay.tsx`, inside the active line render, add below the translation:

```tsx
{isActive && line.tokens && line.tokens.length > 0 && (
  <div className="mt-2">
    <WordAlignment
      tokens={line.tokens}
      grammarAnnotations={line.grammarAnnotations ?? []}
    />
  </div>
)}
```

Add `grammarAnnotations?: GrammarAnnotation[]` to `TimedLine` in `src/core/types/index.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/language/WordAlignment.tsx
git commit -m "feat: add WordAlignment component with grammar tooltip on hover"
```

---

### Task 31: Enrich lyrics with NLP on load

**Files:**
- Modify: `src/player/PlayerView.tsx`

- [ ] **Step 1: Add NLP enrichment after song loads**

After loading the song from Dexie and calling `setLines()`, add:

```ts
// In PlayerView.tsx, inside the useEffect that loads the song:
import { tokenizeJapanese } from '../language/japanese/tokenizer'
import { toRomaji } from '../language/japanese/phonetics'
import { detectGrammarPatterns } from '../language/japanese/grammar'
import { tokenizeEnglish } from '../language/english/tokenizer'
import { sentenceToIPA } from '../language/english/phonetics'
import { detectEnglishGrammar } from '../language/english/grammar'

async function enrichLines(lines: TimedLine[], sourceLanguage: Language): Promise<TimedLine[]> {
  return Promise.all(lines.map(async (line): Promise<TimedLine> => {
    if (sourceLanguage === 'ja') {
      const [tokens, reading] = await Promise.all([
        tokenizeJapanese(line.original),
        toRomaji(line.original),
      ])
      const grammarAnnotations = detectGrammarPatterns(line.original)
      return { ...line, tokens, reading, grammarAnnotations }
    } else {
      const [tokens, reading] = await Promise.all([
        Promise.resolve(tokenizeEnglish(line.original)),
        sentenceToIPA(line.original),
      ])
      const grammarAnnotations = detectEnglishGrammar(line.original)
      return { ...line, tokens, reading, grammarAnnotations }
    }
  }))
}

// Call after setLines:
enrichLines(s.lyrics.lines, s.lyrics.sourceLanguage).then((enriched) => {
  setLines(enriched)
  db.songs.update(s.id, { 'lyrics.lines': enriched })
})
```

- [ ] **Step 2: Commit**

```bash
git commit -am "feat: enrich lyrics lines with NLP tokens, phonetics, and grammar on load"
```

---

### Task 32: LRC/SRT export

**Files:**
- Create: `src/lyrics/exporter.ts`
- Create: `tests/lyrics/exporter.test.ts`

- [ ] **Step 1: Write test**

```ts
// tests/lyrics/exporter.test.ts
import { describe, it, expect } from 'vitest'
import { exportLRC, exportSRT } from '../../src/lyrics/exporter'
import type { TimedLine } from '../../src/core/types'

const lines: TimedLine[] = [
  { startTime: 12.5, endTime: 15.2, original: '星に願いを', translation: 'Wish upon a star' },
  { startTime: 15.2, endTime: 18.9, original: '夢の中で', translation: 'In my dreams' },
]

describe('exportLRC', () => {
  it('produces valid LRC format', () => {
    const lrc = exportLRC(lines)
    expect(lrc).toContain('[00:12.50]')
    expect(lrc).toContain('星に願いを')
  })

  it('can export translation instead of original', () => {
    const lrc = exportLRC(lines, 'translation')
    expect(lrc).toContain('Wish upon a star')
  })
})

describe('exportSRT', () => {
  it('produces valid SRT format', () => {
    const srt = exportSRT(lines)
    expect(srt).toContain('1\n')
    expect(srt).toContain('00:00:12,500 --> 00:00:15,200')
    expect(srt).toContain('星に願いを')
  })
})
```

- [ ] **Step 2: Run — expect fail**

```bash
npx vitest run tests/lyrics/exporter.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/lyrics/exporter.ts
import type { TimedLine } from '../core/types'

function pad(n: number, len: number): string {
  return n.toString().padStart(len, '0')
}

function toMMSSCS(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  const cs = Math.round((seconds % 1) * 100)
  return `${pad(m, 2)}:${pad(s, 2)}.${pad(cs, 2)}`
}

function toHHMMSSMS(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.round((seconds % 1) * 1000)
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms, 3)}`
}

export function exportLRC(lines: TimedLine[], field: 'original' | 'translation' = 'original'): string {
  return lines
    .map((l) => `[${toMMSSCS(l.startTime)}]${l[field]}`)
    .join('\n')
}

export function exportSRT(lines: TimedLine[], field: 'original' | 'translation' = 'original'): string {
  return lines.map((l, i) =>
    `${i + 1}\n${toHHMMSSMS(l.startTime)} --> ${toHHMMSSMS(l.endTime)}\n${l[field]}\n`
  ).join('\n')
}

export function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
npx vitest run tests/lyrics/exporter.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lyrics/exporter.ts tests/lyrics/exporter.test.ts
git commit -m "feat: add LRC and SRT export with original/translation toggle"
```

---

### Task 33: Cloze mode

**Files:**
- Create: `src/cloze/ClozeEngine.ts`
- Create: `src/cloze/ClozeOverlay.tsx`
- Create: `tests/cloze/ClozeEngine.test.ts`

- [ ] **Step 1: Write test**

```ts
// tests/cloze/ClozeEngine.test.ts
import { describe, it, expect } from 'vitest'
import { selectClozeTokens } from '../../src/cloze/ClozeEngine'
import type { Token } from '../../src/core/types'

const tokens: Token[] = [
  { surface: '星', pos: '名詞', startIndex: 0, endIndex: 1 },
  { surface: 'に', pos: '助詞', startIndex: 1, endIndex: 2 },
  { surface: '願い', pos: '名詞', startIndex: 2, endIndex: 4 },
  { surface: 'を', pos: '助詞', startIndex: 4, endIndex: 5 },
]

describe('selectClozeTokens', () => {
  it('easy: blanks content words only', () => {
    const blanked = selectClozeTokens(tokens, 'easy')
    // Content words (nouns, verbs) should be blanked; particles not
    const blankedSurfaces = blanked.filter((t) => t.blanked).map((t) => t.surface)
    expect(blankedSurfaces).toContain('星')
    expect(blankedSurfaces).not.toContain('に')
  })

  it('hard: blanks more tokens', () => {
    const easy = selectClozeTokens(tokens, 'easy').filter((t) => t.blanked).length
    const hard = selectClozeTokens(tokens, 'hard').filter((t) => t.blanked).length
    expect(hard).toBeGreaterThanOrEqual(easy)
  })
})
```

- [ ] **Step 2: Run — expect fail**

```bash
npx vitest run tests/cloze/ClozeEngine.test.ts
```

- [ ] **Step 3: Implement ClozeEngine**

```ts
// src/cloze/ClozeEngine.ts
import type { Token, ClozeDifficulty } from '../core/types'

export interface ClozeToken extends Token {
  blanked: boolean
}

const CONTENT_POS = new Set(['名詞', 'Noun', 'Verb', 'Adjective', '動詞', '形容詞', '形容動詞'])
const FUNCTION_POS = new Set(['助詞', 'Conjunction', '助動詞', 'Determiner', 'Preposition'])

export function selectClozeTokens(tokens: Token[], difficulty: ClozeDifficulty): ClozeToken[] {
  return tokens.map((token): ClozeToken => {
    const pos = token.pos ?? ''
    const isContent = CONTENT_POS.has(pos)
    const isFunction = FUNCTION_POS.has(pos)

    let blanked = false
    if (difficulty === 'easy') blanked = isContent
    else if (difficulty === 'medium') blanked = isContent || Math.random() < 0.3
    else blanked = !isFunction // hard: blank almost everything

    return { ...token, blanked }
  })
}
```

- [ ] **Step 4: Implement ClozeOverlay**

```tsx
// src/cloze/ClozeOverlay.tsx
import React, { useState, useEffect } from 'react'
import { selectClozeTokens, type ClozeToken } from './ClozeEngine'
import type { TimedLine, ClozeDifficulty } from '../core/types'

interface Props {
  line: TimedLine
  difficulty: ClozeDifficulty
  revealed: boolean
}

export function ClozeOverlay({ line, difficulty, revealed }: Props) {
  const [tokens, setTokens] = useState<ClozeToken[]>([])

  useEffect(() => {
    if (line.tokens) setTokens(selectClozeTokens(line.tokens, difficulty))
  }, [line, difficulty])

  if (!line.tokens) return <span className="text-white">{line.original}</span>

  return (
    <div className="flex flex-wrap gap-0.5 justify-center font-jp text-2xl font-semibold">
      {tokens.map((t, i) => (
        <span key={i} className="relative">
          {t.blanked && !revealed ? (
            <span className="inline-block min-w-[1.5em] border-b-2 border-cinnabar-accent text-transparent">
              {t.surface}
            </span>
          ) : (
            <span className={t.blanked ? 'text-cinnabar-accent' : 'text-white'}>
              {t.surface}
            </span>
          )}
        </span>
      ))}
    </div>
  )
}
```

- [ ] **Step 5: Wire into PlayerView**

In `PlayerView.tsx`, wrap the active line original text with `ClozeOverlay` when `clozeMode === true`:

```tsx
{clozeMode ? (
  <ClozeOverlay
    line={activeLine >= 0 ? lines[activeLine] : { original: '', translation: '', startTime: 0, endTime: 0 }}
    difficulty={clozeDifficulty}
    revealed={position > (lines[activeLine]?.endTime ?? 0)}
  />
) : (
  <LyricDisplay onSeek={seek} />
)}
```

- [ ] **Step 6: Run all tests**

```bash
npx vitest run
```
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/cloze/ClozeEngine.ts src/cloze/ClozeOverlay.tsx tests/cloze/ClozeEngine.test.ts
git commit -m "feat: add cloze mode with difficulty-based token blanking and auto-reveal"
```

---

## PHASE 5 — Monetisation, Polish & Store Wrap

### Task 34: JWT license verification

**Files:**
- Create: `src/payment/license.ts`
- Create: `tests/payment/license.test.ts`

- [ ] **Step 1: Write test**

```ts
// tests/payment/license.test.ts
import { describe, it, expect, vi } from 'vitest'

// We test the structure, not actual cryptography (jose requires crypto which jsdom supports)
import { verifyLicense, type LicenseClaims } from '../../src/payment/license'

describe('verifyLicense', () => {
  it('rejects an obviously invalid token', async () => {
    const result = await verifyLicense('not.a.jwt')
    expect(result.valid).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('returns valid=false for expired token (structure check)', async () => {
    // Expired token — still confirms our error handling path
    const result = await verifyLicense('eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ0ZXN0IiwiZXhwIjoxfQ.invalid')
    expect(result.valid).toBe(false)
  })
})
```

- [ ] **Step 2: Implement**

```ts
// src/payment/license.ts
import { jwtVerify, importSPKI } from 'jose'

// Replace with your actual LemonSqueezy public key after setup
const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
YOUR_LEMONSQUEEZY_PUBLIC_KEY_HERE
-----END PUBLIC KEY-----`

export interface LicenseClaims {
  sub: string          // license key
  orderId: string
  email: string
  iat: number
  exp: number
}

export interface LicenseResult {
  valid: boolean
  claims?: LicenseClaims
  error?: string
}

let cachedKey: CryptoKey | null = null

async function getPublicKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey
  cachedKey = await importSPKI(PUBLIC_KEY_PEM, 'ES256')
  return cachedKey
}

export async function verifyLicense(token: string): Promise<LicenseResult> {
  try {
    const key = await getPublicKey()
    const { payload } = await jwtVerify(token, key, { algorithms: ['ES256'] })
    return { valid: true, claims: payload as unknown as LicenseClaims }
  } catch (e: any) {
    return { valid: false, error: e.message }
  }
}
```

- [ ] **Step 3: Run test — expect pass**

```bash
npx vitest run tests/payment/license.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/payment/license.ts tests/payment/license.test.ts
git commit -m "feat: add JWT license verification with embedded public key via jose"
```

---

### Task 35: LemonSqueezy checkout integration

**Files:**
- Modify: `src/payment/UpgradeModal.tsx`

- [ ] **Step 1: Add LemonSqueezy overlay script**

In `index.html`, add before `</head>`:

```html
<script src="https://app.lemonsqueezy.com/js/lemon.js" defer></script>
```

- [ ] **Step 2: Update UpgradeModal to open checkout**

Replace the "Unlock Pro" button handler:

```tsx
// Add to UpgradeModal.tsx imports:
import { verifyLicense } from './license'
import { useSettingsStore } from './SettingsStore'

// Replace the Unlock Pro button:
const { setLicense } = useSettingsStore()
const [keyInput, setKeyInput] = React.useState('')
const [keyError, setKeyError] = React.useState('')

const handleCheckout = () => {
  // Replace PRODUCT_URL with your LemonSqueezy product overlay URL
  const CHECKOUT_URL = 'https://utasync.lemonsqueezy.com/checkout/buy/YOUR_PRODUCT_ID'
  ;(window as any).LemonSqueezy?.Url.Open(CHECKOUT_URL)
}

const handleRestoreKey = async () => {
  setKeyError('')
  const result = await verifyLicense(keyInput.trim())
  if (result.valid) {
    setLicense(keyInput.trim())
    onClose()
  } else {
    setKeyError('Invalid or expired license key.')
  }
}

// In JSX, replace the Unlock Pro button block:
<button
  onClick={handleCheckout}
  className="w-full py-3 bg-white text-cinnabar-950 rounded-xl font-bold"
>
  Unlock Pro — $9.99
</button>

<div className="space-y-2 pt-2 border-t border-cinnabar-800">
  <p className="text-white/30 text-xs text-center">Already purchased?</p>
  <input
    value={keyInput}
    onChange={(e) => setKeyInput(e.target.value)}
    placeholder="Paste license key…"
    className="w-full px-3 py-2 bg-cinnabar-800 text-white rounded-lg text-sm outline-none"
  />
  <button onClick={handleRestoreKey}
    className="w-full py-2 border border-cinnabar-accent text-cinnabar-accent rounded-lg text-sm">
    Restore License
  </button>
  {keyError && <p className="text-red-400 text-xs text-center">{keyError}</p>}
</div>
```

- [ ] **Step 3: Commit**

```bash
git commit -am "feat: wire LemonSqueezy checkout overlay and license key restore"
```

---

### Task 36: Settings screen — storage management

**Files:**
- Create: `src/settings/SettingsView.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/settings/SettingsView.tsx
import React, { useEffect, useState } from 'react'
import { db } from '../core/db/schema'
import { deleteAudio } from '../core/opfs/audio'
import { estimateQuota, formatBytes } from '../core/storage/quota'
import { exportLRC, downloadFile } from '../lyrics/exporter'
import { useSettingsStore } from '../payment/SettingsStore'
import type { Song } from '../core/types'

interface Props {
  onClose: () => void
}

export function SettingsView({ onClose }: Props) {
  const [songs, setSongs] = useState<Song[]>([])
  const [quota, setQuota] = useState<{ used: number; total: number; ratio: number } | null>(null)
  const { isPro, trialSongsClaimed, theme } = useSettingsStore()

  useEffect(() => {
    db.songs.toArray().then(setSongs)
    estimateQuota().then(setQuota)
  }, [])

  const deleteSong = async (song: Song) => {
    if (song.audioStoredPath) await deleteAudio(song.id)
    await db.songs.delete(song.id)
    setSongs((prev) => prev.filter((s) => s.id !== song.id))
  }

  const clearModelCache = async () => {
    const cache = await caches.open('ai-models-v1')
    const keys = await cache.keys()
    await Promise.all(keys.map((k) => cache.delete(k)))
    estimateQuota().then(setQuota)
  }

  return (
    <div className="min-h-screen bg-cinnabar-950 text-white p-4 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Settings</h1>
        <button onClick={onClose} className="text-white/40 hover:text-white">✕</button>
      </div>

      {/* License status */}
      <div className="bg-cinnabar-900 rounded-xl p-4 space-y-1">
        <p className="text-sm font-medium">License</p>
        {isPro
          ? <p className="text-green-400 text-sm">✓ Pro — lifetime access</p>
          : <p className="text-white/50 text-sm">{trialSongsClaimed}/2 trial songs used</p>}
      </div>

      {/* Storage */}
      {quota && (
        <div className="bg-cinnabar-900 rounded-xl p-4 space-y-2">
          <p className="text-sm font-medium">Storage</p>
          <div className="h-2 bg-cinnabar-800 rounded-full">
            <div
              className={`h-full rounded-full transition-all ${quota.ratio > 0.8 ? 'bg-red-500' : 'bg-cinnabar-accent'}`}
              style={{ width: `${Math.min(quota.ratio * 100, 100)}%` }}
            />
          </div>
          <p className="text-xs text-white/40">{formatBytes(quota.used)} of {formatBytes(quota.total)} used</p>
          {quota.ratio > 0.8 && (
            <p className="text-red-400 text-xs">Storage nearly full. Delete songs to free space.</p>
          )}
          <button onClick={clearModelCache} className="text-xs text-white/30 hover:text-white underline">
            Clear AI model cache
          </button>
        </div>
      )}

      {/* Song library */}
      <div className="space-y-2">
        <p className="text-sm font-medium">Song Library</p>
        {songs.length === 0 && <p className="text-white/30 text-sm">No songs saved.</p>}
        {songs.map((song) => (
          <div key={song.id} className="bg-cinnabar-900 rounded-xl p-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{song.title}</p>
              <p className="text-xs text-white/40">{song.artist}</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => downloadFile(exportLRC(song.lyrics.lines), `${song.title}.lrc`, 'text/plain')}
                className="text-xs text-white/40 hover:text-white"
              >
                LRC
              </button>
              <button onClick={() => deleteSong(song)} className="text-xs text-red-400 hover:text-red-300">
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire into App.tsx**

Add a `view` state to `App.tsx`:

```tsx
type View = 'home' | 'player' | 'settings'
const [view, setView] = useState<View>('home')
const [songId, setSongId] = useState<string | null>(null)

if (view === 'settings') return <SettingsView onClose={() => setView(songId ? 'player' : 'home')} />
if (view === 'player' && songId) return <PlayerView songId={songId} onBack={() => setView('home')} onSettings={() => setView('settings')} />
return <LinkParser onSongReady={(id) => { setSongId(id); setView('player') }} onSettings={() => setView('settings')} />
```

- [ ] **Step 3: Add "Settings" button to PlayerView top bar**

Replace the existing `<button className="text-white/40 hover:text-white text-xs">Settings</button>` with:

```tsx
<button onClick={onSettings} className="text-white/40 hover:text-white text-xs">Settings</button>
```

And add `onSettings: () => void` to `PlayerView` Props interface.

- [ ] **Step 4: Commit**

```bash
git add src/settings/SettingsView.tsx
git commit -am "feat: add SettingsView with storage management, song library, LRC export"
```

---

### Task 37: Quota warning toast

**Files:**
- Create: `src/core/ui/Toast.tsx`
- Modify: `src/main.tsx`

- [ ] **Step 1: Implement Toast**

```tsx
// src/core/ui/Toast.tsx
import React, { createContext, useContext, useState, useCallback } from 'react'

interface ToastItem { id: number; message: string; type: 'info' | 'warning' | 'error' }

const ToastContext = createContext<(msg: string, type?: ToastItem['type']) => void>(() => {})

export function useToast() { return useContext(ToastContext) }

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const show = useCallback((message: string, type: ToastItem['type'] = 'info') => {
    const id = Date.now()
    setToasts((prev) => [...prev, { id, message, type }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000)
  }, [])

  const color = { info: 'bg-cinnabar-900', warning: 'bg-yellow-900', error: 'bg-red-900' }

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 flex flex-col gap-2 z-50 pointer-events-none">
        {toasts.map((t) => (
          <div key={t.id} className={`${color[t.type]} text-white text-sm px-4 py-2 rounded-xl shadow-lg`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
```

- [ ] **Step 2: Wrap App with ToastProvider**

In `src/main.tsx`:

```tsx
import { ToastProvider } from './core/ui/Toast'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>
)
```

- [ ] **Step 3: Add quota check on startup**

In `src/App.tsx`, add `useEffect`:

```tsx
import { estimateQuota } from './core/storage/quota'
import { useToast } from './core/ui/Toast'

const toast = useToast()
useEffect(() => {
  estimateQuota().then(({ ratio }) => {
    if (ratio > 0.8) toast('Storage nearly full. Visit Settings to free space.', 'warning')
  })
}, [])
```

- [ ] **Step 4: Commit**

```bash
git add src/core/ui/Toast.tsx
git commit -am "feat: add Toast notifications and storage quota warning on startup"
```

---

### Task 38: Mobile polish

- [ ] **Step 1: Add viewport meta and safe area support**

In `index.html`:

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
```

- [ ] **Step 2: Add safe area insets to PlayerView**

Replace `className="px-4 pb-6 pt-2 space-y-3"` on the controls div with:

```tsx
className="px-4 pb-[env(safe-area-inset-bottom,24px)] pt-2 space-y-3"
```

- [ ] **Step 3: Add touch-action for lyric scroll**

On `LyricDisplay`'s wrapper div, add `style={{ touchAction: 'pan-y' }}`.

- [ ] **Step 4: Test on iPhone Safari**

Open `npm run build && npx vite preview` on local network. On iPhone:
- Verify lyrics display without clipping near notch/home bar
- Verify tap-to-seek works on lyrics
- Verify play/pause responds without delay (add `touch-manipulation` class to buttons)

- [ ] **Step 5: Add PWA icons**

```bash
# Generate icons from a source 512x512 SVG/PNG using sharp or squoosh
# Place as public/icon-192.png and public/icon-512.png
```

- [ ] **Step 6: Commit**

```bash
git commit -am "feat: mobile polish — safe area, touch handling, PWA icons"
```

---

### Task 39: Final test pass + production build

- [ ] **Step 1: Run full test suite**

```bash
npx vitest run
```
Expected: all tests pass, no failures.

- [ ] **Step 2: Build for production**

```bash
npm run build
```
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 3: Verify bundle sizes**

```bash
npx vite-bundle-visualizer
```
Check: app shell JS < 400KB gzipped. If exceeded, use dynamic imports for language modules:

```ts
// In PlayerView.tsx, lazy-load NLP:
const { tokenizeJapanese } = await import('../language/japanese/tokenizer')
```

- [ ] **Step 4: Verify service worker**

```bash
npx vite preview
```
Open Chrome DevTools → Application → Service Workers. Confirm:
- Service worker registered and active
- App shell cached (offline works after first load)
- AI model URLs match `CacheFirst` rule pattern

- [ ] **Step 5: Lighthouse audit**

Run Lighthouse in Chrome DevTools on `http://localhost:4173`.
Target: PWA score ≥ 90, Performance ≥ 75, Accessibility ≥ 90.

- [ ] **Step 6: Commit**

```bash
git commit -am "chore: final production build verification and bundle optimisation"
```

---

### Task 40: Optional — PWABuilder app store wrap

- [ ] **Step 1: Submit to PWABuilder**

Visit https://www.pwabuilder.com, enter your deployed app URL.
Expected: green PWA score, package options for Windows Store, Google Play, App Store.

- [ ] **Step 2: Generate iOS package**

In PWABuilder: iOS → Generate → Download package.
Follow Apple Developer instructions for TestFlight submission.

- [ ] **Step 3: Generate Android package**

In PWABuilder: Android (TWA) → Generate → Download package.
Follow Google Play Console instructions for internal testing.

- [ ] **Step 4: Commit**

```bash
git commit -am "chore: add PWABuilder notes for app store submissions"
```

---

## Self-Review Checklist

Run through this before declaring the plan complete:

- [x] **LRC parser** → Task 5 ✓
- [x] **OPFS audio** → Task 4 ✓
- [x] **YouTube oEmbed** → Task 12 ✓
- [x] **LRCLIB** → Task 13 ✓
- [x] **YouTube IFrame embed** → Task 16 ✓
- [x] **Pro/free feature gates** → Tasks 14, 15 ✓
- [x] **Trial counter** → Task 14 ✓
- [x] **Local audio upload + playback** → Task 7 + Task 15 (LinkParser handles file upload) ✓
- [x] **Speed control (SoundTouchJS)** → Task 17 ✓
- [x] **A-B loop + AudioWorklet** → Task 18 ✓
- [x] **Whisper worker** → Task 21 ✓
- [x] **Vocal separation** → Task 22 ✓
- [x] **Auto-align flow** → Task 23 ✓
- [x] **Device tier detection** → Task 19 ✓
- [x] **Japanese NLP** → Tasks 25, 26, 27 ✓
- [x] **English NLP** → Tasks 28, 29 ✓
- [x] **WordAlignment + grammar tooltips** → Task 30 ✓
- [x] **Cloze mode** → Task 33 ✓
- [x] **LRC/SRT export** → Task 32 ✓
- [x] **JWT license verification** → Task 34 ✓
- [x] **LemonSqueezy checkout** → Task 35 ✓
- [x] **License key restore** → Task 35 ✓
- [x] **Storage management UI** → Task 36 ✓
- [x] **Quota warnings** → Task 37 ✓
- [x] **PWA shell + offline** → Task 11 ✓
- [x] **Mobile polish** → Task 38 ✓
- [x] **Cinnabar theme** → Task 1 ✓
- [x] **Focus-mode karaoke layout** → Task 8 ✓
- [x] **Tap-to-sync editor** → Task 10 ✓
- [x] **Phonetic toggle (romaji/IPA)** → Tasks 26, 28 + Task 8 (LyricDisplay reads `line.reading`) ✓
- [x] **Line-click seeking** → Task 8 (`onSeek` prop) ✓

**Missing item identified:** `AlignmentEditor.tsx` (line pairing UI for mismatched lyrics) is in the file map but has no task.

### Task 41: AlignmentEditor (gap fill)

**Files:**
- Create: `src/lyrics/AlignmentEditor.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/lyrics/AlignmentEditor.tsx
import React, { useState } from 'react'
import type { TimedLine } from '../core/types'

interface Props {
  originalLines: string[]
  translationLines: string[]
  onConfirm: (pairs: Array<{ original: string; translation: string }>) => void
}

export function AlignmentEditor({ originalLines, translationLines, onConfirm }: Props) {
  const maxLen = Math.max(originalLines.length, translationLines.length)
  const [pairs, setPairs] = useState<Array<{ original: string; translation: string }>>(
    Array.from({ length: maxLen }, (_, i) => ({
      original: originalLines[i] ?? '',
      translation: translationLines[i] ?? '',
    }))
  )

  const updatePair = (i: number, field: 'original' | 'translation', value: string) => {
    setPairs((prev) => prev.map((p, j) => j === i ? { ...p, [field]: value } : p))
  }

  const addRow = () => setPairs((prev) => [...prev, { original: '', translation: '' }])
  const removeRow = (i: number) => setPairs((prev) => prev.filter((_, j) => j !== i))

  return (
    <div className="min-h-screen bg-cinnabar-950 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-white font-semibold">Align Lines</h2>
        <p className="text-white/40 text-xs">Line counts differ — fix pairings below</p>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs text-white/40 px-1">
        <span>Original</span>
        <span>Translation</span>
      </div>

      <div className="space-y-2 max-h-[60vh] overflow-y-auto">
        {pairs.map((pair, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
            <input
              value={pair.original}
              onChange={(e) => updatePair(i, 'original', e.target.value)}
              className="bg-cinnabar-900 text-white text-sm px-2 py-1 rounded-lg outline-none border border-cinnabar-800 focus:border-cinnabar-accent font-jp"
            />
            <input
              value={pair.translation}
              onChange={(e) => updatePair(i, 'translation', e.target.value)}
              className="bg-cinnabar-900 text-white text-sm px-2 py-1 rounded-lg outline-none border border-cinnabar-800 focus:border-cinnabar-accent"
            />
            <button onClick={() => removeRow(i)} className="text-red-400 text-xs hover:text-red-300">✕</button>
          </div>
        ))}
      </div>

      <button onClick={addRow} className="text-cinnabar-accent text-sm underline">+ Add line</button>

      <button
        onClick={() => onConfirm(pairs.filter((p) => p.original))}
        className="w-full py-3 bg-cinnabar-accent text-white rounded-xl font-medium"
      >
        Confirm Pairings
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Wire into LinkParser**

In `LinkParser.tsx`, after fetching lyrics and before saving the song, compare line counts:

```tsx
if (plainLyrics && translationLyrics) {
  const origLines = plainLyrics.split('\n').filter(Boolean)
  const transLines = translationLyrics.split('\n').filter(Boolean)
  if (origLines.length !== transLines.length) {
    setShowAlignmentEditor({ orig: origLines, trans: transLines })
    return  // Wait for user to confirm
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lyrics/AlignmentEditor.tsx
git commit -am "feat: add AlignmentEditor for mismatched lyric line counts"
```

---

## All Tasks Complete

Run the full suite one final time:

```bash
npx vitest run && npm run build
```

Expected: all tests pass, build succeeds.
