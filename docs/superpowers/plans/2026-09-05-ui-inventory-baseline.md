# UI Inventory & Baseline (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a committed audit document recording the app's true user-facing surface list and a measured first-run baseline for both device tiers, so Phase 3's screen union has factual membership and Phase 5's simplification has a number to beat.

**Architecture:** No production code changes. Two journeys are driven live in the running dev server — phone at Manual tier, desktop at Full tier — using the browser's own console to force tier, stub the two non-deterministic lyric endpoints, and inject a real mp3 into the file input. Observations land in one audit doc.

**Tech Stack:** Vite dev server, the in-app Browser pane tools (`preview_start`, `navigate`, `resize_window`, `javascript_tool`, `read_page`, `computer`), real mp3s in `public/e2e/`.

**Spec:** `docs/superpowers/specs/2026-09-05-ui-finalization-design.md`

## This plan has no failing-test-first shape, deliberately

Phase 1 is an investigation. There is no unit under test and no assertion to write
first. Every task instead ends in a **recorded measurement committed to the audit
doc** — which is the thing a reviewer can check, and the thing later phases consume.

Two consequences worth internalising before starting:

- **Do not fix anything you find.** Defects encountered during the journeys get
  recorded in a "Defects observed" section, not patched. Patching mid-inventory
  changes the thing being measured, and the baseline stops being a baseline.
- **Record what actually happened, including when it contradicts the spec.** The spec
  asserts a hypothesis about loop-playlist controls (Task 5). If the journeys refute
  it, the audit says so. An inventory that confirms its author is worthless.

## Global Constraints

Copied verbatim from the spec's Non-goals and Risks:

- No new features. No visual redesign. No alignment-accuracy work.
- No 320px header redesign — September parked this deliberately; 375px is the real phone floor.
- `src/ai-pipeline` alignment math is out of scope; any movement in alignment baselines means the boundary was crossed.
- Phase 1 ships **a committed audit doc, no code**. The reproducibility harness lives as fenced snippets inside that doc, not as a new module. (`src/dev/e2eAlignHarness.ts` is the precedent for dev-only harness code; it is deliberately not extended here, because the spec scopes this phase to documentation.)

---

## File Structure

| File | Responsibility |
|---|---|
| `docs/superpowers/audits/2026-09-05-ui-inventory-baseline.md` (create) | The single deliverable. Harness snippets, two journey traces, the consolidated surface list, the baseline table, the draft demote/cut table, and defects observed. |

No other file is created or modified by this plan.

---

## Task 1: Prove both tier environments are reachable

The whole plan rests on being able to reach Manual tier on a machine that has WebGPU.
Verify that **before** spending effort on journeys, because if it fails the plan changes
shape.

**Files:**
- Create: `docs/superpowers/audits/2026-09-05-ui-inventory-baseline.md`

**Interfaces:**
- Produces: a verified `getDeviceTier()` reading of `'manual'` and of `'full'`, plus the exact steps that produced each — consumed verbatim by Tasks 2 and 3.

**Background the executor needs.** `src/ai-pipeline/capability.ts` decides the tier:

```ts
if (gpu && memory >= 6) return 'full'
if (gpu && memory >= 4) return 'lite'
if (!isMobileBrowser(nav) && memory >= 6) return 'lite'
return 'manual'
```

`isMobileBrowser` tests `navigator.userAgentData.mobile`, falling back to
`/Android|iPhone|iPad|Mobi/i` on the UA string. The Browser pane's `resize_window`
**mobile** preset emulates an Android Chrome user agent, so it satisfies that test.
A dev-only switch `?webgpu=off` forces `hasWebGPU()` false and **persists in
sessionStorage**, so it survives reloads and in-app navigation — and must be
explicitly cleared with `?webgpu=on` before the desktop journey, or Journey B
silently runs at the wrong tier.

Manual therefore needs **both** the mobile preset (for `isMobileBrowser`) and
`?webgpu=off` (for `gpu`). Neither alone is sufficient: `?webgpu=off` on a desktop
UA falls through to `'lite'`.

- [ ] **Step 1: Start the dev server**

Use `preview_start` with a `.claude/launch.json` entry for `npm run dev`. Do not run
the dev server through Bash.

- [ ] **Step 2: Force Manual tier and reload**

Navigate to the app with the override, then switch to the mobile preset, then reload —
in that order. The tier is read at load time, so the reload must come last.

