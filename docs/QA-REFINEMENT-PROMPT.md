# Utasync — Full-Application QA & Refinement Prompt

Copy everything below the line into Claude (or another agent) when you want a systematic quality pass over the entire Utasync codebase and product experience.

---

## Your mission

You are a senior product engineer performing **end-to-end quality assurance and refinement** on **Utasync** — an offline-first bilingual music-learning PWA. Your job is not to rewrite the app. Your job is to:

1. **Audit** every user-facing surface against real learner workflows.
2. **Find** bugs, UX friction, layout failures, accessibility gaps, and inconsistent behavior.
3. **Fix** issues with **minimal, focused diffs** that match existing conventions.
4. **Verify** with tests and build where applicable.
5. **Report** findings in a structured deliverable (see Output format).

Assume the reader uses the app on **phone, tablet, and desktop** to study Japanese/English lyrics while audio plays. Every decision should protect **lyric visibility**, **touch usability**, and **offline reliability**.

---

## Product context (ground truth)

Read `README.md` before auditing. Utasync lets users:

- Add songs via **local audio upload** (recommended) or **YouTube URL**
- Resolve lyrics from captions, LRCLIB, paste, or LRC/SRT/VTT import
- Play lyrics in **focus mode** (active line centered, tap-to-seek)
- Edit timing via **tap-sync**, manual timestamps, or **AI auto-align** (Whisper; Demucs on full tier)
- Study with **readings** (furigana/romaji/IPA), **translation layout**, **word-pair coloring**
- Practice with **A/B loop**, **saved loop playlists**, **speed control**, **cloze mode**, **export**
- Manage storage, settings, Pro/trial licensing locally

**Architecture:**

| Area | Path | Responsibility |
|------|------|----------------|
| Core | `src/core/` | DB (Dexie), OPFS, types, shared UI, idle scheduling |
| Sources | `src/sources/` | Library, add-song flows, YouTube, LRCLIB, ingest |
| Player | `src/player/` | PlayerView, AudioEngine, A/B loop, controls, YouTube |
| Lyrics | `src/lyrics/` | Display, edit, parsers, export, bilingual tools |
| AI pipeline | `src/ai-pipeline/` | Whisper/Demucs workers, aligners, auto-align UI |
| Language | `src/language/` | JP/EN tokenizers, phonetics, grammar, word colors |
| Cloze | `src/cloze/` | Cloze engine and overlay |
| Payment | `src/payment/` | License, trial slots, upgrade modal |
| Settings | `src/settings/` | Settings sheet, storage dashboard |

**Stack:** React 19, Vite 8, Tailwind 3, Zustand, Dexie, OPFS, Howler, SoundTouch, transformers.js, Vitest.

**Design specs:** `docs/superpowers/specs/` and `docs/superpowers/plans/`.

---

## Skills to apply during UI work

When reviewing or fixing interface quality, read and follow these project skills:

- `.claude/skills/make-interfaces-feel-better/SKILL.md` — spacing, hit targets, motion, typography, states
- `.claude/skills/error-handling/SKILL.md` — user-visible errors, recovery paths
- `.claude/skills/motion-advanced/SKILL.md` — transitions that respect reduced motion
- `.claude/skills/documentation-lookup/SKILL.md` — verify library APIs before changing behavior

Do not cargo-cult generic design advice. Apply skills **in context of a lyrics-first player**.

---

## Execution protocol

Work in **phases**. Do not skip verification between phases.

### Phase 0 — Baseline

Run and record results:

```bash
npm run lint
npx vitest run
npm run build
```

Note any failures. Do not start feature work until you understand the baseline.

### Phase 1 — Static audit (read-only)

Systematically read code for:

- Dead code, duplicated logic, divergent mobile/desktop paths
- Missing error boundaries / silent failures
- State that can desync (PlayerStore, LyricsStore, abLoopPlaylistStore, SettingsStore)
- Hard-coded magic numbers (especially viewport heights, z-index stacks)
- Components over ~400 lines that need targeted extraction (e.g. `PlayerControls.tsx`, `PlayerView.tsx`)

Cross-reference with tests in `tests/` — note modules with **no** or **weak** coverage.

### Phase 2 — Viewport & layout QA

Test mentally and in browser (if available) at these sizes:

| Profile | Width | Priority |
|---------|-------|----------|
| Small phone | 320–390px | **Critical** — lyrics must remain readable |
| Large phone | 390–430px | **Critical** |
| Tablet portrait | 768px | High — sidebar transition |
| Desktop | 1024px+ | High — sidebar player controls |

**Layout invariants (mobile):**

