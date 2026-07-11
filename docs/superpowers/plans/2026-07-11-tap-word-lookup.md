# Tap-to-Look-Up Word Popover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tapping a word in the main lyric display opens a compact dictionary popover (headword, reading, POS, glosses, jisho.org link) so mobile users get Yomitan-like lookups without an extension.

**Architecture:** Reuse the existing per-token `<span>` rendering in `LyricDisplay` as tap targets. A new thin `wordLookup` module resolves a token to glosses via the existing curated + JMdict gloss chain (`lemmaGloss`). A new `WordLookupPopover` renders anchored on wide viewports and as a bottom card on narrow ones. A `tapLookupEnabled` setting (default on) gates the feature so desktop Yomitan users can turn it off.

**Tech Stack:** React + TypeScript, zustand (persisted settings), vitest + @testing-library/react, wanakana (sync kana→romaji), existing kuromoji tokenizer and JMdict gloss map.

**Spec:** `docs/superpowers/specs/2026-07-11-tap-word-lookup-design.md`

**Branch note:** Create/confirm a feature branch before starting (current work sits on `accuracy-round-2`).

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/core/types/index.ts` | Modify | Add `Token.baseForm`, `UserSettings.tapLookupEnabled` |
| `src/language/japanese/tokenizer.ts` | Modify | Extract pure `mapKuromojiTokens`, capture `basic_form` |
| `src/language/japanese/wordLookup.ts` | Create | Token → `WordLookupResult` (headword/reading/pos/glosses), jisho URL |
| `src/payment/SettingsStore.ts` | Modify | `tapLookupEnabled` default + setter |
| `src/settings/SettingsView.tsx` | Modify | "Tap to look up words" toggle card |
| `src/lyrics/WordLookupPopover.tsx` | Create | Popover UI: positioning, loading/empty states, dismiss |
| `src/lyrics/LyricDisplay.tsx` | Modify | Tap wiring: span onClick → popover state at top level |
| `tests/language/japanese/tokenizerMapping.test.ts` | Create | `mapKuromojiTokens` unit tests |
| `tests/language/japanese/wordLookup.test.ts` | Create | Lookup chain unit tests |
| `tests/settings/tapLookup.test.ts` | Create | Settings store default + setter |
| `tests/lyrics/WordLookupPopover.test.tsx` | Create | Popover component tests |
| `tests/lyrics/LyricDisplay.test.tsx` | Modify | Tap wiring + gating tests |

Existing code you will lean on (do not modify):
- `src/ai-pipeline/lyricGloss.ts` — `lemmaGloss(romaji, surface?)` (curated → JMdict → inflection-stem fallback chain) and `kanjiLemmaRomaji(surface)` (kanji → romaji key).
- `src/ai-pipeline/jmdictGloss.ts` — `prepareJmdictStemIndex()` (loads `/jmdict-gloss.json` once, resolves even on fetch failure), `setJmdictGlossForTests(payload)`, `resetJmdictGlossCache()`.
- `src/language/japanese/phonetics.ts` — `katakanaToHiragana(text)` (sync, pure).
- `wanakana` package — `toRomaji` (sync kana→romaji), already used in `src/lyrics/readingDisplay.ts:1`.
- `src/lyrics/TimestampPopover.tsx` — visual style reference for the popover card.

---

### Task 1: Capture kuromoji `basic_form` on tokens

Kuromoji reports the dictionary (lemma) form of conjugated words (泣いた → 泣く) as `basic_form`, but `tokenizeJapanese` currently drops it. Lookups need it. The mapping logic moves into an exported pure function so it is testable without loading the kuromoji dictionary (node tests cannot load `/dict`; the existing `tests/language/japanese/tokenizer.test.ts` mocks the whole module for that reason — leave it alone).

**Files:**
- Modify: `src/core/types/index.ts:26-45` (Token interface)
- Modify: `src/language/japanese/tokenizer.ts`
- Create: `tests/language/japanese/tokenizerMapping.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/language/japanese/tokenizerMapping.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mapKuromojiTokens } from '../../../src/language/japanese/tokenizer'

