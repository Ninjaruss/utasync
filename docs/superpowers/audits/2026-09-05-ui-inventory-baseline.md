# UI inventory & baseline

**Date:** 2026-09-05
**Phase:** 1 of `docs/superpowers/specs/2026-09-05-ui-finalization-design.md`
**Status:** In progress

## Harness

How each tier was reached, and proof it was reached.

Dev server: started via the Browser pane's `preview_start` tool with the `.claude/launch.json`
config named `dev` (`npm run dev`, `autoPort: true`). It reported origin
`http://localhost:5173` for this run — if a future run reports a different port (because
5173 was taken), substitute that origin everywhere below; the navigation sequence itself
does not change.

Tier logic lives in `src/ai-pipeline/capability.ts`:

```ts
if (gpu && memory >= 6) return 'full'
if (gpu && memory >= 4) return 'lite'
if (!isMobileBrowser(nav) && memory >= 6) return 'lite'
return 'manual'
```

`isMobileBrowser` checks `navigator.userAgentData.mobile`, falling back to
`/Android|iPhone|iPad|Mobi/i` on the UA string. The Browser pane's `resize_window`
`mobile` preset emulates an Android Chrome user agent, satisfying that check. The
dev-only `?webgpu=off` query switch forces `hasWebGPU()` false and persists in
`sessionStorage`, surviving reloads and in-app navigation — it must be explicitly
cleared with `?webgpu=on` before the desktop journey, or Journey B silently runs at
the wrong tier. Manual tier needs **both** the mobile preset (for `isMobileBrowser`)
and `?webgpu=off` (for `gpu`); `?webgpu=off` alone on a desktop UA falls through to
`'lite'`, not `'manual'`. The tier is read at page load, so any preset/query change
must be followed by a reload before re-checking the tier.

### Manual tier (Journey A)

Exact navigation sequence (order matters — the reload must come last):

```
navigate      → http://localhost:5173/?webgpu=off
resize_window → preset: "mobile"
navigate      → http://localhost:5173/?webgpu=off      (reload so the gate re-runs)
```

Recorded via `javascript_tool`:

```js
const cap = await import('/src/ai-pipeline/capability.ts')
JSON.stringify({
  tier: cap.getDeviceTier(),
  webgpu: cap.hasWebGPU(),
  mobileUA: /Android|iPhone|iPad|Mobi/i.test(navigator.userAgent),
  deviceMemory: navigator.deviceMemory ?? null,
  cores: navigator.hardwareConcurrency,
})
```

Reading (verbatim):

```json
{"tier":"manual","webgpu":false,"mobileUA":true,"deviceMemory":16,"cores":10}
```

Manual tier is confirmed reachable on this machine. Gate passed — proceeding to
Journey B / Full tier and to Tasks 2–5.

### Full tier (Journey B)

Exact navigation sequence (order matters — the reload must come last):

```
navigate      → http://localhost:5173/?webgpu=on
resize_window → preset: "desktop"
navigate      → http://localhost:5173/?webgpu=on
```

Recorded with the same Step-3 snippet as above.

Reading (verbatim):

```json
{"tier":"full","webgpu":true,"mobileUA":false,"deviceMemory":16,"cores":10}
```

This machine reports `"full"` (16GB device memory, WebGPU available under the
`resize_window` `desktop` preset), so Journey B documents the Full tier as planned —
no Lite-tier fallback was needed.

To return to either tier for later journey tracing (Tasks 2–3), replay the exact
navigation sequence above for that tier — the mobile/desktop preset switch and the
`?webgpu=` query param must both be set before the final reload, since the tier is
only evaluated at page load.

## Journey A — phone, Manual tier

**Run:** 2026-09-07, viewport 375x812, tier reading
`{"tier":"manual","webgpu":false,"mobileUA":true,"deviceMemory":16,"cores":10}`.
State cleared first (`utasync` IndexedDB deleted, localStorage cleared, `landingSeen: null`
confirmed) so this is a genuine first visit.

**Determinism:** `lrclib.net` and `itunes.apple.com` were stubbed; `www.youtube.com` and
`img.youtube.com` reached the real network, because the journey needs the real embed UI.
This journey therefore requires network access and is not hermetic. The stub deliberately
returns a *non-matching* song ("Guitar / Test") so the mismatch guard is exercised.

**Song used:** `https://www.youtube.com/watch?v=dQw4w9WgXcQ` → oEmbed resolved
"Never Gonna Give You Up · Rick Astley".

### Trace

