# Paste LRC Timings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user pastes lyrics that already carry `[mm:ss.xx]` timestamps, use those times as the song's alignment (skipping Whisper) instead of stripping them and re-deriving timing.

**Architecture:** A pure detector (`hasLrcTimestamps`) plus a pure router (`linesFromPaste`) decide, at paste-resolution time, between the existing `parseLRC` (timed → synced song → no transcription) and `linesFromPlainText` (plain → needs-sync → Whisper). The three paste entry points (`LyricsImportPanel`, `UploadAudioFlow`, `LinkParser`) call the shared router. A shared `LrcTimingNotice` renders the auto-use note + one-click "Align from scratch instead" escape hatch. A song becomes "synced" purely because its lines carry non-zero times (`src/core/db/migrations.ts:26`), so no new flag is needed.

**Tech Stack:** TypeScript, React, Vitest. Reuses existing `parseLRC` / `TIMESTAMP_RE` (`src/lyrics/lrc-parser.ts`), `linesFromPlainText` / `cleanPastedLyrics` (`src/sources/songBuilder.ts`).

**Standing constraint:** All commits in this repo must be UNSIGNED — use `git commit --no-gpg-sign`. Commit only when the user has asked you to; if unsure, pause and ask rather than committing.

---

## File Structure

- `src/lyrics/lrc-parser.ts` — add `hasLrcTimestamps(text)` (detector), reusing the module's existing `TIMESTAMP_RE`.
- `src/sources/songBuilder.ts` — add `linesFromPaste(pasted, opts)` (router); imports `hasLrcTimestamps` + `parseLRC`.
- `src/lyrics/LrcTimingNotice.tsx` — new shared presentational component (the note + escape-hatch button).
- `src/lyrics/LyricsImportPanel.tsx` — swap paste resolution to `linesFromPaste`; add `ignoreLrcTimings` state + notice.
- `src/sources/UploadAudioFlow.tsx` — same swap + state + notice.
- `src/sources/LinkParser.tsx` — same swap + state + notice.
- Tests: `tests/lyrics/lrc-parser.test.ts`, `tests/sources/songBuilder.test.ts`, `tests/lyrics/LrcTimingNotice.test.tsx`.

---

### Task 1: `hasLrcTimestamps` detector

**Files:**
- Modify: `src/lyrics/lrc-parser.ts` (add export; `TIMESTAMP_RE` already defined at top of file)
- Test: `tests/lyrics/lrc-parser.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/lyrics/lrc-parser.test.ts` (add `hasLrcTimestamps` to the existing import from `../../src/lyrics/lrc-parser`):

```ts
describe('hasLrcTimestamps', () => {
  it('is true when at least two lines carry a time tag', () => {
    expect(hasLrcTimestamps('[00:03.72]a\n[00:06.76]b')).toBe(true)
  })

  it('is true for a full LRC with fractional-ms tags', () => {
    expect(hasLrcTimestamps('[00:03.720]a\n[00:06.760]b\n[00:10.08]c')).toBe(true)
  })

  it('is false for plain lyrics', () => {
    expect(hasLrcTimestamps('first line\nsecond line\nthird line')).toBe(false)
  })

  it('is false when only a single stray tag is present', () => {
    expect(hasLrcTimestamps('meet me at [00:12.00]\nplain lyric line')).toBe(false)
  })

  it('is false for empty text', () => {
    expect(hasLrcTimestamps('')).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/lyrics/lrc-parser.test.ts`
Expected: FAIL — `hasLrcTimestamps is not a function` / not exported.

- [ ] **Step 3: Implement the detector**

In `src/lyrics/lrc-parser.ts`, add after the existing `TIMESTAMP_RE` constant and `parseLRC`/`parseLRCPair` exports (place the function anywhere at module top-level; it reuses the file-scope `TIMESTAMP_RE`):

```ts
/**
 * True when the text looks like a timed LRC: at least two lines begin with a
 * valid [mm:ss.xx] time tag. Reuses TIMESTAMP_RE so detection and parseLRC can
 * never disagree. The >=2 threshold avoids false-triggering on a single stray
 * bracketed timecode inside otherwise plain lyrics.
 */
export function hasLrcTimestamps(text: string): boolean {
  let count = 0
  for (const raw of text.split('\n')) {
    if (TIMESTAMP_RE.test(raw.trim())) {
      count += 1
      if (count >= 2) return true
    }
  }
  return false
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/lyrics/lrc-parser.test.ts`
Expected: PASS (all `hasLrcTimestamps` tests plus the pre-existing `parseLRC` tests).