`vite.config.ts` sets no `server.port`, so this is Vite's default — but use whatever
origin `preview_start` actually reported, since the port shifts if 5173 is taken.

```
navigate  → http://localhost:5173/?webgpu=off
resize_window → preset: "mobile"
navigate  → http://localhost:5173/?webgpu=off      (reload so the gate re-runs)
```

- [ ] **Step 3: Record the tier reading**

Via `javascript_tool`:

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

Expected: `tier: "manual"`, `webgpu: false`, `mobileUA: true`.

**If `tier` is not `"manual"`, stop and report.** Do not proceed to Task 2 with the
wrong tier — a Journey A trace at Lite tier measures a user who does not exist.

- [ ] **Step 4: Restore Full tier and record it**

```
navigate  → http://localhost:5173/?webgpu=on
resize_window → preset: "desktop"
navigate  → http://localhost:5173/?webgpu=on
```

Re-run the Step 3 snippet. Expected: `tier: "full"`, `webgpu: true`, `mobileUA: false`.

If this machine reports `"lite"` rather than `"full"` (no WebGPU adapter, or under
6GB), **record that and continue** — Journey B then documents the Lite tier, and the
audit says so plainly rather than claiming a Full-tier trace it did not take.

- [ ] **Step 5: Create the audit doc with both readings**

```bash
mkdir -p docs/superpowers/audits
```

Create `docs/superpowers/audits/2026-09-05-ui-inventory-baseline.md` with this
skeleton, filling the two JSON readings in verbatim:

```markdown
# UI inventory & baseline

**Date:** 2026-09-05
**Phase:** 1 of `docs/superpowers/specs/2026-09-05-ui-finalization-design.md`
**Status:** In progress

## Harness

How each tier was reached, and proof it was reached.

### Manual tier (Journey A)
[steps + the JSON reading]

### Full tier (Journey B)
[steps + the JSON reading]

## Journey A — phone, Manual tier
## Journey B — desktop, Full tier
## Consolidated surface list
## Baseline numbers
## Draft demote/cut table
## Defects observed
```

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/audits/2026-09-05-ui-inventory-baseline.md
git commit -m "docs: prove both device tiers are reachable for the UI inventory"
```

---

## Task 2: Journey A — phone, Manual tier

**Files:**
- Modify: `docs/superpowers/audits/2026-09-05-ui-inventory-baseline.md` (§ Journey A, § Defects observed)

**Interfaces:**
- Consumes: the Manual-tier steps recorded in Task 1.
- Produces: an ordered surface trace and three numbers, consumed by Tasks 4 and 5.

**What this journey is:** a first-time visitor on a phone adds a song by YouTube link,
lyrics arrive from LRCLIB, and they watch the lyrics follow the music. No AI is
available to them at any point.

**Determinism decision.** Stub only `lrclib.net` and `itunes.apple.com`, so the same
lyrics come back on every run. Let `www.youtube.com` and `img.youtube.com` reach the
real network — the journey needs the real embed UI, which we do not control and should
not fake. **This journey therefore requires network access.** Record that caveat in the
audit doc.

- [ ] **Step 1: Reach Manual tier and clear all state**

Reach Manual tier. Order matters — the tier is read at load time, so the reload comes
last. Use whatever origin `preview_start` reported (`vite.config.ts` sets no
`server.port`, so Vite's default is 5173).

```
navigate  → http://localhost:5173/?webgpu=off
resize_window → preset: "mobile"
navigate  → http://localhost:5173/?webgpu=off      (reload so the gate re-runs)
```

Confirm before continuing:

```js
(await import('/src/ai-pipeline/capability.ts')).getDeviceTier()
```

Expected: `"manual"`. If it is anything else, stop and report.

Then clear all state:

```js
indexedDB.deleteDatabase('utasync')   // the Dexie db name, src/core/db/schema.ts:9
localStorage.clear()
location.reload()
```

This matters: `utasync_landing_seen` in localStorage suppresses the landing page, and a
returning visitor is not the user being measured. `sessionStorage` is deliberately NOT
cleared — it holds the `?webgpu=off` override.


- [ ] **Step 2: Install the lyric-endpoint stub**

Run via `javascript_tool` **after** the reload, before touching the UI:

```js
const LRC = [
  '[00:12.10]Some line one',
  '[00:16.40]Some line two',
  '[00:21.00]Some line three',
].join('\n')

