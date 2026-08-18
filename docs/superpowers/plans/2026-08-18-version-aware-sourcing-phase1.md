# Version-aware Lyric Sourcing — Phase 1 (Sourcing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make lyric matching version-aware, so a song whose exact version exists on LRCLIB is timed with zero manual taps — by persisting the song's duration, feeding it to the matcher that already knows how to use it, scoring version markers instead of discarding them, and re-checking once a YouTube song's duration finally becomes known.

**Architecture:** Almost all of this is connecting wires that already exist. `lyricsMatchScore` already weights duration (+0.15 within 2s, −0.25 for a large mismatch) but is never given one on the YouTube/import paths. Two genuinely new pieces: a pure version-marker module, and a late re-rank triggered when the player reports a duration. Nothing changes about how LRCLIB is searched or how lyrics are parsed.

**Tech Stack:** TypeScript, React 19, Vite/Vitest, Dexie (IndexedDB).

**Spec:** `docs/superpowers/specs/2026-08-18-version-aware-lyric-sourcing-design.md` (sections 1–3 and finding 3b)

**Phase 2 (retiming: `linearTimingFit` + `SyncCalibrator`) is NOT in this plan.** Do not build it.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/core/types/index.ts` (modify) | Add optional `Song.durationSec`. Additive — no migration. |
| `src/sources/songBuilder.ts` (modify) | Accept and persist `durationSec` on build. |
| `src/sources/versionMarker.ts` (create) | Pure: extract version markers from a title; score agreement between two titles. |
| `src/sources/lrclib.ts` (modify) | Add the version-agreement term to `lyricsMatchScore`. |
| `src/sources/lyricsResolver.ts` (modify) | Accept `durationSec` and forward it to `findLyrics`. |
| `src/sources/LinkParser.tsx`, `src/lyrics/LyricsImportPanel.tsx` (modify) | Pass a duration where they have one. |
| `src/player/PlayerView.tsx` (modify) | Persist a learned duration onto the song once playback reports one. |
| `src/sources/lyricsRerank.ts` (create) | Pure: decide whether a better-matching candidate exists for a now-known duration. |

**Ordering note:** Tasks 1–4 are independent of 5–6 and deliver value alone. If Phase 1 is cut short, stop after Task 4 — the primary complaint is addressed by then.

---

## Task 1: Persist the song duration

`Song` has no duration field. `UploadAudioFlow` reads one from audio metadata, uses it once, and discards it — so any later re-search cannot use it.

**Files:**
- Modify: `src/core/types/index.ts`
- Modify: `src/sources/songBuilder.ts`
- Test: `tests/sources/songBuilder.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/sources/songBuilder.test.ts`:

```ts
describe('buildSong — durationSec', () => {
  it('persists a supplied duration', () => {
    const song = buildSong({ title: 'T', artist: 'A', lines: [], durationSec: 230 })
    expect(song.durationSec).toBe(230)
  })

  // Optional field: songs built before this existed must stay valid, and a
  // YouTube song has no duration until playback starts.
  it('leaves duration undefined when not supplied', () => {
    const song = buildSong({ title: 'T', artist: 'A', lines: [] })
    expect(song.durationSec).toBeUndefined()
  })

  it('ignores a nonsense duration rather than storing it', () => {
    expect(buildSong({ title: 'T', artist: 'A', lines: [], durationSec: 0 }).durationSec).toBeUndefined()
    expect(buildSong({ title: 'T', artist: 'A', lines: [], durationSec: -5 }).durationSec).toBeUndefined()
    expect(buildSong({ title: 'T', artist: 'A', lines: [], durationSec: Number.NaN }).durationSec).toBeUndefined()
  })
})
```

Match the file's existing import style — `buildSong` is imported from `'../../src/sources/songBuilder'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sources/songBuilder.test.ts`
Expected: FAIL — `durationSec` does not exist on the input type.

- [ ] **Step 3: Add the field**

In `src/core/types/index.ts`, inside `export interface Song`, after `albumArtUrl?: string`:

```ts
  /** Track length in seconds, when known. Optional: YouTube songs have none until
   * playback reports one, and songs stored before this field existed have none.
   * Feeds version-aware lyric matching — LRCLIB scoring weights duration heavily
   * (+0.15 within 2s, -0.25 for a large mismatch), which is what tells two masters
   * of the same song apart. */
  durationSec?: number
