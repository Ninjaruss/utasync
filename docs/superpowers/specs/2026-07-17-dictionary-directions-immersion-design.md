# Dictionary Lookup — Active-Line Gate, Bidirectional, Immersion Mode — Design

**Date:** 2026-07-17
**Goal:** Fix the tap-to-look-up popover so it only fires on the active lyric
line, add an English→Japanese direction so a Japanese user can look up English
translation words, and add an optional **immersion mode** that shows
definitions in the word's own language (Japanese words → Japanese definitions,
English words → English definitions) so advanced learners can stay inside their
target language.

**Decisions (user-confirmed):**
- **Request 1 — active line only:** tapping a word on a non-active line must
  *not* open the dictionary; it seeks to that line like a normal row click.
- **English direction — always on:** both directions are live at once (no
  direction setting). Tap a Japanese word → English; tap an English translation
  word → Japanese. Governed by the existing `tapLookupEnabled` toggle.
- **English→Japanese source:** reverse index built from the JMdict source
  already in the repo.
- **Immersion mode — one global toggle** (`immersionDefinitions`, default off).
  When on, definitions are monolingual (JA→JA, EN→EN).
- **Immersion data — bundled offline:** Japanese WordNet for JA→JA, Princeton
  WordNet for EN→EN, consistent with the app's offline-first design (it already
  bundles JMdict + the kuromoji dictionary). No live API.

## Behavior matrix

One setting `immersionDefinitions` (default **off**), gated by the existing
`tapLookupEnabled` (default on). Lookup only fires on the **active** line.

| Tap target | Immersion OFF | Immersion ON |
|---|---|---|
| **Japanese word** (primary line) | English gloss *(unchanged from today)* | Japanese definition (Japanese WordNet) |
| **English word** (translation line) | Japanese equivalents (reverse JMdict) | English definition (Princeton WordNet) |

"Active line only" and `tapLookupEnabled` govern **both** tap directions.

## Data sources (facts + licensing)

| Source | Use | License | Notes |
|---|---|---|---|
| JMdict (`.cache/jmdict/jmdict-eng-3.6.2.json`, already present) | EN→JA equivalents (reverse) | JMdict/EDRDG (already used in-repo) | 217k words; `common` flags for ranking |
| Princeton WordNet 3.1 (via `wordnet-db` npm data files) | EN→EN definitions | WordNet License (OSI, redistribute-with-license) | synset gloss = definition (+ examples after `;`) |
| Japanese WordNet 1.1 (`wnjpn-ok.tab` + `wnjpn-def.tab`) | JA→JA definitions | BSD-like (JA data) + Princeton (EN data) | 135,692 defs / ~57k synsets → broad coverage |

**Honesty about the Japanese definitions:** wn-ja's Japanese definitions are
*translations of the English WordNet glosses*, not native 国語辞典 prose, with a
stated ~5% error rate, and a word only resolves if it is in wn-ja's ~92k-lemma
inventory. This reads as competent Japanese but not dictionary register; song
slang / proper nouns may miss. Both are acceptable given the graceful fallback
below. License files for WordNet and Japanese WordNet are committed under
`public/licenses/` with attribution (required by both licenses).

## Architecture

### 1. Build scripts → committed, lazy-loaded JSON

- `scripts/build-enja-dict.mjs` → `public/enja-dict.json`. Mirrors
  `build-jmdict-gloss.mjs` (same source handling, deterministic/sorted output).
  For each JMdict word pick a representative headword (first common kanji →
  first kanji → common kana → kana) and reading (first common kana). For each
  **single-word** English gloss (strip leading `to `/article/parenthetical),
  add `en → [{w: headword, r: reading}]`. Multi-word glosses are skipped (the
  external link covers them). Rank by `common`, dedupe by headword, cap ~6.
- `scripts/build-wordnet-defs.mjs` → emits two files:
  - `public/en-def.json` — parse Princeton `data.{noun,verb,adj,adv}` (from
    `node_modules/wordnet-db/dict/`): `word → [definition]` (gloss up to the
    first `;` example). Cap ~2–3 senses per word, truncate long defs.
  - `public/wnja-def.json` — join `wnjpn-ok.tab` (synset ⇄ high-confidence JA
    lemma) with `wnjpn-def.tab` (synset ⇄ JA definition): `lemma → [definition]`.
    Cap ~2–3, truncate.

All three JSONs load lazily and independently at runtime; the two immersion
files are fetched only when immersion is on **and** a matching word is tapped.
Each build script is deterministic and reproducible; the built JSON is committed
(matching the existing `jmdict-gloss.json` pattern). Final sizes are measured
during implementation and capped to keep each to a few MB.

### 2. Runtime resolvers

- `src/language/english/enjaDict.ts`, `src/language/english/enDict.ts` — lazy
  loaders/accessors, mirroring `jmdictGloss.ts` (fetch once, cache, expose a
  `loaded()` guard so the popover can say "unavailable" vs "not found" offline).
- `src/language/english/wordLookupEn.ts` — `lookupEnglishWord(word, {immersion})`:
  normalize (lowercase, strip surrounding punctuation), exact match, else
  best-effort suffix stemming (`'s`, `-s/-es`, `-ed`, `-ing`, `-ly` with basic
  `e`/doubling restoration). Returns `{ headword, definitionLang: 'ja'|'en',
  entries }` where `entries` is JA equivalents (immersion off) or EN definitions
  (immersion on). `null` for tokens with no alphabetic characters.