describe('mapKuromojiTokens', () => {
  it('captures the dictionary form of conjugated words', () => {
    const tokens = mapKuromojiTokens([
      { surface_form: '泣い', reading: 'ナイ', pos: '動詞', basic_form: '泣く' },
      { surface_form: 'た', reading: 'タ', pos: '助動詞', basic_form: 'た' },
    ])
    expect(tokens[0].baseForm).toBe('泣く')
    // Same as the surface — omitted to keep persisted tokens lean.
    expect(tokens[1].baseForm).toBeUndefined()
  })

  it('omits baseForm when kuromoji reports *', () => {
    const tokens = mapKuromojiTokens([
      { surface_form: 'ちゃん', reading: 'チャン', pos: '名詞', basic_form: '*' },
    ])
    expect(tokens[0].baseForm).toBeUndefined()
  })

  it('computes contiguous start/end indices', () => {
    const tokens = mapKuromojiTokens([
      { surface_form: '星', reading: 'ホシ', pos: '名詞' },
      { surface_form: 'に', reading: 'ニ', pos: '助詞' },
    ])
    expect(tokens[0]).toMatchObject({ startIndex: 0, endIndex: 1 })
    expect(tokens[1]).toMatchObject({ startIndex: 1, endIndex: 2 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/language/japanese/tokenizerMapping.test.ts`
Expected: FAIL — `mapKuromojiTokens` is not exported.

- [ ] **Step 3: Implement**

In `src/core/types/index.ts`, add to the `Token` interface after `posDetail1`:

```ts
  /** Kuromoji dictionary (lemma) form when it differs from the surface (泣い → 泣く). */
  baseForm?: string
```

In `src/language/japanese/tokenizer.ts`, replace the body of `tokenizeJapanese` with a call to a new exported pure mapper (keep `applyReadingCorrections` at the end, unchanged):

```ts
import kuromoji, { type Token as KuromojiToken, type Tokenizer } from 'kuromoji'
import type { Token } from '../../core/types'
import { applyReadingCorrections } from './readingCorrections'

// ... getTokenizer() unchanged ...

/** Pure kuromoji→Token mapping, exported for tests (the real dictionary cannot load in node). */
export function mapKuromojiTokens(raw: KuromojiToken[]): Token[] {
  let index = 0
  return raw.map((t): Token => {
    const startIndex = index
    index += t.surface_form.length
    return {
      surface: t.surface_form,
      reading: t.reading,
      pos: t.pos,
      posDetail1: t.pos_detail_1 && t.pos_detail_1 !== '*' ? t.pos_detail_1 : undefined,
      baseForm: t.basic_form && t.basic_form !== '*' && t.basic_form !== t.surface_form ? t.basic_form : undefined,
      startIndex,
      endIndex: index,
    }
  })
}

export async function tokenizeJapanese(text: string): Promise<Token[]> {
  const tokenizer = await getTokenizer()
  return applyReadingCorrections(mapKuromojiTokens(tokenizer.tokenize(text)))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/language/japanese/tokenizerMapping.test.ts tests/language/japanese/tokenizer.test.ts`
Expected: PASS (both files — the old mocked test must still pass).

- [ ] **Step 5: Commit**

```bash
git add src/core/types/index.ts src/language/japanese/tokenizer.ts tests/language/japanese/tokenizerMapping.test.ts
git commit -m "feat(lyrics): capture kuromoji dictionary form on tokens"
```

---

### Task 2: `wordLookup` module

Resolves a tapped token to a compact dictionary result. The heavy lifting (curated overrides, JMdict, inflection stems) already lives in `lemmaGloss`; this module just derives the right romaji key and formats the result.

**Files:**
- Create: `src/language/japanese/wordLookup.ts`
- Create: `tests/language/japanese/wordLookup.test.ts`

- [ ] **Step 1: Verify test fixtures don't collide with curated glosses**

The tests inject fake JMdict data, but `lemmaGloss` consults the static curated maps first, which would shadow the fixtures. Confirm the fixture words are absent from the curated maps:

Run: `grep -n "kawasu\|躱\|toriwake\|とりわけ" src/ai-pipeline/lyricGloss.ts src/ai-pipeline/homographGloss.ts`
Expected: no matches. (If any match, substitute another uncommon word that has no match and adjust the tests below accordingly.)

- [ ] **Step 2: Write the failing tests**

Create `tests/language/japanese/wordLookup.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { lookupWord, jishoSearchUrl } from '../../../src/language/japanese/wordLookup'
import { setJmdictGlossForTests, resetJmdictGlossCache } from '../../../src/ai-pipeline/jmdictGloss'
import type { Token } from '../../../src/core/types'

const tok = (patch: Partial<Token> & { surface: string }): Token => ({
  startIndex: 0,
  endIndex: patch.surface.length,
  ...patch,
})

describe('lookupWord', () => {
  beforeEach(() => {
    setJmdictGlossForTests({
      v: 1,
      source: 'test',
      romaji: { kawasu: 'to dodge; to evade', toriwake: 'especially; above all' },
      kanji: { '躱す': 'kawasu' },
    })
  })

  afterEach(() => {
    resetJmdictGlossCache()
    vi.unstubAllGlobals()
  })

  it('returns null for punctuation', async () => {
    expect(await lookupWord(tok({ surface: '、', pos: '記号' }))).toBeNull()
    expect(await lookupWord(tok({ surface: '!?' }))).toBeNull()
  })

  it('looks up a conjugated verb by its dictionary form', async () => {
    const result = await lookupWord(tok({ surface: '躱し', reading: 'カワシ', pos: '動詞', baseForm: '躱す' }))
    expect(result).not.toBeNull()
    expect(result!.headword).toBe('躱す')
    expect(result!.glosses).toEqual(['to dodge', 'to evade'])
  })

  it('falls back to the surface when there is no baseForm', async () => {
    const result = await lookupWord(tok({ surface: '躱す', reading: 'カワス', pos: '動詞' }))
    expect(result!.headword).toBe('躱す')
    expect(result!.glosses).toEqual(['to dodge', 'to evade'])
  })

  it('resolves kana-only words via their reading', async () => {
    const result = await lookupWord(tok({ surface: 'とりわけ', reading: 'トリワケ', pos: '副詞' }))
    expect(result!.glosses).toEqual(['especially', 'above all'])
    expect(result!.reading).toBe('とりわけ')
  })

  it('converts katakana readings to hiragana', async () => {
    const result = await lookupWord(tok({ surface: '躱し', reading: 'カワシ', pos: '動詞', baseForm: '躱す' }))
    expect(result!.reading).toBe('かわし')
  })

  it('still returns reading and POS when no gloss exists', async () => {
    const result = await lookupWord(tok({ surface: '骨頂', reading: 'コッチョウ', pos: '名詞' }))
    expect(result).not.toBeNull()
    expect(result!.glosses).toEqual([])
    expect(result!.reading).toBe('こっちょう')
    expect(result!.pos).toBe('名詞')
  })

  it('degrades to an empty gloss list when the JMdict fetch fails', async () => {
    resetJmdictGlossCache()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const result = await lookupWord(tok({ surface: '躱す', reading: 'カワス', pos: '動詞' }))
    expect(result).not.toBeNull()
    expect(result!.reading).toBe('かわす')
  })
})

describe('jishoSearchUrl', () => {
  it('URL-encodes the headword', () => {
    expect(jishoSearchUrl('躱す')).toBe(`https://jisho.org/search/${encodeURIComponent('躱す')}`)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/language/japanese/wordLookup.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement**

Create `src/language/japanese/wordLookup.ts`:

```ts
import { toRomaji as kanaToRomaji } from 'wanakana'
import { katakanaToHiragana } from './phonetics'
import { kanjiLemmaRomaji, lemmaGloss } from '../../ai-pipeline/lyricGloss'
import { prepareJmdictStemIndex } from '../../ai-pipeline/jmdictGloss'
import type { Token } from '../../core/types'

export interface WordLookupResult {
  /** Dictionary form when known, else the surface. */
  headword: string
  /** Hiragana reading, when the tokenizer supplied one. */
  reading: string | null
  pos: string | null
  /** Empty when no dictionary entry was found — the popup still shows the reading. */
  glosses: string[]
}

const HAS_JA_CHAR = /[぀-ヿ一-鿿々]/

export function jishoSearchUrl(headword: string): string {
  return `https://jisho.org/search/${encodeURIComponent(headword)}`
}

/**
 * Compact lookup for the tap-to-look-up popover. Resolves a romaji lemma key
 * (curated kanji map → JMdict kanji map → kana reading) and reuses the
 * curated-first lemmaGloss chain. Null only for tokens with no Japanese
 * characters (punctuation, latin interjections).
 */
export async function lookupWord(token: Token): Promise<WordLookupResult | null> {
  if (!HAS_JA_CHAR.test(token.surface)) return null

  // Loads the JMdict map + stem index once; resolves (with curated-only
  // coverage) even when the fetch fails.
  await prepareJmdictStemIndex()

  const headword = token.baseForm ?? token.surface
  const reading = token.reading ? katakanaToHiragana(token.reading) : null
  const romaji =
    kanjiLemmaRomaji(headword) ??
    kanjiLemmaRomaji(token.surface) ??
    (reading ? kanaToRomaji(reading).toLowerCase() : undefined)
  const gloss = romaji ? lemmaGloss(romaji, headword) : undefined

  return {
    headword,
    reading,
    pos: token.pos ?? null,
    glosses: gloss ? gloss.split(/\s*;\s*/).filter(Boolean) : [],
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/language/japanese/wordLookup.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/language/japanese/wordLookup.ts tests/language/japanese/wordLookup.test.ts
git commit -m "feat(lyrics): word lookup module for tap-to-look-up popover"
```

---

### Task 3: `tapLookupEnabled` setting

Default **on**. zustand `persist` shallow-merges stored state over defaults, so existing users (whose persisted blob lacks the key) get `true` automatically.

**Files:**
- Modify: `src/core/types/index.ts` (`UserSettings`, ~line 154)
- Modify: `src/payment/SettingsStore.ts`
- Modify: `src/settings/SettingsView.tsx`
- Create: `tests/settings/tapLookup.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/settings/tapLookup.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { useSettingsStore } from '../../src/payment/SettingsStore'

describe('tapLookupEnabled setting', () => {
  it('defaults to on', () => {
    expect(useSettingsStore.getState().tapLookupEnabled).toBe(true)
  })

  it('can be toggled', () => {
    useSettingsStore.getState().setTapLookupEnabled(false)
    expect(useSettingsStore.getState().tapLookupEnabled).toBe(false)
    useSettingsStore.getState().setTapLookupEnabled(true)
    expect(useSettingsStore.getState().tapLookupEnabled).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/settings/tapLookup.test.ts`
Expected: FAIL — property undefined.

- [ ] **Step 3: Implement**

In `src/core/types/index.ts`, add to `UserSettings`:

```ts
  /** Tap a lyric word to open the built-in dictionary popover. Off lets desktop Yomitan users avoid double popups. */
  tapLookupEnabled: boolean
```

In `src/payment/SettingsStore.ts`, add to the `SettingsState` interface:

```ts
  setTapLookupEnabled: (enabled: boolean) => void
```

and to the store defaults/actions:

```ts
      tapLookupEnabled: true,
      setTapLookupEnabled: (tapLookupEnabled) => set({ tapLookupEnabled }),
```

In `src/settings/SettingsView.tsx`, pull the new state in the existing destructure (line 35):

```ts
  const { defaultSongLanguage, setDefaultSongLanguage, vocalSeparationEnabled, setVocalSeparationEnabled, readingMode, setReadingMode, tapLookupEnabled, setTapLookupEnabled } = useSettingsStore()
```

and add a card after the Furigana card (after ~line 182), following the exact toggle pattern used there:

```tsx
      <div className="bg-cinnabar-900 rounded-xl p-4 space-y-2">
        <p className="text-sm font-medium">Word lookup</p>
        <p className="text-xs text-white/45 text-pretty">
          Tap a word in the lyrics to see its reading and meaning. Turn this off if you use a dictionary extension like Yomitan.
        </p>
        <button
          type="button"
          role="switch"
          aria-checked={tapLookupEnabled}
          onClick={() => setTapLookupEnabled(!tapLookupEnabled)}
          className={[
            'w-full min-h-11 rounded-lg text-sm font-medium touch-manipulation transition-[color,background-color] duration-150 ease-out text-left px-4',
            tapLookupEnabled
              ? 'bg-cinnabar-accent text-white'
              : 'bg-cinnabar-800 text-white/50 hover:text-white/80',
          ].join(' ')}
        >
          {tapLookupEnabled ? 'Tap to look up words: On' : 'Tap to look up words: Off'}
        </button>
      </div>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/settings/tapLookup.test.ts tests/settings`
Expected: PASS (new test plus any existing settings tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/types/index.ts src/payment/SettingsStore.ts src/settings/SettingsView.tsx tests/settings/tapLookup.test.ts
git commit -m "feat(settings): tap-to-look-up words toggle (default on)"
```

---

### Task 4: `WordLookupPopover` component

Compact card styled like `TimestampPopover` (`src/lyrics/TimestampPopover.tsx:62` for the card classes). Anchored under the tapped word on wide viewports; fixed bottom card under 640px so it never fights thumb position. Shows immediately with surface/reading while the (one-time) gloss map load resolves. Dismissed by pointerdown outside; tapping another word replaces content via prop change.

**Files:**
- Create: `src/lyrics/WordLookupPopover.tsx`
- Create: `tests/lyrics/WordLookupPopover.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `tests/lyrics/WordLookupPopover.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { WordLookupPopover } from '../../src/lyrics/WordLookupPopover'
import type { Token } from '../../src/core/types'

const lookupWord = vi.fn()
vi.mock('../../src/language/japanese/wordLookup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/language/japanese/wordLookup')>()
  return { ...actual, lookupWord: (token: Token) => lookupWord(token) }
})

const token: Token = { surface: '躱し', reading: 'カワシ', pos: '動詞', baseForm: '躱す', startIndex: 0, endIndex: 2 }

describe('WordLookupPopover', () => {
  beforeEach(() => {
    lookupWord.mockReset()
  })

  it('shows headword, reading, and glosses once resolved', async () => {
    lookupWord.mockResolvedValue({ headword: '躱す', reading: 'かわす', pos: '動詞', glosses: ['to dodge', 'to evade'] })
    render(<WordLookupPopover token={token} anchorRect={null} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('to dodge; to evade')).toBeTruthy())
    expect(screen.getByText('躱す')).toBeTruthy()
    expect(screen.getByText('かわす')).toBeTruthy()
  })

  it('links to jisho.org for the headword', async () => {
    lookupWord.mockResolvedValue({ headword: '躱す', reading: 'かわす', pos: '動詞', glosses: [] })
    render(<WordLookupPopover token={token} anchorRect={null} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByRole('link')).toBeTruthy())
    expect(screen.getByRole('link').getAttribute('href')).toBe(`https://jisho.org/search/${encodeURIComponent('躱す')}`)
  })

  it('shows a fallback message when no gloss exists', async () => {
    lookupWord.mockResolvedValue({ headword: '骨頂', reading: 'こっちょう', pos: '名詞', glosses: [] })
    render(<WordLookupPopover token={token} anchorRect={null} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('No definition found.')).toBeTruthy())
  })

  it('closes on pointerdown outside, not inside', async () => {
    lookupWord.mockResolvedValue({ headword: '躱す', reading: 'かわす', pos: '動詞', glosses: ['to dodge'] })
    const onClose = vi.fn()
    render(<WordLookupPopover token={token} anchorRect={null} onClose={onClose} />)
    await waitFor(() => expect(screen.getByText('to dodge')).toBeTruthy())
    fireEvent.pointerDown(screen.getByText('to dodge'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.pointerDown(document.body)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders nothing for a null lookup result', async () => {
    lookupWord.mockResolvedValue(null)
    const { container } = render(<WordLookupPopover token={token} anchorRect={null} onClose={() => {}} />)
    await waitFor(() => expect(container.firstChild).toBeNull())
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lyrics/WordLookupPopover.test.tsx`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Implement**

Create `src/lyrics/WordLookupPopover.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import type { Token } from '../core/types'
import { lookupWord, jishoSearchUrl, type WordLookupResult } from '../language/japanese/wordLookup'

interface Props {
  token: Token
  /** Bounding rect of the tapped span; null falls back to the bottom-card layout. */
  anchorRect: DOMRect | null
  onClose: () => void
}

const CARD_WIDTH = 288 // w-72, for clamping the anchored position on-screen

/**
 * Compact tap-to-look-up dictionary card. Anchored under the tapped word on
 * wide viewports; a fixed bottom card on narrow ones so it never fights the
 * user's thumb. Playback keeps running; dismissed by tapping outside.
 */
export function WordLookupPopover({ token, anchorRect, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [result, setResult] = useState<WordLookupResult | null | 'loading'>('loading')

  useEffect(() => {
    let cancelled = false
    setResult('loading')
    void lookupWord(token).then((r) => { if (!cancelled) setResult(r) })
    return () => { cancelled = true }
  }, [token])

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [onClose])

  // Nothing to show for punctuation-only tokens.
  if (result === null) return null

  const loading = result === 'loading'
  const headword = loading ? token.surface : result.headword
  const reading = loading ? null : result.reading
  const pos = loading ? null : result.pos
  const glosses = loading ? [] : result.glosses

  const narrow = window.innerWidth < 640
  const anchored = !narrow && anchorRect !== null
  const style = anchored
    ? {
        left: Math.max(8, Math.min(anchorRect.left, window.innerWidth - CARD_WIDTH - 8)),
        top: anchorRect.bottom + 8,
      }
    : undefined

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`Dictionary entry for ${headword}`}
      onClick={(e) => e.stopPropagation()}
      style={style}
      className={[
        anchored ? 'fixed w-72' : 'fixed inset-x-3 bottom-24 mx-auto max-w-sm',
        'z-30 rounded-xl border border-cinnabar-accent/60 bg-cinnabar-900 p-3 space-y-1.5 shadow-xl text-left',
      ].join(' ')}
    >
      <div className="flex items-baseline gap-2 flex-wrap">
        <span lang="ja" className="font-jp text-lg font-semibold text-white">{headword}</span>
        {reading && reading !== headword && (
          <span lang="ja" className="font-jp text-sm text-cinnabar-accent/90">{reading}</span>
        )}
        {pos && <span className="text-[10px] text-white/40">{pos}</span>}
      </div>
      {loading ? (
        <p className="text-xs text-white/40">Looking up…</p>
      ) : glosses.length > 0 ? (
        <p className="text-sm text-white/80 text-pretty">{glosses.join('; ')}</p>
      ) : (
        <p className="text-xs text-white/40">No definition found.</p>
      )}
      <a
        href={jishoSearchUrl(headword)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block text-xs text-cinnabar-accent underline underline-offset-2 touch-manipulation"
      >
        jisho.org ↗
      </a>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lyrics/WordLookupPopover.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lyrics/WordLookupPopover.tsx tests/lyrics/WordLookupPopover.test.tsx
git commit -m "feat(lyrics): word lookup popover component"
```

---

### Task 5: Wire tap-to-look-up into `LyricDisplay`

Popover state lives at the `LyricDisplay` top level (one popover at a time; a new tap replaces content). The tap callback drills `Line → PrimaryText → ColoredTokens`, matching how `onHover` already flows. Token taps `stopPropagation()` so they don't trigger the line's seek-on-click. When the feature is on, lines with tokens always render the token-span path (previously only when colored/furigana), so plain lines get tap targets too. Yomitan compatibility (`yomitan-text` classes, `select-text`) is untouched.

**Files:**
- Modify: `src/lyrics/LyricDisplay.tsx`
- Modify: `tests/lyrics/LyricDisplay.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `tests/lyrics/LyricDisplay.test.tsx`. The file already imports `render`, `screen`, `vi`, the stores, and `TimedLine`; also import `fireEvent` from `@testing-library/react` and add this describe block at the end. Mock the lookup module at the top of the file (after existing imports, before the describes):

```tsx
vi.mock('../../src/language/japanese/wordLookup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/language/japanese/wordLookup')>()
  return {
    ...actual,
    lookupWord: vi.fn().mockResolvedValue({ headword: '躱す', reading: 'かわす', pos: '動詞', glosses: ['to dodge'] }),
  }
})
```

```tsx
describe('tap-to-look-up wiring', () => {
  const tokenLine: TimedLine = {
    original: '躱し', startTime: 0, endTime: 2, translation: '',
    tokens: [{ surface: '躱し', reading: 'カワシ', pos: '動詞', baseForm: '躱す', startIndex: 0, endIndex: 2 }],
  }

  beforeEach(() => {
    useLyricsStore.setState({ lines: [tokenLine], activeLine: 0, furiganaMode: 'none', showTranslation: false, lyricsLayout: 'stacked' })
    useSettingsStore.setState({ tapLookupEnabled: true, readingMode: 'dictionary' })
  })

  it('opens the popover on token tap without seeking the line', async () => {
    const onLineClick = vi.fn()
    render(<LyricDisplay onLineClick={onLineClick} />)
    fireEvent.click(screen.getByText('躱し'))
    expect(onLineClick).not.toHaveBeenCalled()
    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(await screen.findByText('to dodge')).toBeTruthy()
  })

  it('does not intercept taps when the setting is off', () => {
    useSettingsStore.setState({ tapLookupEnabled: false })
    const onLineClick = vi.fn()
    render(<LyricDisplay onLineClick={onLineClick} />)
    fireEvent.click(screen.getByText('躱し'))
    expect(onLineClick).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lyrics/LyricDisplay.test.tsx`
Expected: the two new tests FAIL (no popover, line click fires); existing tests still pass.

- [ ] **Step 3: Implement**

All changes in `src/lyrics/LyricDisplay.tsx`.

Add imports at the top:

```tsx
import { WordLookupPopover } from './WordLookupPopover'
```

(`Token`, `useState`, `useSettingsStore` are already imported.)

Define the tap payload type near `HoveredPair`:

```tsx
interface WordTap {
  token: Token
  rect: DOMRect
}
```

**`ColoredTokens`** (the token `<span>` map, around line 60): add an optional `onWordTap` prop and an onClick on the span:

```tsx
function ColoredTokens({ tokens, withFurigana, withColoring, readingMode, hovered, onHover, onWordTap }: {
  tokens: Token[]
  withFurigana: boolean
  withColoring: boolean
  readingMode: ReadingMode
  hovered: HoveredPair | null
  onHover: (pair: HoveredPair | null) => void
  onWordTap?: (tap: WordTap) => void
}) {
```

and on the token `<span>` (which currently has `className="yomitan-text"`, `style`, `onMouseEnter`, `onMouseLeave`), add:

```tsx
            onClick={onWordTap ? (e) => {
              e.stopPropagation()
              onWordTap({ token, rect: e.currentTarget.getBoundingClientRect() })
            } : undefined}
```

**`PrimaryText`** (around line 104): accept and forward `onWordTap`, and include it in the token-render decision so plain lines get tap targets when the feature is on:

```tsx
function PrimaryText({ line, isActive, furiganaMode, readingMode, colored, hovered, onHover, onWordTap }: {
  line: TimedLine
  isActive: boolean
  furiganaMode: FuriganaMode
  readingMode: ReadingMode
  colored: boolean
  hovered: HoveredPair | null
  onHover: (pair: HoveredPair | null) => void
  onWordTap?: (tap: WordTap) => void
}) {
```

```tsx
  const useTokenRender = line.tokens && line.tokens.length > 0 && (colored || showFurigana || !!onWordTap)
```

and pass `onWordTap={onWordTap}` to `<ColoredTokens ... />`.

Note: the `furigana`-HTML branch above the token render checks `!useTokenRender`; with `onWordTap` set, token render now wins over the raw furigana HTML for lines that have tokens — that is intended (ruby is rebuilt from tokens).

**`Line`** (around line 217): accept `onWordTap?: (tap: WordTap) => void` in props and pass it to both `<PrimaryText ... />` call sites (side-by-side and stacked).

**`LyricDisplay`** (around line 300): add popover state, read the setting, hand the callback down, render the popover after the lines map (inside the root `<div>`):

```tsx
  const tapLookupEnabled = useSettingsStore((s) => s.tapLookupEnabled)
  const [wordTap, setWordTap] = useState<WordTap | null>(null)
```

pass to each `<Line ...>`:

```tsx
            onWordTap={tapLookupEnabled ? setWordTap : undefined}
```

and after the `{lines.map(...)}` block:

```tsx
      {wordTap && (
        <WordLookupPopover
          token={wordTap.token}
          anchorRect={wordTap.rect}
          onClose={() => setWordTap(null)}
        />
      )}
```

(No extra "replace on second tap" logic is needed: the popover's outside-`pointerdown` fires first and closes it, then the span's `click` sets the new tap.)

- [ ] **Step 4: Run the lyrics test suites**

Run: `npx vitest run tests/lyrics/LyricDisplay.test.tsx tests/lyrics/WordLookupPopover.test.tsx tests/player`
Expected: PASS — including all pre-existing LyricDisplay and player tests (the player suite renders LyricDisplay via PlayerView).

- [ ] **Step 5: Commit**

```bash
git add src/lyrics/LyricDisplay.tsx tests/lyrics/LyricDisplay.test.tsx
git commit -m "feat(lyrics): tap a word to open the dictionary popover"
```

---

### Task 6: Full verification

**Files:** none new.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS, no regressions (note: memory says a couple of integration tests are historically flaky — a failure there should be checked against `main` before blaming this change).

- [ ] **Step 2: Lint and typecheck/build**

Run: `npm run lint && npm run build`
Expected: both clean.

- [ ] **Step 3: Verify live in the browser**

Use the preview tools (or the verify-live-before-done skill) against the dev server:
1. Load a song with tokenized Japanese lyrics.
2. Tap/click a conjugated word → popover shows dictionary form, hiragana reading, glosses, jisho link; audio keeps playing; the line does **not** seek.
3. Tap another word → content replaces. Tap outside → closes.
4. Narrow viewport (`preview_resize` mobile preset) → popover renders as the bottom card.
5. Settings → toggle "Tap to look up words" off → tapping a word seeks the line again (old behavior), no popover.

- [ ] **Step 4: Commit any fixes; done**

```bash
git status
```

Expected: clean tree, all work committed.