```

In `src/sources/songBuilder.ts`, add to `BuildSongInput` after `albumArtUrl?: string`:

```ts
  durationSec?: number
```

and in the returned object, after `albumArtUrl: input.albumArtUrl,`:

```ts
    // Guard here rather than at every call site: metadata parsers return 0 or NaN
    // for unreadable files, and a bogus duration is worse than none — it would
    // actively push the matcher toward the wrong master.
    durationSec:
      Number.isFinite(input.durationSec) && (input.durationSec as number) > 0
        ? input.durationSec
        : undefined,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sources/songBuilder.test.ts`
Expected: PASS, including the file's pre-existing tests.

- [ ] **Step 5: Pass it from the upload path**

In `src/sources/UploadAudioFlow.tsx`, the component already holds `durationSec` state (set from `tags.durationSec`). Find its `buildSong({ ... })` call and add `durationSec,` to the input object. Do not change anything else in that file.

- [ ] **Step 6: Verify and commit**

Run: `npx vitest run tests/sources/ && npx tsc -b && npx eslint src/sources src/core/types`
Expected: all pass, clean.

```bash
git add src/core/types/index.ts src/sources/songBuilder.ts src/sources/UploadAudioFlow.tsx tests/sources/songBuilder.test.ts
git commit -m "feat(sources): persist song duration for version-aware lyric matching"
```

---

## Task 2: Version-marker extraction (pure)

`TITLE_NOISE` in `src/sources/youtube.ts:15` strips `(Live)`, `(Remastered)` and similar so searches match broadly. That is useful for finding candidates and destructive for choosing between them. This task adds the extraction only — scoring is Task 3.

**Files:**
- Create: `src/sources/versionMarker.ts`
- Test: `tests/sources/versionMarker.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/sources/versionMarker.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { extractVersionMarkers, versionAgreement } from '../../src/sources/versionMarker'

describe('extractVersionMarkers', () => {
  it('finds a Latin marker in parentheses', () => {
    expect(extractVersionMarkers('Song Name (Live)')).toEqual(['live'])
  })

  it('finds a Japanese marker', () => {
    // The reported case: a specific vocal version of a Yamashita track.
    expect(extractVersionMarkers('幸せにさよなら (山下ヴォーカル・バージョン)')).toContain('version')
  })

  it('normalises spelling variants to one token', () => {
    expect(extractVersionMarkers('Song (Remaster)')).toEqual(['remaster'])
    expect(extractVersionMarkers('Song (Remastered)')).toEqual(['remaster'])
    expect(extractVersionMarkers('Song (2019 Remastered Version)')).toContain('remaster')
  })

  it('returns nothing for a plain title', () => {
    expect(extractVersionMarkers('Song Name')).toEqual([])
  })

  // "Official Video" is production noise, not a musical version — treating it as a
  // marker would penalise every correct YouTube match.
  it('ignores upload noise that is not a version', () => {
    expect(extractVersionMarkers('Song Name (Official Video)')).toEqual([])
    expect(extractVersionMarkers('Song Name [MV]')).toEqual([])
  })

  it('finds markers in brackets and after a dash', () => {
    expect(extractVersionMarkers('Song Name [Acoustic]')).toEqual(['acoustic'])
    expect(extractVersionMarkers('Song Name - Live')).toEqual(['live'])
  })
})