const result = {
  id: 1, name: 'Guitar', artistName: 'Test',
  albumName: 'Test Album', duration: 200,
  syncedLyrics: LRC, plainLyrics: 'Some line one\nSome line two\nSome line three',
}

const realFetch = window.fetch.bind(window)
window.__stubHits = []
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input.url
  window.__stubHits.push(url)
  if (url.includes('lrclib.net/api/search')) return Promise.resolve(new Response(JSON.stringify([result]), { status: 200, headers: { 'content-type': 'application/json' } }))
  if (url.includes('lrclib.net/api/get')) return Promise.resolve(new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json' } }))
  if (url.includes('itunes.apple.com')) return Promise.resolve(new Response(JSON.stringify({ resultCount: 0, results: [] }), { status: 200, headers: { 'content-type': 'application/json' } }))
  return realFetch(input, init)
}
'stub installed'
```

The shape matches `LRCLIBResult` in `src/sources/lrclib.ts:88`. `window.__stubHits`
records every URL the app requested, which Step 5 uses as evidence.

- [ ] **Step 3: Walk the journey, recording every surface as you meet it**

Drive the UI with `computer` / `read_page`. Per
[[ux-quality-round-2026-09]]: **synthetic clicks are unreliable on this app's overlays
and its Play/Edit segmented pill** — the pill's `relative z-10` sliding indicator
swallows them. Where a click appears to do nothing, re-issue it as `element.click()`
from `javascript_tool` before concluding anything is broken.

The route: Landing → enter app → Library → Add → YouTube link → paste a URL → confirm
metadata → lyrics resolve → open player.

After **every** transition, append a row to a running trace with these five fields:

| # | Surface | How it appeared | Exits offered | Notes |
|---|---|---|---|---|

"How it appeared" is one of `auto` (opened itself), `headline` (a primary button),
`menu` (behind a disclosure), `precondition` (appeared because state allowed it).

- [ ] **Step 4: Record the three baseline numbers**

Stop the clock at the moment the lyrics first follow the music.

1. **Decisions before that moment** — count every point where the user had to choose
   between two or more options or supply input. Paste-the-URL is one. Confirming
   metadata is one. Dismissing a screen is one.
2. **Distinct surfaces met** — the trace row count. (An earlier draft said "the row count from Step 3" here and "the trace row count" in the other journey; the audit settles this at trace level, and states the admission rule.)
3. **Interactive controls in the default player viewport without opening a menu** —
   measure, do not eyeball:

```js
const inView = (el) => {
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0 && r.left < innerWidth && r.right > 0
}
const sel = 'button, a[href], input, select, textarea, [role="button"], [role="switch"], [role="slider"]'
const all = [...document.querySelectorAll(sel)].filter(inView)
JSON.stringify({
  total: all.length,
  lyricRows: all.filter(e => e.closest('[aria-label^="Jump to"], [aria-label^="Set loop point"]')).length,
  labels: all.map(e => (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 40)),
}, null, 2)
```

Report `total` **and** `total - lyricRows`. Lyric rows are `role="button"`
(`src/lyrics/LyricDisplay.tsx:432`) and would otherwise inflate the count by the number
of lines on screen, which is a property of the song, not of the interface.

- [ ] **Step 5: Write Journey A into the audit doc**

Fill § Journey A with: the trace table, the three numbers (both control counts), the
`window.__stubHits` list as evidence of which endpoints were actually used, and the
network caveat. Add anything broken to § Defects observed — **recorded, not fixed**.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/audits/2026-09-05-ui-inventory-baseline.md
git commit -m "docs: record the phone/Manual-tier first-run journey"
```

---

## Task 3: Journey B — desktop, Full tier

**Files:**
- Modify: `docs/superpowers/audits/2026-09-05-ui-inventory-baseline.md` (§ Journey B, § Defects observed)

**Interfaces:**
- Consumes: the Full-tier steps from Task 1; the trace-table format and measurement snippet from Task 2.
- Produces: a second trace and second set of numbers, consumed by Tasks 4 and 5.

**What this journey is:** a first-time visitor on a laptop uploads their own mp3 and
runs auto-align.

- [ ] **Step 1: Reach Full tier with clean state**

**`?webgpu=on` is mandatory** — without it the sessionStorage override from the phone
journey persists and this journey silently runs at the wrong tier.

```
navigate  → http://localhost:5173/?webgpu=on
resize_window → preset: "desktop"
navigate  → http://localhost:5173/?webgpu=on      (reload so the gate re-runs)
```

