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

(Not yet traced — reserved for Task 2.)

## Journey B — desktop, Full tier

(Not yet traced — reserved for Task 3.)

## Consolidated surface list

(Reserved for a later task in this phase.)

## Baseline numbers

(Reserved for a later task in this phase.)

## Draft demote/cut table

(Reserved for a later task in this phase.)

## Defects observed

None observed during this harness-verification step (Task 1 only exercised the tier
gate itself via `capability.ts`; no app UI was driven beyond page load).