describe('versionAgreement', () => {
  it('is neutral when neither title declares a version', () => {
    expect(versionAgreement('Song', 'Song')).toBe(0)
  })

  it('rewards a match', () => {
    expect(versionAgreement('Song (Live)', 'Song (Live)')).toBeGreaterThan(0)
  })

  it('penalises a conflict', () => {
    expect(versionAgreement('Song (Live)', 'Song (Acoustic)')).toBeLessThan(0)
  })

  // The reported failure: the user's title declares a version, the candidate is the
  // plain master. That is a likely wrong-master match and must cost score.
  it('penalises a versioned query matching an unversioned candidate', () => {
    expect(versionAgreement('Song (Live)', 'Song')).toBeLessThan(0)
  })

  it('penalises an unversioned query matching a versioned candidate', () => {
    expect(versionAgreement('Song', 'Song (Live)')).toBeLessThan(0)
  })

  it('is symmetric', () => {
    expect(versionAgreement('Song (Live)', 'Song')).toBe(versionAgreement('Song', 'Song (Live)'))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sources/versionMarker.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the implementation**

Create `src/sources/versionMarker.ts`:

```ts
/**
 * Version markers — the part of a title that says WHICH recording this is.
 *
 * `cleanTitle`/`TITLE_NOISE` in youtube.ts deliberately strip these so a search
 * finds candidates at all. That is right for finding and wrong for choosing: once
 * several candidates come back, the marker is often the only thing distinguishing
 * a live take from the studio master. This module keeps that signal so scoring can
 * use it, without touching how searches are built.
 *
 * Pure — no network, no DOM.
 */

/** Canonical token per marker family, so spelling variants compare equal. */
const MARKER_PATTERNS: Array<{ token: string; re: RegExp }> = [
  { token: 'live', re: /\b(live|ライブ|ライヴ)\b/i },
  { token: 'acoustic', re: /\b(acoustic|アコースティック)\b/i },
  { token: 'instrumental', re: /\b(instrumental|inst\.?|インスト(ゥルメンタル)?)\b/i },
  { token: 'remaster', re: /\b(remaster(ed)?|リマスター)\b/i },
  { token: 'remix', re: /\b(remix|リミックス)\b/i },
  { token: 'karaoke', re: /\b(karaoke|カラオケ|off ?vocal)\b/i },
  // Generic "some other version" — deliberately last, and deliberately broad
  // enough to catch 山下ヴォーカル・バージョン, which is the reported case.
  { token: 'version', re: /(\bver(sion)?\.?\b|バージョン|ヴァージョン)/i },
]

/**
 * Production noise that looks like a marker but says nothing about the recording.
 * Treating these as versions would penalise almost every correct YouTube match.
 */
const NOT_A_VERSION = /\b(official|music ?video|m\/?v|lyric[s]?|audio|hd|4k|visualizer|color coded|explicit|clean)\b/i

/** The bracketed or trailing-dash segments of a title, where markers live. */
function candidateSegments(title: string): string[] {
  const segments: string[] = []
  for (const m of title.matchAll(/[([【]([^)\]】]+)[)\]】]/g)) segments.push(m[1])
  const dash = title.match(/\s[-–—]\s(.+)$/)
  if (dash) segments.push(dash[1])
  return segments
}

/** Canonical version tokens declared by a title, deduped, in pattern order. */
export function extractVersionMarkers(title: string): string[] {
  if (!title) return []
  const found = new Set<string>()
  for (const seg of candidateSegments(title)) {
    if (NOT_A_VERSION.test(seg)) continue
    for (const { token, re } of MARKER_PATTERNS) {
      if (re.test(seg)) {
        found.add(token)
        // One family per segment: "2019 Remastered Version" is a remaster, not
        // also a generic "version".
        break
      }
    }
  }
  return [...found]
}

const AGREE = 0.12
const CONFLICT = -0.18

/**
 * Score adjustment for how well two titles agree about which recording they are.
 *
 * Returns 0 when neither declares a version — the overwhelmingly common case,
 * which must stay exactly as it scores today. A one-sided declaration is treated
 * as a conflict: it is the reported failure mode, where the user asks for a
 * specific vocal version and gets the plain master.
 *
 * Symmetric, so callers need not care about argument order.
 */
export function versionAgreement(queryTitle: string, candidateTitle: string): number {
  const q = extractVersionMarkers(queryTitle)
  const c = extractVersionMarkers(candidateTitle)
  if (q.length === 0 && c.length === 0) return 0
  if (q.length === 0 || c.length === 0) return CONFLICT
  return q.some((t) => c.includes(t)) ? AGREE : CONFLICT
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sources/versionMarker.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/sources/versionMarker.ts tests/sources/versionMarker.test.ts
git commit -m "feat(sources): extract and compare version markers in titles"
```

---

## Task 3: Score version agreement in LRCLIB matching

**Files:**
- Modify: `src/sources/lrclib.ts`
- Test: `tests/sources/lrclib.test.ts`

- [ ] **Step 1: Write the failing test**

`lyricsMatchScore` is currently module-private. Export it so its behavior can be tested directly rather than through a network-mocked search — this is scoring logic and deserves direct tests.

Append to `tests/sources/lrclib.test.ts` (add `lyricsMatchScore` to the existing import from `'../../src/sources/lrclib'`):

```ts
describe('lyricsMatchScore — version agreement', () => {
  const result = (name: string, duration?: number) => ({
    id: 1, name, artistName: 'Tatsuro Yamashita', syncedLyrics: null, plainLyrics: null, duration,
  })

  // The reported failure: the user's song declares a specific vocal version and
  // LRCLIB only has the plain master. Without a version term those score equally
  // on title similarity, and the wrong master wins on arbitrary ordering.
  it('ranks the matching version above the plain master', () => {
    const query = '幸せにさよなら (山下ヴォーカル・バージョン)'
    const versioned = lyricsMatchScore(result(query), query, 'Tatsuro Yamashita')
    const plain = lyricsMatchScore(result('幸せにさよなら'), query, 'Tatsuro Yamashita')
    expect(versioned).toBeGreaterThan(plain)
  })

  it('ranks a matching live take above a studio master', () => {
    const query = 'Song Name (Live)'
    const live = lyricsMatchScore(result('Song Name (Live)'), query, 'Artist')
    const studio = lyricsMatchScore(result('Song Name'), query, 'Artist')
    expect(live).toBeGreaterThan(studio)
  })

  // Regression guard: the ordinary case is two plain titles, and this change must
  // not disturb it.
  it('does not change scoring when neither title declares a version', () => {
    const score = lyricsMatchScore(result('Song Name'), 'Song Name', 'Artist')
    expect(score).toBeGreaterThan(0.9)
  })

  it('still lets duration dominate a version guess', () => {
    // Same version marker, but one candidate's length matches the real track.
    const query = 'Song Name (Live)'
    const right = lyricsMatchScore(result('Song Name (Live)', 230), query, 'Artist', 230)
    const wrong = lyricsMatchScore(result('Song Name (Live)', 400), query, 'Artist', 230)
    expect(right).toBeGreaterThan(wrong)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sources/lrclib.test.ts`
Expected: FAIL — `lyricsMatchScore` is not exported.

- [ ] **Step 3: Implement**

In `src/sources/lrclib.ts`, add to the imports:

```ts
import { versionAgreement } from './versionMarker'
```

Change `function lyricsMatchScore(` to `export function lyricsMatchScore(`, and add the version term. The existing body is:

```ts
  const titleScore = titleSimilarity(result.name, trackName)
  const artistScore = artistSimilarity(result.artistName, artistName)
  let score = titleScore * 0.65 + artistScore * 0.35
```

Insert immediately after the `let score = ...` line:

```ts
  // Which recording this is, not just which song. Neutral (0) when neither title
  // declares a version, so the common case scores exactly as it did before.
  score += versionAgreement(trackName, result.name)
```

Leave the duration block and the final `Math.max(0, Math.min(1, score))` clamp unchanged.

- [ ] **Step 4: Run tests to verify**

Run: `npx vitest run tests/sources/lrclib.test.ts tests/sources/lyricsMatch.test.ts`
Expected: PASS, including all pre-existing tests. **If a pre-existing test now fails, do not edit it to pass** — report it, because a real ranking regression is exactly what it would be telling you.

- [ ] **Step 5: Commit**

```bash
git add src/sources/lrclib.ts tests/sources/lrclib.test.ts
git commit -m "feat(sources): score version-marker agreement in LRCLIB matching"
```

---

## Task 4: Feed the duration through the resolver

This is the dead wire that motivated the whole spec: `resolveLyricsForSong` passes literal `undefined` where `findLyrics` expects `targetDurationSec`, so the duration weighting never fires on the YouTube or import paths.

**Files:**
- Modify: `src/sources/lyricsResolver.ts`
- Modify: `src/lyrics/LyricsImportPanel.tsx`
- Test: `tests/sources/lyricsResolver.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/sources/lyricsResolver.test.ts`. Mirror however that file already mocks `./lrclib`; if it does not mock it yet, add:

```ts
vi.mock('../../src/sources/lrclib', () => ({
  findLyrics: vi.fn(async () => null),
}))
```

Then:

```ts
import { findLyrics } from '../../src/sources/lrclib'

describe('resolveLyricsForSong — duration plumbing', () => {
  /**
   * Regression: resolveLyricsForSong passed a literal `undefined` for
   * findLyrics' 4th parameter, so the duration term in lyricsMatchScore
   * (+0.15 within 2s, -0.25 for a big mismatch) never fired on the YouTube or
   * import paths. Nothing about the RETURNED lyrics reveals that, which is why
   * this asserts on the argument rather than the result.
   */
  it('forwards durationSec to findLyrics', async () => {
    await resolveLyricsForSong({ title: 'T', artist: 'A', durationSec: 230 })
    expect(vi.mocked(findLyrics).mock.calls[0][3]).toBe(230)
  })

  it('forwards undefined when no duration is known', async () => {
    await resolveLyricsForSong({ title: 'T', artist: 'A' })
    expect(vi.mocked(findLyrics).mock.calls[0][3]).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sources/lyricsResolver.test.ts`
Expected: FAIL — the 4th argument is `undefined` even when 230 was supplied.

- [ ] **Step 3: Implement**

In `src/sources/lyricsResolver.ts`, add `durationSec?: number` to the options type of `resolveLyricsForSong`, destructure it, and pass it through. Change:

```ts
  const { title, artist, videoId, sourceLanguage, onStage } = opts
```

to:

```ts
  const { title, artist, videoId, sourceLanguage, onStage, durationSec } = opts
```

and change:

```ts
  const found = await findLyrics(title.trim(), artist.trim(), (stage) => {
    onStage?.(stage === 'exact' ? 'lrclib-exact' : 'lrclib-search')
  }, undefined, preferredLanguage)
```

to:

```ts
  const found = await findLyrics(title.trim(), artist.trim(), (stage) => {
    onStage?.(stage === 'exact' ? 'lrclib-exact' : 'lrclib-search')
  }, durationSec, preferredLanguage)
```

Add to the options type, above `onStage`:

```ts
  /** Track length, when known. Drives the duration term in LRCLIB scoring, which
   * is the main thing distinguishing two masters of the same song. */
  durationSec?: number
```

- [ ] **Step 4: Pass it from the import panel**

In `src/lyrics/LyricsImportPanel.tsx`, add `durationSec?: number` to `interface Props`, destructure it in the component signature, and include it in the `resolveLyricsForSong({ ... })` call.

Then update the panel's call site in `src/player/PlayerView.tsx` to pass `durationSec={song.durationSec}`.

Leave `src/sources/LinkParser.tsx` alone: it runs before any player exists and has no duration to give. Task 6 covers that case.

- [ ] **Step 5: Verify**

Run: `npx vitest run tests/sources tests/player && npx tsc -b && npx eslint src/sources src/lyrics src/player`
Expected: all pass, clean.

- [ ] **Step 6: Commit**

```bash
git add src/sources/lyricsResolver.ts src/lyrics/LyricsImportPanel.tsx src/player/PlayerView.tsx tests/sources/lyricsResolver.test.ts
git commit -m "fix(sources): feed track duration into LRCLIB matching

resolveLyricsForSong passed undefined for targetDurationSec, so the duration
term in lyricsMatchScore never fired on the YouTube and import paths."
```

---

## Task 5: Learn and persist a duration from playback

A YouTube song has no duration until its player reports one. `usePlayerStore` already holds a `duration` for both providers.

**Files:**
- Modify: `src/player/PlayerView.tsx`
- Test: `tests/player/PlayerView.durationPersist.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/player/PlayerView.durationPersist.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, waitFor } from '@testing-library/react'
import { db } from '../../src/core/db/schema'
import { PlayerView } from '../../src/player/PlayerView'

/**
 * Lyric matching leans heavily on track length, but Song never stored one:
 * UploadAudioFlow read it from file metadata, used it once, and dropped it, and a
 * YouTube song has none until its player reports one. This captures the first real
 * duration playback produces.
 */

vi.mock('../../src/core/opfs/audio', () => ({ getAudioFile: vi.fn(async () => new File([], 'x.mp3')) }))

// Reported duration is controlled per-test via this ref.
const engineDuration = { current: 230 }
vi.mock('../../src/player/AudioEngine', () => ({
  AudioEngine: class {
    get duration() { return engineDuration.current }
    position = 0
    async load() {} play() {} pause() {} seek() {} destroy() {} setRate() {} setVolume() {}
    onTimeUpdate() {} onEnd() {}
  },
}))

const song = (extra: Record<string, unknown>) => ({
  id: 's1', title: 'T', artist: 'A', audioStoredPath: 's1',
  lyrics: {
    lines: [{ startTime: 0, endTime: 1, original: 'hello', translation: '' }],
    sourceLanguage: 'en', translationLanguage: 'en', alignmentMode: 'manual',
  },
  syncState: 'synced', createdAt: new Date(),
  ...extra,
})

beforeEach(async () => {
  engineDuration.current = 230
  await db.songs.clear()
})

describe('learning a track duration from playback', () => {
  it('stores the duration when the song has none', async () => {
    await db.songs.put(song({}) as never)

    render(<PlayerView songId="s1" onBack={vi.fn()} />)

    await waitFor(async () => {
      expect((await db.songs.get('s1'))?.durationSec).toBe(230)
    })
  })

  // A duration read from file metadata is exact; a polled/derived one is not. Once
  // a trustworthy value is stored it must not be clobbered by a worse one.
  it('does not overwrite a duration already stored', async () => {
    await db.songs.put(song({ durationSec: 228 }) as never)

    render(<PlayerView songId="s1" onBack={vi.fn()} />)

    await waitFor(async () => {
      expect((await db.songs.get('s1'))?.durationSec).toBe(228)
    })
  })

  it('ignores a zero duration', async () => {
    engineDuration.current = 0
    await db.songs.put(song({}) as never)

    render(<PlayerView songId="s1" onBack={vi.fn()} />)

    await waitFor(async () => {
      expect(await db.songs.get('s1')).toBeTruthy()
    })
    expect((await db.songs.get('s1'))?.durationSec).toBeUndefined()
  })
})
```

If PlayerView's mock surface has grown since this plan was written and the render fails on a missing mock, mirror whatever `tests/player/PlayerView.missingSong.test.tsx` currently does — do not weaken the assertions to get a pass.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/player/PlayerView.durationPersist.test.tsx`
Expected: FAIL — nothing persists the duration.

- [ ] **Step 3: Implement**

In `src/player/PlayerView.tsx`, add an effect near the other song-persistence effects:

The loaded song is `const [song, setSong] = useState<Song | null>(null)` (`PlayerView.tsx:301`), and the store's `duration` is already destructured at `PlayerView.tsx:299`. Neighbouring effects persist with `db.songs.put({ ...base, ... })` then `setSong(updated)` — follow that, do not introduce `db.songs.update`.

Add near the other song-persistence effects:

```tsx
  // Learn the track length from playback and keep it. YouTube songs have no
  // duration until the iframe reports one, and songs added before durationSec
  // existed have none either — but LRCLIB matching leans on it heavily (it is
  // the main thing telling two masters of the same song apart), so the first
  // real value is worth storing.
  //
  // Never overwrite: a duration parsed from file metadata is exact, and a
  // polled one is not. Absent-only keeps the better value.
  useEffect(() => {
    if (!song || song.durationSec != null) return
    if (!Number.isFinite(duration) || duration <= 0) return
    const updated: Song = { ...song, durationSec: duration }
    void db.songs.put(updated).then(() => setSong(updated))
  }, [song, duration])
```

Guard conditions, all required: only when the song is loaded, only when no duration is already stored, only when the reported duration is finite and positive.

- [ ] **Step 4: Verify and commit**

Run: `npx vitest run tests/player && npx tsc -b && npx eslint src/player`

```bash
git add src/player/PlayerView.tsx tests/player/PlayerView.durationPersist.test.tsx
git commit -m "feat(player): persist a learned track duration from playback"
```

---

## Task 6: Offer a closer match once the duration is known

**Files:**
- Create: `src/sources/lyricsRerank.ts`
- Test: `tests/sources/lyricsRerank.test.ts`

This task delivers the **pure decision logic only**. Wiring it to UI is deliberately deferred: it needs a candidate list to be retained through resolution, which is a larger change, and the decision rule is worth pinning independently first.

- [ ] **Step 1: Write the failing test**

Create `tests/sources/lyricsRerank.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { findCloserCandidate } from '../../src/sources/lyricsRerank'

const c = (id: number, duration?: number) => ({ id, duration })

describe('findCloserCandidate', () => {
  // Only speak up when the current match is genuinely wrong AND something better
  // exists. Prompting on a marginal score gap would nag about correct matches.
  it('offers a candidate inside tolerance when the current one is outside', () => {
    expect(findCloserCandidate(c(1, 250), [c(1, 250), c(2, 230)], 230)?.id).toBe(2)
  })

  it('stays silent when the current match is already within tolerance', () => {
    expect(findCloserCandidate(c(1, 231), [c(1, 231), c(2, 230)], 230)).toBeNull()
  })

  it('stays silent when no candidate is within tolerance', () => {
    expect(findCloserCandidate(c(1, 300), [c(1, 300), c(2, 320)], 230)).toBeNull()
  })

  it('stays silent when the duration is unknown', () => {
    expect(findCloserCandidate(c(1, 300), [c(1, 300), c(2, 230)], undefined)).toBeNull()
  })

  it('stays silent when the current candidate has no duration to judge', () => {
    expect(findCloserCandidate(c(1), [c(1), c(2, 230)], 230)).toBeNull()
  })

  it('picks the closest when several are within tolerance', () => {
    expect(findCloserCandidate(c(1, 250), [c(1, 250), c(2, 231.5), c(3, 230.2)], 230)?.id).toBe(3)
  })

  it('never offers the candidate already in use', () => {
    expect(findCloserCandidate(c(1, 250), [c(1, 250)], 230)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sources/lyricsRerank.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `src/sources/lyricsRerank.ts`:

```ts
import { durationMatches } from './lyricsMatch'

/** Minimum shape needed to judge a candidate — anything with an id and a length. */
export interface RerankCandidate {
  id: number
  duration?: number
}

/**
 * A better-matching candidate for a now-known track length, or null to stay quiet.
 *
 * YouTube songs resolve their lyrics before any duration is available, so the
 * first match is chosen on title and artist alone. Once playback reports a real
 * length we can re-judge — but only worth interrupting the user when BOTH:
 *
 *   1. the candidate in use is outside tolerance, and
 *   2. another candidate is inside it.
 *
 * Re-ranking on a marginal score difference would nag about matches that are
 * already correct, which is how a useful prompt turns into one people dismiss.
 *
 * Pure: no network, no re-search. Callers supply the list they already have.
 */
export function findCloserCandidate<T extends RerankCandidate>(
  current: T,
  candidates: readonly T[],
  knownDurationSec: number | undefined,
): T | null {
  if (knownDurationSec == null || !Number.isFinite(knownDurationSec)) return null
  // No stored length means no evidence the current pick is wrong.
  if (current.duration == null) return null
  if (durationMatches(current.duration, knownDurationSec)) return null

  const better = candidates
    .filter((c) => c.id !== current.id && c.duration != null)
    .filter((c) => durationMatches(c.duration, knownDurationSec))
    .sort(
      (a, b) =>
        Math.abs((a.duration as number) - knownDurationSec)
        - Math.abs((b.duration as number) - knownDurationSec),
    )

  return better[0] ?? null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sources/lyricsRerank.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/sources/lyricsRerank.ts tests/sources/lyricsRerank.test.ts
git commit -m "feat(sources): decide when a closer-matching lyric candidate exists"
```

---

## Task 7: Measure whether this actually helped

Every prior round in this project that shipped a threshold on intuition later had it refuted by measurement. This task exists so Phase 2 is a decision rather than an assumption.

**Files:** none — measurement only.

- [ ] **Step 1: Assemble a small corpus**

Pick **at least 8** real songs the user cares about, deliberately including: one with an explicit version marker (the reported Yamashita case), one live version, one remaster, and several plain tracks that currently match correctly. Record for each: title, artist, true duration.

- [ ] **Step 2: Record before/after**

For each song, capture which LRCLIB entry is selected and whether it is correct, on `main` and on this branch. Note the selected entry's title and duration.

- [ ] **Step 3: Report**

Produce a short table: song → before → after → correct?

The two numbers that decide Phase 2:
- **How many songs now match the right version** (did Phase 1 fix the complaint?).
- **How many still have no 1-to-1 match at all** — this is the population Phase 2's retiming would serve. If it is near zero, Phase 2 should not be built.

- [ ] **Step 4: Check for regressions explicitly**

Any song that matched correctly before and matches incorrectly now is a **blocking regression**, most likely from the version-agreement penalty being too aggressive. `AGREE` (0.12) and `CONFLICT` (−0.18) in `versionMarker.ts` are starting values chosen by judgement, not measurement — tune them against this corpus and record the final values and why.

---

## Out of Scope

- Anything from spec sections 4–5: `linearTimingFit`, `SyncCalibrator`, the `timingOrigin` field, drag-to-sync. That is Phase 2 and must not be started here.
- **The re-rank PROMPT UI from spec section 3.** Task 6 delivers only the pure decision (`findCloserCandidate`). Showing "Found a closer match for this version — use it?" additionally requires retaining the ranked candidate list through `findLyrics` and `resolveLyricsForSong`, which today return a single lookup and would need a shape change across both. That is a larger change than it appears and is deliberately deferred rather than rushed; Task 7's measurement will also show whether it is worth doing at all. **Phase 1 therefore does not fully deliver spec section 3** — this is a known, deliberate gap, not an oversight.
- Rebuilding or redesigning the Tap-through screen (thread C3).
- Changing how LRCLIB is searched (`buildSearchQueries`, title/artist variant expansion) — only how results are *scored*.
- Changing `refitAroundAnchors` or any existing alignment behavior.
