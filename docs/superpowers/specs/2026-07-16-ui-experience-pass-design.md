# UI Experience & Design Pass — Design

**Date:** 2026-07-16
**Goal:** A whole-journey audit-and-fix pass that brings the app to a
public-launch bar: a stranger on a phone can discover, understand, and succeed
at every step without help, and every screen reads as deliberate, cohesive
design.

**Decisions (user-confirmed):**
- Scope: whole journey, breadth-first — deepest issues win over local polish.
- Device priority: mobile-first; desktop must work well but loses conflicts.
- Change tolerance: mostly polish, but flow restructures are in scope where
  the audit shows a flow is fundamentally awkward.
- Bar: public-launch strangers (persuasive landing, self-explanatory flows,
  guiding empty/error states).

## Journey map (audit units)

| # | Stage | Primary code |
|---|---|---|
| 0 | Landing (public) | src/landing/LandingScreen.tsx (first-visit route, Get-started CTA) |
| 1 | Library & first-open | src/sources/LibraryScreen.tsx, src/App.tsx (view routing), sync badges, empty state |
| 2 | Add song | src/sources/AddSongSheet.tsx, UploadAudioFlow.tsx, LinkParser.tsx, lrclib.ts; LyricsImportPanel |
| 3 | Auto-align wait | src/ai-pipeline/AutoAlignFlow.tsx (stages, progress, toggles, failures) |
| 4 | Play mode | src/player/PlayerView.tsx, LyricDisplay, WordLookupPopover, PlayerControls, banners |
| 5 | Edit mode | src/lyrics/EditMode.tsx (rows, timestamps, hint system, re-align/recover) |
| 6 | Translation attach | SecondLanguagePanel, bilingual display |
| 7 | Practice (cloze) | src/cloze/ClozeOverlay.tsx, ClozeEngine.ts |
| 8 | Settings | src/settings/SettingsView.tsx, SettingsSheet.tsx |
| 9 | Cross-cutting | mode navigation, toasts/dialogs, loading/empty/error states, PWA (install/offline), design-token cohesion |

## Lenses and finding format

Every finding is tagged:
- **Lens:** `stranger` (comprehension at zero context: naming, affordances,
  next-step clarity, empty states, persuasion) · `craft` (spacing rhythm, type
  hierarchy, touch targets ≥44px, contrast, truncation/wrapping, motion,
  interaction states — the make-interfaces-feel-better checklist) · `trust`
  (feedback during waits — especially the multi-minute align — honest label
  presentation, error recovery, undo affordances).
- **Severity:** `P0` blocker (a stranger stalls or the app looks broken) ·
  `P1` major (friction/ugliness a stranger notices) · `P2` polish.
- **Effort:** S / M / L.
- **Fix sketch:** one or two sentences; restructures get companion mockups.

A cohesion inventory lists the de-facto tokens in use (font sizes, spacing
steps, radii, colors, shadows, motion durations) and flags drift; it feeds
`craft` findings rather than a separate track.

All findings are judged at phone width (~375px) first, desktop second.

## Execution

1. **Audit fan-out (Workflow):** one agent per journey stage (0–8) + one cohesion
   agent + one copy/tone agent (stage 9's cross-cutting states are folded into
   each stage agent's checklist plus the cohesion agent), each reading the real components and
   returning structured findings. Agents read code only — no app changes.
2. **Synthesis:** dedupe, score, and assemble the prioritized inventory with a
   proposed cut-line for this pass. Delivered as a companion page; flow
   restructures get side-by-side current-vs-proposed mockups (anticipated
   candidates: align-options presentation, Edit-mode hint stack, landing).
3. **Approval gate:** user approves/adjusts the cut-line and restructure
   mockups before any implementation.
4. **Implementation waves:** wave 1 = P0 plus effort-S P1 items; wave 2 = approved
   restructures and remaining P1. Component tests updated alongside; the full suite (1,428
   tests) stays green; alignment/AI logic is untouched (UI-only pass).
5. **Verification:** since local browser automation cannot reach the dev
   server, each wave ships with before/after companion mockups; the user
   spot-checks the running app (dev server on :5173) on phone width. The
   existing component tests are the regression net.

## Constraints & context

- The working tree carries the uncommitted round-11 alignment work (branch
  `line-accuracy-round11`); this pass stacks on top. Commits for both are
  pending 1Password unlock for SSH signing.
- Dark, cinnabar-tinted Tailwind theme is the established identity — cohesion
  pass tightens it rather than replacing it.
- Recent UI history to respect (don't churn what just shipped): add-song
  lyrics area enlargement, compacted settings rows, mode-switch auto-scroll,
  Edit-mode alignment hints (round 11 extended these).

## Out of scope

- Alignment/transcription behavior changes (round 11 is complete and verified).
- New product features (new practice modes, social, accounts).
- Rebranding / theme replacement.

## Success criteria

- Every P0 and approved P1 finding fixed; cut-line agreed with user.
- A stranger-walkthrough re-audit of the changed screens finds no remaining P0.
- Full test suite green; no alignment-logic diffs.
- User confirms the app feels cohesive and self-explanatory on their phone.
