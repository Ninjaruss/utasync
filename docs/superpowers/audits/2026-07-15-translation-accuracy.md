# Round 10 — Translation popover accuracy (tap-to-look-up)

Date: 2026-07-15
Branch: `translation-accuracy` (off `main`, rounds 5–9 merged)
Commits: `3442817` (T1), `915a2cd` (T1 review nit), `c3121e1` (T2)

## Context

The broad accuracy audit (rounds 5–9) had driven line/word **alignment** to a good
place — boundary metrics, gap re-transcription, and stored-song recovery all shipped.
With alignment settled, the remaining user-visible accuracy gaps were in the two
translation surfaces: **furigana display** and **word translation**.

Auditing the tap-to-look-up dictionary popover (default-on, mobile Yomitan
alternative — see `tap-word-lookup.md`) surfaced two defect classes:

1. **Wrong definitions** (~16% of sampled kanji surfaces) — the popover showed a
   confidently-wrong gloss borrowed from a homophone.
2. **Blank definitions** — common inflected and subsidiary verbs showed no gloss at
   all, with no safety net.

Round 10 fixed both. The load-bearing guardrail throughout: **the popover must not
move the word-pairer corpus baseline** — the pairer and the popover share the gloss
data and helpers, so any fix had to be popover-scoped.

## T1 — Wrong definitions: homophone-collapse (commit `3442817`)

### Root cause

The popover resolved a gloss by going **kanji surface → romaji key → gloss**. There
was no direct kanji→gloss map. Distinct kanji that romanize to the same key collapse
onto whichever single definition the romaji key holds:

- 億 ("hundred million") and 置く ("put") both key on `oku` → 億 rendered as **"put"**.
- 状態 ("state/condition") collided on its romaji key and rendered as **"upper"**.

This is inherent to a romaji-keyed lookup: the key is lossy across homophones.

### Fix

Added a **sparse surface→gloss map** (`kanjiGloss`) to `public/jmdict-gloss.json`,
built by `scripts/build-jmdict-gloss.mjs`. It stores an entry **only** for surfaces
whose own definition differs from the romaji-collapsed fallback (i.e. only collided
surfaces) — 27,761 entries, +543KB (`10,699,933` → `11,242,909` bytes).

The popover reads it via `getJmdictKanjiGloss(surface)` in `jmdictGloss.ts`, inserted
into `lexicalGloss` in `wordLookup.ts` as step 2 of the chain (curated overlay →
surface-specific kanji gloss → romaji lemma chain). Undefined for surfaces whose
romaji fallback is already correct, so the map stays sparse.

### Fixed examples

億 → hundred · 状態 → state · 情報 → information · 機嫌 → mood · 春 → spring · 傘 → umbrella

## T2 — Blank definitions: inflected + subsidiary verbs (commit `c3121e1`)

### Root causes

1. **Inflected reading romanized instead of the base form.** kuromoji hands the
   popover an inflected surface reading (わから), which misses the JMdict key; the
   base reading (わかる → `wakaru` → "understand") resolves. The kana branch was
   romanizing the surface reading, not the dictionary base form.
2. **Kanji subsidiary verbs suppressed with no fallback.** 行く in `〜て行く` is tagged
   `動詞/非自立`. The kana-keyed grammar map only lists the kana spelling (いく), so
   grammar suppression fires — but the lexical chain is then blocked, leaving the
   popover blank.

### Fix

1. On the kana branch, romanize the **base form** when kuromoji supplies a kana one
   (`kanaHead = token.baseForm && KANA_ONLY.test(token.baseForm) ? token.baseForm : kana`).
   Katakana loanwords keep the reading path — they carry no distinct base form
   (スーパー is **preserved**, long-vowel-mark handling intact).
2. `subsidiaryVerbLexicalGloss` recovers **kanji** subsidiary verbs through the
   surface-gated lexical gloss (行く → "go"). Deliberately scoped to kanji verbs:
   **kana** subsidiary verbs still resolve via the grammar map and keep their grammar
   gloss; routing every `非自立` token to the lexical chain would re-open the kana
   homophone collisions the grammar suppression exists to prevent.

### Recovered examples

行く → go · わから → understand · なくし · いっ · ぶちまけ

## The popover-scoped guarantee (safety guardrail)

Both fixes touch **only** `wordLookup.ts` and the data map/loader T1 added
(`jmdictGloss.ts` getter, `build-jmdict-gloss.mjs`, `public/jmdict-gloss.json`).
**Neither touches the word-pairer path.** Therefore the corpus pairing baseline is
**byte-identical** — verified below. This is the guardrail for both fixes: a
translation-quality change that moved the pairer would be a regression, not a fix.

## Verification

- `npx vitest run --exclude "**/.claude/**"` → **1350 passed, 2 skipped** (186 files
  passed, 1 skipped). Green on first run; no flakes triggered.
- `npx tsc -b` → clean (exit 0).
- `npx tsx scripts/audit-corpus.mjs --pairing --check-baseline` → **exit 0, "No
  regressions vs baseline"** (pairing byte-identical — the guardrail).
- `npx tsx scripts/audit-vs-lrc.mjs` → **byte-identical** to prior:
  guitar 0.40/1.62, 0.73/1.93 · stranger 0.64/36.10, 1.44/33.79 · mixed 0.56/2.82,
  0.56/6.48 · medium 0.70/9.34.

## Honest residuals / follow-ups

- **(a) Single-word gloss reductions.** 億 shows "hundred", not "hundred million" —
  `pickGlossWord` reduces glosses to a single word, pre-existing behavior shared with
  the pairer. A popover-only follow-up could show the fuller first-sense gloss without
  touching the pairer.
- **(b) いっ → "do".** An `iu` homophone artifact in `ROMAJI_GLOSS`. Editing that entry
  would move the pairing baseline, so it is left alone.
- **(c) Deferred blanket `非自立` fall-through.** Routing all subsidiary tokens (not
  just kanji) to the lexical chain re-opens kana homophone suppression; deliberately
  not done.

## Still open across the broader audit (context, not this round)

From the same accuracy backlog, not yet built:

- Particle romaji `wa`/`e`/`o` in furigana (は/へ/を read as particles).
- Inline-furigana paste stripping (coverage).
- Pairing-truth denylist reframe.

## Browser spot-check (open — needs an interactive session)

Tap 億 / 状態 / 行く in a song and confirm the popover shows correct, non-blank
definitions. Not runnable in this non-interactive session; left unchecked in the PR
test plan.