| # | Surface | How it appeared | Exits offered | Notes |
|---|---|---|---|---|
| 1 | Landing | `auto` (first visit) | "Get started →", "Open the app →", "Open the app" | Three CTAs, all the same action |
| 2 | Library (empty) | `auto` after landing | — (root view) | Empty state; only 2 controls: ⚙ Settings, ＋ Add a song |
| 3 | Onboarding carousel, 3 steps | `auto`, over Library | Skip (steps 1–2); Back / Done (step 3) | Must be cleared before the library is usable |
| 4 | Add-song sheet | `headline` (＋ Add a song) | ✕ Close | Opens on **Upload audio**, marked RECOMMENDED |
| 5 | Add-song → YouTube link tab | `menu` (tab within the sheet) | ✕ Close | Honest LIMITATIONS list: "No AI auto-align or clip export" |
| 6 | Lyrics-found confirm (mismatch) | `auto`, inline in the sheet | "Yes, this is the right song" / "Use different lyrics" | Gates the commit: **"Add song" is disabled until resolved** |
| 7 | Player, Play mode | `auto` after Add song | ← Back | No alignment screen — correct: lyrics arrived synced, so `chooseAutoAlignment` returned `null` |

### Numbers

Two counts are reported for "decisions", because the single number is contestable and
the distinction turned out to matter:

| Measure | Value |
|---|---|
| Decision points (choose among ≥2 options, or supply input) | **5** — enter app; dismiss onboarding; choose source; paste URL; resolve mismatch |
| Required interactions (clicks + inputs) | **9** — landing CTA, Next, Next, Done, YouTube tab, paste, Continue, confirm match, Add song |
| Distinct surfaces met | **7** |
| Controls in default player viewport | **16 total, 3 lyric rows, 13 non-lyric** |

The 13 non-lyric controls: ← Back, Play, Edit, Settings, Lyrics display options,
Add audio file, Seek, Rewind 5 seconds, Start playback, Forward 5 seconds, Loop,
Speed 100 percent, Saved loops.

### Endpoint caveat — read before trusting the "first synced playback" framing

Playback could **not** be confirmed in this environment. The Browser pane runs as a
hidden tab (`document.hidden === true`, `visibilityState: "hidden"`) and a scripted
`.click()` is not a trusted user gesture, so the YouTube embed does not begin playing.
The iframe itself is present and correctly configured
(`embed/dQw4w9WgXcQ?autoplay=0&rel=0&playsinline=1&origin=...`).

**This is not filed as a defect.** The journey is therefore measured to "player open,
lyrics present and timed, transport rendered" rather than to observed playback. Every
number above is unaffected — none of them depends on the audio actually running.

### Evidence: endpoints actually requested

14 LRCLIB requests were issued for this one song (`/api/get` ×2, `/api/search` ×12),
plus one YouTube oEmbed and one caption fetch. Recorded as an observation, not a defect —
`cachedFetchJson` de-duplicates and the session halts on rate-limit/offline.

## Journey B — desktop, Full tier

(Not yet traced — reserved for Task 3.)

## Consolidated surface list

(Reserved for a later task in this phase.)

## Baseline numbers

(Reserved for a later task in this phase.)

## Draft demote/cut table

(Reserved for a later task in this phase.)

## Defects observed

Recorded, not fixed, per the standing rule for this phase.

### D1 — Tier-blind AI copy, three places (Manual tier)

The app promises AI capability to a device that can never deliver it. All three were
observed on this run, at `tier: "manual"`:

1. Add-song sheet, **Upload audio** tile — lists "✓ AI auto-align lyrics" under INCLUDES.
2. Add-song sheet, **YouTube link** tile — offers "+ Add audio file (unlocks AI align & export — optional)".
3. Player — status line reads "YouTube stream · add audio for AI align", beside a "+ Audio" button.

On Manual tier, attaching audio unlocks neither auto-align nor (per the same tile's own
LIMITATIONS list) clip export. The tier is known at render time via `getDeviceTier()`,
so this copy is conditionable. Note the YouTube tile is simultaneously *honest* in its
LIMITATIONS ("No AI auto-align or clip export") and *misleading* in its call to action —
the two lines contradict each other on the same screen.

Severity note for Phase 5: this is the single most repeated defect found in Journey A,
and it lands on the phone tier, which the spec treats as one of two primary audiences.

### D2 — Three identical landing CTAs (minor)

The landing page renders "Get started →", "Open the app →" and "Open the app". All three
call the same action. Not harmful; noted because the spec's simplification criterion
targets exactly this kind of redundant default-surface choice.

## Not defects — verified false positives

Recorded so later rounds do not re-file them.

- **Playback does not start.** Hidden-tab + synthetic-gesture artifact; see the Journey A
  endpoint caveat. The iframe is present and correctly configured.
- **`computer` clicks time out after 30s.** The Browser pane is hidden, so actions that
  wait for a paint cannot complete. Drive the app with `element.click()` from
  `javascript_tool` instead. **This artifact stalled two delegated attempts at this task
  before the cause was identified** — an agent retrying timing-out clicks looks exactly
  like "no progress for 600s". Anyone re-running this journey must know it up front.
- **Word-pair colouring at 0% / missing furigana.** Enrichment runs on
  `requestIdleCallback`, which is suspended in a hidden tab.

