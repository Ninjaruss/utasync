# Utasync Logo — Design Spec

**Date:** 2026-08-01
**Status:** Approved direction (brainstormed via visual companion; user selected concept B → minimal M4 "echo" → refinement E1)

## The mark

The kanji **歌** with a single "echo" ghost copy behind it:

- **Main glyph:** 歌, bold weight (Noto Sans JP Bold), rendered as **fixed SVG paths** (not `<text>`), filled cinnabar `#f87171`.
- **Echo glyph:** identical path, offset **up-right** (approx. +11px x, −8px y at a 150px tile scale — i.e. offset ≈ 7% of tile size), same fill at **25% opacity**, drawn *behind* the main glyph.
- **Tile:** rounded square, background `#180606` (cinnabar-900), corner radius ≈ 22% of tile width.
- **Small sizes:** at 16px the echo is dropped — solid kanji only. The favicon SVG keeps the echo (tabs render at 16–32px where it reads as subtle depth); raster icons at 16px, if ever produced, use the solid variant.

Meaning: a sung note and its echo — the lyric and its timing layered into one mark. No waveforms, rings, ruby, or other decorations (explicitly rejected during brainstorming as tacked-on/busy).

## Rationale / constraints

- **Kanji as logo is safe:** single standard characters are not copyrightable and carry no exclusivity; distinctiveness comes from the styling (echo + palette + tile).
- **Font licensing:** glyph outlines must come from **Noto Sans JP (SIL OFL)** — OFL permits logo/outline use freely. Do **not** trace Apple's bundled Hiragino Sans (license murkier).
- **Rendering portability:** current `public/icon.svg` uses SVG `<text>`, which depends on viewer-installed fonts (tofu risk, cross-platform drift). All new assets use baked path data.

## Deliverables

1. **`public/favicon.svg`** — replaces the off-brand purple placeholder. Echo mark on the dark rounded tile, paths only.
2. **`public/icon.svg`** — replaced with the same path-based echo mark (keeps tile background).
3. **Raster icons** — Apple touch icon (180×180) and PWA icons (192×192, 512×512) **only if** a web manifest / `apple-touch-icon` link exists or is warranted; verify during planning. Committed as files.
4. **Landing header lockup** — small echo mark placed beside the existing `歌sync` text wordmark in `src/landing/LandingScreen.tsx`. The wordmark text/styling itself is unchanged.
5. **Social share card** — `og:image` 1200×630 PNG: echo mark + 歌sync + one-line tagline on `#0d0404`/`#180606` background; `og:*`/`twitter:*` meta tags added to `index.html`.

## Build approach

- One-off Node script (`scripts/` directory, using `opentype.js`) loads Noto Sans JP Bold, extracts the 歌 glyph outline, and emits the SVG path data used in all assets.
- Generated SVGs are **committed**; the script is kept for regeneration.
- PNGs (touch/PWA icons, og-image) are rendered once from the SVGs (e.g. via `sharp` or `resvg`) and committed. No runtime or CI dependency.
- The Noto Sans JP font file itself is a devDependency/downloaded artifact for the script only; it is not shipped to the client.

## Out of scope

- Redesigning the 歌sync wordmark typography.
- Animated logo treatments.
- Any in-app UI changes beyond the landing header lockup and HTML meta tags.