Confirm the tier before proceeding:

```js
(await import('/src/ai-pipeline/capability.ts')).getDeviceTier()
```

Expected: `"full"`. If this machine reports `"lite"` (no WebGPU adapter, or under 6GB),
record that and continue — the audit then documents a Lite-tier trace and says so
plainly rather than claiming a Full-tier trace it did not take.

Then clear all state:

```js
indexedDB.deleteDatabase('utasync')   // the Dexie db name, src/core/db/schema.ts:9
localStorage.clear()
location.reload()
```

This matters: `utasync_landing_seen` in localStorage suppresses the landing page, and a
returning visitor is not the user being measured. `sessionStorage` is deliberately NOT
cleared — it holds the `?webgpu=on` override that this journey just set (the phone
journey's `?webgpu=off` is what `?webgpu=on` cleared).

- [ ] **Step 1b: Install the lyric-endpoint stub**

Run via `javascript_tool` **after** the reload, before touching the UI (a reload would
wipe it):

```js
const LRC = [
  '[00:12.10]Some line one',
  '[00:16.40]Some line two',
  '[00:21.00]Some line three',
].join('\n')

const result = {
  id: 1, name: 'Guitar', artistName: 'Test',
  albumName: 'Test Album', duration: 200,
  syncedLyrics: LRC, plainLyrics: 'Some line one\nSome line two\nSome line three',
}

const realFetch = window.fetch.bind(window)
window.__stubHits = []
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input.url
  window.__stubHits.push(url)
  if (url.includes('lrclib.net/api/search')) return Promise.resolve(new Response(JSON.stringify([result]), { status: 200, headers: { 'content-type': 'application/json' } }))
  if (url.includes('lrclib.net/api/get')) return Promise.resolve(new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json' } }))
  if (url.includes('itunes.apple.com')) return Promise.resolve(new Response(JSON.stringify({ resultCount: 0, results: [] }), { status: 200, headers: { 'content-type': 'application/json' } }))
  return realFetch(input, init)
}
'stub installed'
```

The shape matches `LRCLIBResult` (`src/sources/lrclib.ts:88`). `lrclib.ts`'s own
`requestCache` is a module-level in-memory Map (`src/sources/lrclib.ts:36`), so the
reload cleared it and this stub is what the app will actually hit.
`window.__stubHits` records every requested URL, used as evidence later.


- [ ] **Step 2: Inject a real mp3 into the file input**

The technique is from [[ux-quality-round-2026-09]]; it exercises decode, metadata
extraction, ingest and lyrics search for real. Filename shape matters — the app derives
title and artist from it.

```js
const input = document.querySelector('input[type="file"]')
const blob = await (await fetch('/e2e/guitar.mp3')).blob()
const file = new File([blob], 'Test - Guitar.mp3', { type: 'audio/mpeg' })
const dt = new DataTransfer(); dt.items.add(file)
Object.defineProperty(input, 'files', { value: dt.files, configurable: true })
input.dispatchEvent(new Event('change', { bubbles: true }))
'injected'
```

If `document.querySelector('input[type="file"]')` returns null, the Add sheet is not
open or is not on the upload tab — open it first. The inputs are `sr-only`, not
`display:none` (fixed in the September round), so they are present in the DOM and
focusable.

- [ ] **Step 3: Walk the journey and record every surface**

Drive the UI with `computer` / `read_page`. **Synthetic clicks are unreliable on this
app's overlays and its Play/Edit segmented pill** — the pill's `relative z-10` sliding
indicator swallows them. Where a click appears to do nothing, re-issue it as
`element.click()` from `javascript_tool` before concluding anything is broken.

After **every** transition, append a row to a running trace:

| # | Surface | How it appeared | Exits offered | Notes |
|---|---|---|---|---|

"How it appeared" is one of `auto` (opened itself), `headline` (a primary button),
`menu` (behind a disclosure), `precondition` (appeared because state allowed it).

Route: Landing → Library → Add → upload → metadata confirm → lyrics resolve → player →
whatever alignment surface the app opens.

Note especially which alignment surface appears and **why**.
`chooseAutoAlignment` (`src/player/alignmentPolicy.ts`) returns `null` for
already-timed lyrics — so with the LRC stub returning synced lyrics, expect **no**
forced alignment screen. Record what actually happens.

Auto-align is a multi-minute on-device run. Do **not** wait for it to finish. Record
the surfaces it presents (progress, stages, cancel affordances) and move on; this task
measures interface, not alignment quality.

- [ ] **Step 4: Record the three baseline numbers**

Stop the clock at the moment the lyrics first follow the music.

1. **Decisions before that moment** — count every point where the user had to choose
   between two or more options or supply input. Paste-the-URL is one. Confirming
   metadata is one. Dismissing a screen is one.
2. **Distinct surfaces met** — the trace row count.
3. **Interactive controls in the default player viewport without opening a menu** —
   measure, do not eyeball:

```js
const inView = (el) => {
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0 && r.left < innerWidth && r.right > 0
}
const sel = 'button, a[href], input, select, textarea, [role="button"], [role="switch"], [role="slider"]'
const all = [...document.querySelectorAll(sel)].filter(inView)
JSON.stringify({
  total: all.length,
  lyricRows: all.filter(e => e.closest('[aria-label^="Jump to"], [aria-label^="Set loop point"]')).length,
  labels: all.map(e => (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 40)),
}, null, 2)
```

Report `total` **and** `total - lyricRows`. Lyric rows are `role="button"`
(`src/lyrics/LyricDisplay.tsx:432`) and would otherwise inflate the count by the number
of lines on screen, which is a property of the song, not of the interface.


- [ ] **Step 5: Write Journey B into the audit doc, and commit**

```bash
git add docs/superpowers/audits/2026-09-05-ui-inventory-baseline.md
git commit -m "docs: record the desktop/Full-tier first-run journey"
```

---

## Task 4: Consolidate the true surface list

This is the output Phase 3 depends on. A live trace alone is not enough — it only shows
surfaces the two journeys happened to reach. Reconcile it against the static inventory
so nothing is missed.

**Files:**
- Modify: `docs/superpowers/audits/2026-09-05-ui-inventory-baseline.md` (§ Consolidated surface list)

**Interfaces:**
- Consumes: both journey traces.
- Produces: the registry-shaped surface list. **Phase 3's `Overlay` union membership is taken from this list**, so an omission here becomes a missing screen later.

- [ ] **Step 1: Re-derive the static inventory**

> **CORRECTED AFTER EXECUTION — do not use this filter alone.** `fixed inset-0` is the
> wrong boundary: it misses `ConfirmDialog` (`absolute inset-0`, 11 call sites) and
> `DisplayMenu` (portalled `fixed z-50`, no `inset-0`), among others. The app's real modal
> boundary is the `useModalDialog` hook. The corrected three-grep sweep — and the 30-row
> registry it produced — is recorded in the audit's "Consolidated surface list". Anyone
> re-running this plan must use that method, not the one below.

```bash
grep -rn "useModalDialog(" src --include='*.tsx'          # 12 — the real modal boundary
grep -rn 'role="dialog"\|role="alertdialog"' src --include='*.tsx'   # 16
grep -rn "fixed inset-0" src --include='*.tsx'            # 15 — necessary, not sufficient
```

Expect 15 `fixed inset-0` sites. The spec classifies 13 as user-facing surfaces and 2 as
scrims/click-catchers (`src/lyrics/EditMode.tsx:648`, an `aria-hidden` click-catcher,
and `src/player/PlayerControls.tsx:1409`, a backdrop). **If the count is no longer 15,
record the difference** — main may have moved since the spec was written.

- [ ] **Step 2: Reconcile live against static, and account for every difference**

Build the union of both journey traces and the static list. Every entry lands in
exactly one bucket:

- **Seen live and found statically** — the normal case.
- **Found statically, never seen live** — reachable only by a path the journeys did not
  take. For each, state in one line what would reach it. These are prime demote
  candidates in Task 5.
- **Seen live, not a `fixed inset-0` site** — a surface implemented some other way
  (an early `return`, an inline panel). **Call these out explicitly.** The August
  critical was exactly this: tap-through was an early `return` in `PlayerView`, not an
  overlay, which is why grep alone would have missed it.

- [ ] **Step 3: Write the list in registry shape**

One row per surface, matching the metadata the spec defines:

| Surface | File:line | `reach` | `devices` | `role` | Base or overlay | Exits |
|---|---|---|---|---|---|---|

`reach` ∈ `auto | headline | menu | precondition`. `devices` ⊆ `phone, desktop`.
`role` ∈ `core | advanced`. "Base or overlay" records whether it replaces the player or
layers over it — the two-axis distinction from the spec, and the field Phase 3 needs
most.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/audits/2026-09-05-ui-inventory-baseline.md
git commit -m "docs: consolidate the true user-facing surface list"
```

---

## Task 5: Draft the demote/cut table and finalise the audit

**Files:**
- Modify: `docs/superpowers/audits/2026-09-05-ui-inventory-baseline.md` (§ Baseline numbers, § Draft demote/cut table, § Status)

**Interfaces:**
- Consumes: the consolidated surface list and both sets of numbers.
- Produces: the ranked table the user rules on in Phase 5. **Nothing here is implemented in this phase.**

- [ ] **Step 1: Write the baseline table**

| Journey | Device / tier | Decisions to first synced playback | Surfaces met | Controls in player (excl. lyric rows) |
|---|---|---|---|---|

These five numbers are re-measured after Phase 5 per the spec's success criterion 5,
**and reported honestly including if a number did not move.**

- [ ] **Step 2: Apply the demotion criterion to every surface**

The criterion, verbatim from the spec:

> A surface earns default visibility only if the median user needs it to reach *"the
> lyrics follow the music and I can study them."* Everything else is revealed by
> precondition, or sits one level down.

Preference order: **precondition reveal** first (no feature lost, no clutter), then
**one level down** (into `DisplayMenu`, More, or Settings), then **cut** (only for what
nothing reaches and nothing needs).

- [ ] **Step 3: Write the ranked table**

| Rank | Surface | Current reach | Proposed reach | Evidence | Risk if demoted |
|---|---|---|---|---|---|

Rank by how much default-surface noise the change removes. "Evidence" cites the trace
row or measurement it came from — not an opinion. Every row is a **proposal**; the user
rules on each.

- [ ] **Step 4: Settle the spec's loop-playlist hypothesis explicitly**

The spec records a hypothesis, flagged as untested:

> a visible share of `PlayerControls`' 35 buttons is loop-playlist machinery (Saved
> loops, Rename, Move up, Move down, Remove, Plays before next loop) living on the
> surface a beginner meets while trying to follow a song.

Answer it from the Step 1 measurement: how many of those controls were actually in the
default viewport, on each device, without opening a menu. **Write "confirmed",
"partly confirmed" or "refuted" in those words**, with the count. If the controls turn
out to be behind a disclosure already, say so — the September round found several
findings that were already fixed, and re-reporting them wastes the next round.

- [ ] **Step 5: Flip status and hand off**

Set `**Status:** Complete — awaiting user decisions on the demote/cut table` in the
doc header.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/audits/2026-09-05-ui-inventory-baseline.md
git commit -m "docs: baseline numbers and the draft demote/cut table"
```

- [ ] **Step 7: Present the table to the user**

Phase 5 cannot be planned until the user rules on it. Present the ranked table and the
five baseline numbers in chat, note anything refuted, and stop. **Do not begin Phase 2
without checking** — Phase 2 is independently shippable and does not depend on these
decisions, but starting it is the user's call.

---

## Self-Review

**Spec coverage.** Phase 1 requires: true surface list (Task 4), three numbers per
journey (Tasks 2/3 Step 4, tabulated in Task 5 Step 1), draft demote table (Task 5),
committed audit doc (every task commits), two device journeys (Tasks 2 and 3). The
spec's note that membership "cannot be derived from code alone" is honoured by Task 4
Step 2's third bucket, which exists specifically to catch non-overlay surfaces like the
August tap-through early `return`. Covered.

**Placeholder scan.** Every snippet is executable as written. The bracketed slots in
Task 1 Step 5 are the audit doc's own blank sections, filled by later tasks — they are
the deliverable's structure, not unwritten plan steps.

**Type consistency.** The stub object in Task 2 Step 2 matches `LRCLIBResult`
(`src/sources/lrclib.ts:88`: `id`, `name`, `artistName`, `albumName?`, `duration?`,
`syncedLyrics`, `plainLyrics`). `reach` / `devices` / `role` are used identically in
Task 4 Step 3 and Task 5 Step 3, and match the spec. The measurement snippet is
identical in Tasks 2 and 3 by reference rather than being retyped divergently.

**Known limitation, stated rather than hidden.** Journey A needs real network for the
YouTube embed, so it is not hermetic. This is a deliberate trade: faking the embed
would measure an interface the user never sees. Task 2 Step 5 records the caveat in the
audit itself.