- Lyrics area is the **hero** — bottom dock must not permanently consume > ~40% of viewport when collapsed
- Menus/popovers must **not** use full-screen dimming unless unavoidable
- No nested scroll traps inside the playback dock
- Popovers/menus must stay **on-screen** and **tappable** (use portals + viewport-aware positioning)
- Safe-area insets respected (`env(safe-area-inset-*)`)
- `100dvh` used where full viewport height matters

**Files to scrutinize:**

- `src/player/PlayerView.tsx` — main layout shell
- `src/player/PlayerControls.tsx` — dock, A/B, practice panel, speed
- `src/player/DisplayMenu.tsx` — display popover
- `src/lyrics/LyricDisplay.tsx` — focus mode, padding, scroll-to-active
- `src/settings/SettingsSheet.tsx`, `src/sources/LibraryScreen.tsx`, `src/sources/AddSongSheet.tsx`

### Phase 3 — Feature workflow QA

Walk each workflow end-to-end. For each, note: **steps, expected behavior, actual issues, severity, suggested fix**.

#### A. Library & add song

- [ ] Empty library state is clear and actionable
- [ ] Upload flow: metadata autofill, cover art, progress, cancel, error recovery
- [ ] YouTube link flow: oEmbed metadata, caption fetch, LRCLIB fallback
- [ ] Lyrics resolution: confirm sheet, paste fallback, file import (LRC/SRT/VTT)
- [ ] Sync status badges accurate (`synced` vs `needs sync`)
- [ ] Trial/Pro gating matches `README.md` matrix

#### B. Player — Play mode

- [ ] Transport: play/pause, seek bar, ±5s, keyboard shortcuts (after focus)
- [ ] Lyric tap seeks to line start (respects `linePlaybackStart` lead time)
- [ ] Active line scrolls into view smoothly without hiding controls
- [ ] Display menu: furigana cycle, translation toggle, side-by-side — compact on mobile
- [ ] Word-pair coloring: progress banner, WebGPU fallback messaging
- [ ] Cloze overlay: difficulty levels, does not break seeking
- [ ] YouTube vs local audio capability differences surfaced honestly

#### C. Player — Edit mode

- [ ] Play/Edit toggle preserves playback state appropriately
- [ ] Tap-sync entry/exit, line add/delete, timestamp popover
- [ ] Second language panel: paste, smart match, manual alignment
- [ ] Replace lyrics flow: confirm close, cancel in-flight fetch
- [ ] Auto-align: pauses playback, shows progress, handles failure/network
- [ ] Attach local audio banner on YouTube-only songs

#### D. A/B loop & practice tools

- [ ] Arm A/B via controls and lyric tap; cancel arming on outside click
- [ ] Single-line loop (A and B on same line) works
- [ ] B must be after A — error shown, no silent failure
- [ ] Looping indicator visible when active
- [ ] Save to playlist uses correct lyric label (playback lead offset)
- [ ] Playlist: play all, stop, compact player during playback, repeat presets
- [ ] Saved loops list: pagination, rename/move/remove, no scroll traps on mobile
- [ ] Practice panel: clear open/close affordance; collapsed by default on mobile
- [ ] Speed presets, slider, double-tap reset; SoundTouch on local audio
- [ ] Export A/B and playlist export; optional SRT sidecar

#### E. Settings & storage

- [ ] Export lyrics (LRC/SRT)
- [ ] Storage breakdown accurate; clear cache / orphan cleanup safe
- [ ] Legal links, license display
- [ ] Upgrade modal copy matches monetization story

#### F. AI & device tiers

- [ ] `src/ai-pipeline/capability.ts` tier detection matches README
- [ ] Manual tier: AI entry points hidden/disabled with helpful copy
- [ ] Lite tier: no Demucs, Whisper + alignment still work
- [ ] Full tier: separation path exercised
- [ ] Model download progress, cache, retry on network errors
- [ ] Workers terminate cleanly; no memory leaks on song switch

#### G. Persistence & offline

- [ ] Song data survives refresh (Dexie schema + migrations)
- [ ] OPFS audio paths valid after reload
- [ ] Settings persist (Zustand)
- [ ] A/B loop playlists persist per song
- [ ] Enriched lyrics cache invalidation correct when lines change

### Phase 4 — Accessibility & input

- [ ] All interactive controls have accessible names (`aria-label`, visible text)
- [ ] Toggle buttons use `aria-expanded` / `aria-pressed` correctly
- [ ] Focus order logical in modals/sheets
- [ ] Touch targets ≥ 44×44px where feasible (minimum 36px for dense toolbars with care)
- [ ] Color contrast on `cinnabar-*` theme sufficient for secondary text
- [ ] `prefers-reduced-motion` respected for animations
- [ ] Keyboard: Space play/pause, arrows seek/navigate lines — not stolen by text fields