- [ ] **Step 5: Commit**

```bash
git add src/lyrics/lrc-parser.ts tests/lyrics/lrc-parser.test.ts
git commit --no-gpg-sign -m "feat(lrc): hasLrcTimestamps detector for timed pastes"
```

---

### Task 2: `linesFromPaste` router

**Files:**
- Modify: `src/sources/songBuilder.ts` (add export + imports)
- Test: `tests/sources/songBuilder.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/sources/songBuilder.test.ts` (import `linesFromPaste` from `../../src/sources/songBuilder`):

```ts
describe('linesFromPaste', () => {
  const lrc = '[00:03.72](Giga, TeddyLoid)\n[00:06.76]Transforming\n[00:10.08]ゼロ戻り'

  it('uses the LRC times when the paste is timed', () => {
    const lines = linesFromPaste(lrc)
    expect(lines.map((l) => l.original)).toEqual(['(Giga, TeddyLoid)', 'Transforming', 'ゼロ戻り'])
    expect(lines[0].startTime).toBeCloseTo(3.72)
    expect(lines[1].startTime).toBeCloseTo(6.76)
    expect(lines.every((l) => l.startTime > 0)).toBe(true)
  })

  it('falls back to plain text (t=0) when the paste is not timed', () => {
    const lines = linesFromPaste('first line\nsecond line')
    expect(lines.map((l) => l.original)).toEqual(['first line', 'second line'])
    expect(lines.every((l) => l.startTime === 0)).toBe(true)
  })

  it('honors ignoreLrcTimings by resolving a timed paste as plain text', () => {
    const lines = linesFromPaste(lrc, { ignoreLrcTimings: true })
    expect(lines.every((l) => l.startTime === 0)).toBe(true)
    expect(lines.map((l) => l.original)).toEqual(['(Giga, TeddyLoid)', 'Transforming', 'ゼロ戻り'])
  })

  it('falls back to plain text when timing is only partial (fewer timed than plain lines)', () => {
    // Two stray tags trip detection, but most lines are untimed → keep all lines.
    const partial = '[00:01.00]intro\n[00:02.00]hook\nplain three\nplain four\nplain five'
    const lines = linesFromPaste(partial)
    expect(lines.length).toBe(5)
    expect(lines.every((l) => l.startTime === 0)).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/sources/songBuilder.test.ts`
Expected: FAIL — `linesFromPaste is not a function`.

- [ ] **Step 3: Implement the router**

In `src/sources/songBuilder.ts`, add imports at the top (near the existing `cleanPastedLyrics` import):

```ts
import { hasLrcTimestamps, parseLRC } from '../lyrics/lrc-parser'
```

Then add, directly below the existing `linesFromPlainText` function:

```ts
/**
 * Resolve pasted lyrics into timed lines. When the paste is a timed LRC (and the
 * user has not overridden with ignoreLrcTimings), use the LRC times via parseLRC
 * — the non-zero startTimes make the resulting song "synced", which skips the
 * Whisper align step (see src/core/db/migrations.ts sync derivation). Otherwise,
 * and as a safety fallback when the LRC is only partially timed (parseLRC yields
 * fewer usable lines than plain text would), fall back to linesFromPlainText.
 */
export function linesFromPaste(
  pasted: string,
  opts?: { ignoreLrcTimings?: boolean },
): TimedLine[] {
  if (!opts?.ignoreLrcTimings && hasLrcTimestamps(pasted)) {
    const timed = parseLRC(pasted).filter((l) => l.original.trim().length > 0)
    const plain = linesFromPlainText(pasted)
    if (timed.length > 0 && timed.length >= plain.length) return timed
  }
  return linesFromPlainText(pasted)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/sources/songBuilder.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sources/songBuilder.ts tests/sources/songBuilder.test.ts
git commit --no-gpg-sign -m "feat(paste): linesFromPaste routes timed LRC pastes to parseLRC"
```

---

### Task 3: `LrcTimingNotice` shared component

**Files:**
- Create: `src/lyrics/LrcTimingNotice.tsx`
- Test: `tests/lyrics/LrcTimingNotice.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `tests/lyrics/LrcTimingNotice.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LrcTimingNotice } from '../../src/lyrics/LrcTimingNotice'

const lrc = '[00:03.72]a\n[00:06.76]b\n[00:10.08]c'

