# Local Re-Align Pass

**Date:** 2026-06-30  
**Branch:** refine/audit-corpus-landing-demo

## Overview

Add a targeted re-alignment action for lines flagged as `approximate` or `needs_review` after auto-align. Uses the already-stored Whisper transcript (`LyricsData.transcriptWords`) — no re-transcription needed. Two modes: per-row (surgical) and bulk (fix all weak lines at once).

---

## Background

After auto-align, each line receives a `LineAlignmentQuality` of `'good' | 'approximate' | 'needs_review'`. Weak lines already show badges in `EditMode` (`"timing approximate"`, `"approx"`), but tapping them does nothing. The Whisper word timeline is stored in `LyricsData.transcriptWords` after the first align pass, so a focused local re-anchor can run entirely from that cache — sub-millisecond for a 3-line slice.

The existing `validateAndRetryLineTimings` already does per-line windowed retry across the whole song. This feature wraps that logic into a narrower, targeted slice.

---

## Core Logic — `phraseAlignment.ts`

### `realignLocalSlice`

```ts
export function realignLocalSlice(
  lines: TimedLine[],
  targetIndex: number,
  transcriptWords: TimedTranscriptWord[],
  sourceLanguage: Language,
  anchorSourcesIn?: LineAnchorSource[],
): {
  lines: TimedLine[]
  lineAlignmentQuality: LineAlignmentQuality[]
  anchorSources: LineAnchorSource[]
}
```

- Clamps slice to `[max(0, targetIndex-1), min(n-1, targetIndex+1)]` — always 2–3 rows
- Passes the slice's current timings to `validateAndRetryLineTimings` as initial positions
- Uses the immediately surrounding lines' timings as boundary hints (prev end, next start) so the search window is tightly bounded
- Merges the updated timings + quality + anchorSources back into full-length arrays immutably
- Returns the complete updated arrays for a simple store replace

### `realignAllWeakLines`

```ts
export function realignAllWeakLines(
  lines: TimedLine[],
  transcriptWords: TimedTranscriptWord[],
  lineAlignmentQuality: LineAlignmentQuality[],
  sourceLanguage: Language,
  anchorSources?: LineAnchorSource[],
): {
  lines: TimedLine[]
  lineAlignmentQuality: LineAlignmentQuality[]
  anchorSources: LineAnchorSource[]
}
```

- Collects all indices where `lineAlignmentQuality[i]` is `'needs_review'` or `'approximate'`
- Calls `realignLocalSlice` sequentially on each, accumulating state between iterations so each newly-anchored line becomes neighbor context for the next
- Returns the final merged result (no intermediate persistence — caller decides when to save)

---

## Store Integration — `LyricsStore.ts`

### `localRealignLine(songId: string, targetIndex: number): Promise<void>`

1. Load the song; bail silently if `lyrics.transcriptWords` is absent (tap-synced or pre-cache song)
2. Call `realignLocalSlice` — synchronous, < 1ms for 3 lines
3. Persist updated `lines`, `lineAlignmentQuality`, `anchorSources` to IndexedDB
4. Emit updated song to subscribers

### `localRealignAllWeak(songId: string): Promise<void>`

1. Same guard on `transcriptWords`
2. Call `realignAllWeakLines`
3. If weak line count > 10, yield to the main thread via `yieldToMainThread()` between every 5 iterations to avoid jank
4. Persist + emit once at the end

---

## UI — `EditMode.tsx`

### New props

```ts
onLocalRealign?: (lineIndex: number) => void
onRealignAllWeak?: () => void
localRealigning?: Set<number>   // indices with an in-flight re-align (for spinner)
weakLineCount?: number          // pre-computed count of needs_review + approximate lines
```

### Per-row (Option A)

On rows where `alignmentQuality === 'needs_review'` or `'approximate'`:

- Replace the static text badge with a tappable chip button
- Label: `⟳ re-sync` (needs_review, amber) or `⟳ approx` (approximate, dim white)
- While `localRealigning?.has(index)`: show a spinner in place of the icon
- After completion: badge updates to reflect the new quality (or disappears if now `good`)
- Hidden when `onLocalRealign` is not provided (e.g., no `transcriptWords`)

### Bulk action (Option C)

In the EditMode toolbar, when `weakLineCount > 0` and `onRealignAllWeak` is provided:

- Secondary button: `"Re-align N weak lines"`
- During processing: label changes to `"Re-aligning…"` (no spinner needed — fast)
- After completion: button disappears if all weak lines are resolved, or updates count if some remain (e.g., lines that are weak due to missing transcript coverage can't self-fix)
- Positioned near the existing "Auto-align" button so it reads as a refinement action

### Disabled/hidden states

- Both actions are absent when `transcriptWords` is missing from the song
- The per-row chip falls back to a non-interactive badge (current behavior) in that case

---

## PlayerView wiring

`PlayerView` already passes `lineAlignmentQuality` down to `EditMode`. Add:

- `onLocalRealign={(i) => lyricsStore.localRealignLine(song.id, i)}`
- `onRealignAllWeak={() => lyricsStore.localRealignAllWeak(song.id)}`
- `localRealigning` state: a `Set<number>` managed in `PlayerView` that adds `i` before the async call and removes it in `finally`
- `weakLineCount`: derived from `song.lyrics.lineAlignmentQuality` — count of `needs_review` entries

---

## Error handling

- Missing `transcriptWords`: silent no-op (UI hides the action)
- `realignLocalSlice` throws: catch in the store action, log, no update (leave existing timing intact)
- Bulk: if one slice throws, skip that index and continue — partial improvement is better than none

---

## Testing

- Unit: `realignLocalSlice` on a synthetic 5-line array with known transcript words — verify only the target ± 1 rows change
- Unit: `realignAllWeakLines` — verify sequential accumulation (row N's updated timing is used as boundary for row N+2)
- Integration: existing `alignment-benchmark.test.ts` — run after the change to confirm no regression in overall alignment quality scores

---

## Out of scope

- Re-running Whisper for lines with no transcript coverage (those stay flagged; the user is told they need a full re-align or tap-sync for those)
- Phrase-layer re-derivation after a local slice update (phrases are derived from the full pipeline run; local re-align only updates `lines`, not `phrases`)
- Undo/redo integration (EditMode already has an undo stack; the local re-align result can be undone through the existing mechanism since it updates `lines`)