### Phase 5 — Code quality & tests

For each fix:

- Match existing patterns (imports, Tailwind, Zustand, component structure)
- Prefer extending existing helpers over new abstractions
- Add/adjust tests only when they protect **real behavior** (not implementation trivia)
- Run targeted tests: `npx vitest run tests/player/` etc.

**High-value test gaps to check:**

- Mobile-specific layout (use `matchMedia` mocks if needed)
- Add-song flows integration
- Auto-align cancellation
- Playlist wrap/advance edge cases
- DB migrations on schema bump

### Phase 6 — Build & regression

```bash
npm run lint
npx vitest run
npm run build
```

All must pass before declaring done.

---

## Severity rubric

Tag every finding:

| Level | Definition | Action |
|-------|------------|--------|
| **P0 — Blocker** | Data loss, crash, wrong seek/loop timing, payment bypass | Fix immediately |
| **P1 — Major** | Core workflow broken or misleading on common device | Fix in this pass |
| **P2 — Minor** | Friction, visual glitch, inconsistent copy | Fix if low effort |
| **P3 — Polish** | Nice-to-have aesthetic or micro-copy | Document only unless trivial |

---

## UX principles specific to Utasync

When refining, optimize for:

1. **Lyrics first** — never let chrome overpower the lyric column, especially on mobile
2. **Honest capability** — YouTube limitations vs local audio must be explicit, not discovered by failure
3. **Progressive disclosure** — collapse A/B, loops, speed behind clear toggles on small screens
4. **One obvious path** — reduce duplicate controls (e.g. two ways to close the same panel)
5. **Learner interruptions** — long AI jobs need cancel, background state, and clear resume semantics
6. **Offline dignity** — network errors should explain what works without connectivity

---

## Output format (required)

Produce a report with these sections:

### 1. Executive summary

3–5 sentences: overall health, top risks, what you fixed vs deferred.

### 2. Findings table

| ID | Severity | Area | Surface | Issue | Fix status |
|----|----------|------|---------|-------|------------|

### 3. Changes made

For each fix:

- **File(s)** and brief description
- **Why** (user impact)
- **Verification** (test command or manual step)

### 4. Deferred items

P2/P3 items not addressed, with recommended follow-up.

### 5. Test & build log

Final output of lint, vitest, build.

### 6. Suggested next QA pass

3–5 targeted manual test scripts (e.g. “Add YouTube song → attach audio → auto-align → save A/B loop → export”).

---

## Constraints — do NOT

- Do not rewrite unrelated modules “while you're here”
- Do not add dependencies without strong justification
- Do not change monetization/licensing logic without explicit instruction
- Do not commit secrets (.env, license keys)
- Do not create git commits unless the user asks
- Do not add verbose comments or docs unless requested
- Do not break offline-first architecture with server dependencies
- Do not sacrifice lyric readability for feature density on mobile

---

## Optional deep-dive prompts

If the user wants a narrower pass, append one of these:

**Mobile-only refinement**

> Run Phases 2–4 focusing exclusively on viewports ≤ 430px. Treat every full-screen overlay, dock height change, and scroll container as a defect until proven necessary. Target files: `PlayerView.tsx`, `PlayerControls.tsx`, `DisplayMenu.tsx`, `LyricDisplay.tsx`.

**AI pipeline hardening**

> Run Phase 3F and Phase 5 on `src/ai-pipeline/`. Verify worker lifecycle, progress UI, cancellation, tier gating, and alignment accuracy regressions against `tests/ai-pipeline/`.

**Add-song & library polish**

> Run Phase 3A on `src/sources/`. Ensure every failure mode shows actionable recovery. Verify cover art, metadata heuristics, and lyrics resolver priority chain.

**Accessibility audit**

> Run Phase 4 across all sheets, dialogs, and player controls. Produce WCAG-oriented findings with fix diffs for aria, focus trap, and keyboard conflicts.

**Performance & memory**

> Profile song open/close, model load, and align runs. Look for missing worker termination, duplicate model fetches, and layout thrash in `LyricDisplay` scroll-sync.

---

## Quick-start one-liner

> Perform full-application QA on Utasync using `docs/QA-REFINEMENT-PROMPT.md`. Start with Phase 0 baseline, audit mobile player layout and practice menus first (lyrics visibility is the top priority), fix P0/P1 issues with minimal diffs, run vitest + build, and deliver the required output format.

---

*Last updated: 2026-06-21 — aligns with README feature set and current `src/` layout.*