describe('LrcTimingNotice', () => {
  it('shows the count when the paste is timed and not ignored', () => {
    render(<LrcTimingNotice pasted={lrc} ignored={false} onAlignFromScratch={() => {}} />)
    expect(screen.getByText(/Using your pasted timings/)).toBeTruthy()
    expect(screen.getByText(/3 lines/)).toBeTruthy()
  })

  it('renders nothing for plain text', () => {
    const { container } = render(
      <LrcTimingNotice pasted={'plain one\nplain two'} ignored={false} onAlignFromScratch={() => {}} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when ignored', () => {
    const { container } = render(
      <LrcTimingNotice pasted={lrc} ignored={true} onAlignFromScratch={() => {}} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('fires onAlignFromScratch when the escape hatch is clicked', () => {
    const onAlign = vi.fn()
    render(<LrcTimingNotice pasted={lrc} ignored={false} onAlignFromScratch={onAlign} />)
    fireEvent.click(screen.getByRole('button', { name: /Align from scratch/ }))
    expect(onAlign).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/lyrics/LrcTimingNotice.test.tsx`
Expected: FAIL — cannot find module `LrcTimingNotice`.

- [ ] **Step 3: Implement the component**

Create `src/lyrics/LrcTimingNotice.tsx`:

```tsx
import { hasLrcTimestamps, parseLRC } from './lrc-parser'

interface Props {
  pasted: string
  ignored: boolean
  onAlignFromScratch: () => void
}

/**
 * Quiet, dismissible note shown when a paste is a timed LRC that will be used
 * as-is. The "Align from scratch instead" button is the one-click escape hatch:
 * it flips the caller's ignoreLrcTimings flag so the paste resolves as plain
 * text (strip + Whisper). Renders nothing when the paste is not timed or the
 * override is already set.
 */
export function LrcTimingNotice({ pasted, ignored, onAlignFromScratch }: Props) {
  if (ignored || !hasLrcTimestamps(pasted)) return null
  const count = parseLRC(pasted).filter((l) => l.original.trim().length > 0).length
  return (
    <p className="text-[11px] text-white/50 flex flex-wrap items-center gap-x-2 gap-y-1">
      <span>⏱ Using your pasted timings ({count} lines)</span>
      <button
        type="button"
        onClick={onAlignFromScratch}
        className="underline text-white/40 hover:text-white/70 touch-manipulation"
      >
        Align from scratch instead
      </button>
    </p>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/lyrics/LrcTimingNotice.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lyrics/LrcTimingNotice.tsx tests/lyrics/LrcTimingNotice.test.tsx
git commit --no-gpg-sign -m "feat(paste): LrcTimingNotice auto-use note + escape hatch"
```

---

### Task 4: Wire into `LyricsImportPanel`

**Files:**
- Modify: `src/lyrics/LyricsImportPanel.tsx` (import swap at line 3; resolution at line 98; add state; add notice near the textarea at lines 194-202; reset override in textarea onChange)

- [ ] **Step 1: Swap the import and add the notice import**

In `src/lyrics/LyricsImportPanel.tsx`, change line 3 from:

```ts
import { linesFromPlainText } from '../sources/songBuilder'
```

to:

```ts
import { linesFromPaste } from '../sources/songBuilder'
import { LrcTimingNotice } from './LrcTimingNotice'
```

- [ ] **Step 2: Add the override state**

Immediately after the `const [pasted, setPasted] = useState('')` line (line 41), add:

```ts
  const [ignoreLrcTimings, setIgnoreLrcTimings] = useState(false)
```

- [ ] **Step 3: Route the paste through `linesFromPaste`**

Change the paste branch in `resolveManualLines` (line 98) from:

```ts
      if (lyricsPhase.source === 'paste') return linesFromPlainText(pasted)
```

to:

```ts
      if (lyricsPhase.source === 'paste') return linesFromPaste(pasted, { ignoreLrcTimings })
```

- [ ] **Step 4: Reset the override on edit and render the notice**

Replace the paste `<textarea>` block (lines 194-202) with the textarea (now also clearing the override on change) followed by the notice:

```tsx
            {lyricsPhase.source === 'paste' && (
              <>
                <textarea
                  value={pasted}
                  onChange={(e) => { setPasted(e.target.value); setIgnoreLrcTimings(false) }}
                  placeholder="Paste lyrics, one line per row…"
                  rows={6}
                  className="w-full px-4 py-3 bg-cinnabar-900 text-white rounded-xl outline-none border border-cinnabar-800 focus:border-cinnabar-accent placeholder:text-white/30"
                />
                <LrcTimingNotice
                  pasted={pasted}
                  ignored={ignoreLrcTimings}
                  onAlignFromScratch={() => setIgnoreLrcTimings(true)}
                />
              </>
            )}
```

- [ ] **Step 5: Typecheck, lint, and run the panel's tests**

Run: `npx tsc -b && npx eslint src/lyrics/LyricsImportPanel.tsx`
Expected: exit 0, no errors.
Run: `npx vitest run tests/lyrics`
Expected: PASS (no regressions).

- [ ] **Step 6: Commit**

```bash
git add src/lyrics/LyricsImportPanel.tsx
git commit --no-gpg-sign -m "feat(paste): use pasted LRC timings in LyricsImportPanel"
```

---

### Task 5: Wire into `UploadAudioFlow`

**Files:**
- Modify: `src/sources/UploadAudioFlow.tsx` (import at line 5; `resolveLines` paste branch ~line 202; add state near line 87; add notice near the paste textarea)

- [ ] **Step 1: Swap imports**

In `src/sources/UploadAudioFlow.tsx`, change the line 5 import from:

```ts
import { buildSong, linesFromPlainText } from './songBuilder'
```

to (keep `linesFromPlainText` — the `found.synced` branch at line 184 still uses it):

```ts
import { buildSong, linesFromPlainText, linesFromPaste } from './songBuilder'
import { LrcTimingNotice } from '../lyrics/LrcTimingNotice'
```

- [ ] **Step 2: Add the override state**

Immediately after `const [pasted, setPasted] = useState('')` (line 87), add:

```ts
  const [ignoreLrcTimings, setIgnoreLrcTimings] = useState(false)
```

- [ ] **Step 3: Route the paste through `linesFromPaste`**

In `resolveLines`, change the paste branch (the `if (lyricsPhase.source === 'paste') return linesFromPlainText(pasted)` line, ~202) to:

```ts
      if (lyricsPhase.source === 'paste') return linesFromPaste(pasted, { ignoreLrcTimings })
```

- [ ] **Step 4: Reset the override on edit and render the notice**

In `src/sources/UploadAudioFlow.tsx`, replace this exact block (around line 445):

```tsx
                {lyricsPhase.source === 'paste' && (
                  <textarea
                    value={pasted}
                    onChange={(e) => setPasted(e.target.value)}
                    placeholder="Paste lyrics, one line per row…"
                    rows={embedded ? 8 : 6}
                    className={[fieldClass, embedded ? 'flex-1 min-h-[7rem] resize-none' : ''].join(' ')}
                  />
                )}
```

with:

```tsx
                {lyricsPhase.source === 'paste' && (
                  <>
                    <textarea
                      value={pasted}
                      onChange={(e) => { setPasted(e.target.value); setIgnoreLrcTimings(false) }}
                      placeholder="Paste lyrics, one line per row…"
                      rows={embedded ? 8 : 6}
                      className={[fieldClass, embedded ? 'flex-1 min-h-[7rem] resize-none' : ''].join(' ')}
                    />
                    <LrcTimingNotice
                      pasted={pasted}
                      ignored={ignoreLrcTimings}
                      onAlignFromScratch={() => setIgnoreLrcTimings(true)}
                    />
                  </>
                )}
```

- [ ] **Step 5: Typecheck, lint, run tests**

Run: `npx tsc -b && npx eslint src/sources/UploadAudioFlow.tsx`
Expected: exit 0.
Run: `npx vitest run tests/sources`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/sources/UploadAudioFlow.tsx
git commit --no-gpg-sign -m "feat(paste): use pasted LRC timings in UploadAudioFlow"
```

---

### Task 6: Wire into `LinkParser`

**Files:**
- Modify: `src/sources/LinkParser.tsx` (import at line 5; paste branch at line 169; add state near line 59; add notice near the paste textarea)

- [ ] **Step 1: Swap imports**

In `src/sources/LinkParser.tsx`, change the line 5 import from:

```ts
import { buildSong, linesFromPlainText, type BuildSongInput } from './songBuilder'
```

to (drop `linesFromPlainText` — line 169's paste branch is its only use in this file, and Step 3 replaces it, so leaving it imported would fail lint with `no-unused-vars`):

```ts
import { buildSong, linesFromPaste, type BuildSongInput } from './songBuilder'
import { LrcTimingNotice } from '../lyrics/LrcTimingNotice'
```

- [ ] **Step 2: Add the override state**

Immediately after `const [pasted, setPasted] = useState('')` (line 59), add:

```ts
  const [ignoreLrcTimings, setIgnoreLrcTimings] = useState(false)
```

- [ ] **Step 3: Route the paste through `linesFromPaste`**

Change line 169 from:

```ts
      if (lyricsPhase.source === 'paste') return linesFromPlainText(pasted)
```

to:

```ts
      if (lyricsPhase.source === 'paste') return linesFromPaste(pasted, { ignoreLrcTimings })
```

- [ ] **Step 4: Reset the override on edit and render the notice**

In `src/sources/LinkParser.tsx`, replace this exact block (around line 414):

```tsx
                    {lyricsPhase.source === 'paste' && (
                      <textarea
                        value={pasted}
                        onChange={(e) => setPasted(e.target.value)}
                        placeholder="Paste lyrics, one line per row…"
                        rows={embedded ? 8 : 6}
                        className={[fieldClass, embedded ? 'flex-1 min-h-[7rem] resize-none' : ''].join(' ')}
                      />
                    )}
```

with:

```tsx
                    {lyricsPhase.source === 'paste' && (
                      <>
                        <textarea
                          value={pasted}
                          onChange={(e) => { setPasted(e.target.value); setIgnoreLrcTimings(false) }}
                          placeholder="Paste lyrics, one line per row…"
                          rows={embedded ? 8 : 6}
                          className={[fieldClass, embedded ? 'flex-1 min-h-[7rem] resize-none' : ''].join(' ')}
                        />
                        <LrcTimingNotice
                          pasted={pasted}
                          ignored={ignoreLrcTimings}
                          onAlignFromScratch={() => setIgnoreLrcTimings(true)}
                        />
                      </>
                    )}
```

- [ ] **Step 5: Typecheck, lint, run tests**

Run: `npx tsc -b && npx eslint src/sources/LinkParser.tsx`
Expected: exit 0 (no unused-import warnings).
Run: `npx vitest run tests/sources`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/sources/LinkParser.tsx
git commit --no-gpg-sign -m "feat(paste): use pasted LRC timings in LinkParser"
```

---

### Task 7: Full-suite gate + manual browser verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole suite**

Run: `npx vitest run`
Expected: all pass (baseline this session was 1561 passed | 2 skipped; expect that plus the new tests, 0 failures). In particular the corpus baseline + LRC-truth gates must stay green — this feature adds a paste branch and does not touch offline alignment, so they should be unchanged.

- [ ] **Step 2: Typecheck + lint the whole change**

Run: `npx tsc -b && npx eslint src/lyrics/lrc-parser.ts src/sources/songBuilder.ts src/lyrics/LrcTimingNotice.tsx src/lyrics/LyricsImportPanel.tsx src/sources/UploadAudioFlow.tsx src/sources/LinkParser.tsx`
Expected: exit 0.

- [ ] **Step 3: Manual browser verification (dev server)**

Start the dev server via the preview tool (not raw `npm run dev`) and, in Add-Song / paste:
1. Paste the Recollect LRC (55 timed lines). Expect the note "⏱ Using your pasted timings (55 lines)". Create the song → it lands **synced** in the library (no auto-align stage), and Play mode highlights on the pasted times.
2. Click "Align from scratch instead" before creating → note disappears; creating the song now goes through the Whisper align flow (needs-sync).
3. Paste plain lyrics (no timestamps) → no note; behaves exactly as before.
4. Repeat step 1 quickly in the Upload-Audio flow and the Link/paste flow to confirm all three entry points route identically.

- [ ] **Step 4: Commit any fixes found during verification**

```bash
git add -A
git commit --no-gpg-sign -m "fix(paste): address LRC-timings verification findings"
```

(Skip if verification surfaced nothing.)

---

## Notes for the executor

- Do **not** modify `parseLRC`, `cleanPastedLyrics`, or `stripLrcTimestamps` — the detector reuses `TIMESTAMP_RE`, and the stripper stays the plain-text / override branch.
- The three flows are intentionally near-identical (Tasks 4–6). Apply each fully; do not assume one covers the others — they have separate `pasted` state.
- If a flow's textarea is not currently wrapped so a sibling notice can be added, wrap the textarea + notice in a `<>…</>` fragment (React fragment), preserving all existing className/props on the textarea.