- `src/language/japanese/jaMonolingual.ts` — lazy loader + `lookupJaDefinition(lemma)`
  over `wnja-def.json` (tries `token.baseForm` then `surface`).
- `src/language/japanese/wordLookup.ts` — `lookupWord(token, readingMode, {immersion})`.
  Immersion on → JA definition via `jaMonolingual`; miss → reading + POS only,
  no gloss (fallback surfaced in UI as "定義なし" + 国語辞書 link). Immersion off →
  today's EN gloss chain, **unchanged**. Add `definitionLang: 'ja'|'en'` to
  `WordLookupResult` so the popover sets `lang` and picks the external link.

### 3. UI

- `src/lyrics/LookupPopoverShell.tsx` (new) — owns positioning (anchored vs
  narrow bottom-card), the capture-phase outside-tap dismissal + click-swallow
  (moved verbatim from `WordLookupPopover`), the close button, and a
  configurable external link. Renders `children` as the body.
- `src/lyrics/WordLookupPopover.tsx` — **props unchanged** (`token`,
  `anchorRect`, `onClose`); now renders the JA body inside the shell. External
  link: jisho.org (translation) or weblio 国語辞書 (immersion).
- `src/lyrics/EnglishWordLookupPopover.tsx` (new) — props (`word`, `anchorRect`,
  `onClose`); English headword + JA equivalents (off) or EN definitions (on).
  External link: jisho.org.
- `src/lyrics/LyricDisplay.tsx` — pass `onWordTap` **only to the active Line**;
  `ColoredTranslation` spans gain an optional `onWordTap` (active line only);
  one unified tap state `{kind:'ja',token,rect} | {kind:'en',word,rect}` renders
  the matching popover. Both popovers read `immersionDefinitions` from settings.
- `src/settings/SettingsView.tsx` — new toggle row: **"Immersion (monolingual)
  definitions"** — "Japanese words get Japanese definitions, English words get
  English. For advanced learners." (No effect while tap-lookup is off.) Update
  the existing tap-lookup description to mention both languages.
- `src/payment/SettingsStore.ts` + `src/core/types` — add
  `immersionDefinitions: boolean` (default false) + setter, persisted.

## Fallback behavior (no silent wrong answers)

- **JA immersion, no wn-ja def:** show headword + reading + POS + "定義なし" and a
  weblio 国語辞書 link. Do **not** fall back to the English gloss (that breaks
  immersion).
- **EN immersion, no WordNet def:** "No definition found" + jisho link.
- **EN→JA (off), no reverse entry:** "No definition found" + jisho link.
- **Any JSON failed to load (offline):** "Definitions unavailable" (distinct
  from "not found"), external link still shown.

## Testing (TDD)

- `wordLookupEn.test.ts` — normalization/stemming, exact + stemmed hits, null
  for punctuation, immersion vs non-immersion branch, `loaded()`-false path.
- `jaMonolingual.test.ts` — lemma → def, baseForm-before-surface, miss path.
- `wordLookup.test.ts` — add immersion branch: JA def when present, reading-only
  fallback when absent; **non-immersion output byte-identical to today**.
- `EnglishWordLookupPopover.test.tsx` + shell — headword + entries, loading,
  not-found, dismiss/click-swallow (moved into the shell's tests).
- `LyricDisplay.test.tsx` — (a) non-active-line JA tap does not open popover /
  seeks; (b) active-line JA tap opens JA popover; (c) active-line EN translation
  tap opens EN popover; (d) non-active-line EN tap does nothing; (e) immersion
  toggle flips the definition language.
- Build scripts: a small fixture-driven test asserting shape + determinism.

## Safety / invariants

- All new files and a new code path; the word **pairer**
  (`lyricGloss.ts`/`wordAligner.ts`) and the existing JA→EN gloss chain are
  untouched → **corpus pairing baseline stays byte-identical** (the round-10
  guardrail; re-verify with `scripts/audit-corpus.mjs`).
- `WordLookupPopover` public props unchanged → existing popover/lookup tests
  stay green.
- New WordNet/JMdict data ships only under new keys/files; no existing JSON
  changes byte layout.

## Suggested implementation phasing

Ships value early and isolates the heavier data work:

- **Phase 1 — gate + reverse dictionary:** active-line gate (Request 1),
  `build-enja-dict.mjs` + `enja-dict.json`, English resolver/loader, the shell
  refactor + `EnglishWordLookupPopover`, unified tap state. Delivers Requests 1
  and 2 end-to-end.
- **Phase 2 — immersion:** `immersionDefinitions` setting, `build-wordnet-defs.mjs`
  (+ `en-def.json`, `wnja-def.json`), `jaMonolingual.ts`, `enDict.ts`, immersion
  branch in both resolvers/popovers, settings toggle, license files.

## Deferred / out of scope

- Real 国語辞典-register Japanese definitions (wn-ja is translated-from-English).
- Full English lemmatizer (irregular inflections rely on the external link).
- Multi-word English glosses in the reverse dictionary.
- Making token-less translation lines tappable (rare; both taps already require
  tokens for per-word spans).
- Per-language / per-direction immersion (single global toggle only).
