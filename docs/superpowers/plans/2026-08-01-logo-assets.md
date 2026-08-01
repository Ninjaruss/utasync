# Utasync Echo 歌 Logo Asset Set — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder logo assets with the approved "echo 歌" mark (spec: `docs/superpowers/specs/2026-08-01-logo-design.md`) across favicon, PWA icons, landing header, and social share card.

**Architecture:** A one-off Node script (`scripts/generate-logo.mjs`) downloads Noto Sans CJK JP Bold (SIL OFL), converts the 歌 glyph to fixed SVG path data with `opentype.js`, and emits all SVG + PNG assets (`@resvg/resvg-js` for rasterization). Generated assets are committed; the script stays for regeneration. Small wiring edits follow in `index.html`, `vite.config.ts` (PWA manifest), and `src/landing/LandingScreen.tsx`.

**Tech Stack:** Node ESM script, opentype.js, @resvg/resvg-js, vitest (asset sanity tests), Vite + vite-plugin-pwa, React/Tailwind.

**Mark geometry (from approved E1 mockup, normalized to a 512 tile):** main glyph bbox-centered, echo copy behind it offset `+37px x, −27px y`, fill `#f87171`, echo opacity `0.25`, tile `#180606`, corner radius `112`.

**Repo facts (verified 2026-08-01):**
- `public/` currently has `favicon.svg` (off-brand purple placeholder) and `icon.svg` (`<text>`-based 歌 — viewer-font dependent).
- `vite.config.ts` PWA manifest (~line 350–362) already lists `/icon-192.png` and `/icon-512.png` — **these files do not exist** (broken manifest today). It also marks `/icon.svg` as `purpose: 'any maskable'` with no safe zone.
- `index.html` has no `apple-touch-icon` link and no `og:*`/`twitter:*` meta.
- Canonical URL: `https://utasync.app` (README).
- Landing header wordmark: `src/landing/LandingScreen.tsx` line ~44: `<span className="text-cinnabar-accent font-semibold tracking-widest text-lg">歌sync</span>`.
- Tests live in `tests/` and run with vitest.

---

### Task 1: Dependencies and scaffolding

**Files:**
- Modify: `package.json` (devDependencies + script)
- Modify: `.gitignore`

- [ ] **Step 1: Install dev dependencies**

```bash
npm install -D opentype.js@^1.3.4 @resvg/resvg-js@^2.6.2
```

Expected: both packages appear in `devDependencies`, install succeeds.

- [ ] **Step 2: Add npm script**

In `package.json` `"scripts"`, add:

```json
"generate:logo": "node scripts/generate-logo.mjs"
```

- [ ] **Step 3: Ignore the font cache**

Append to `.gitignore`:

```
scripts/.cache/
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .gitignore
git commit -m "chore: deps + scaffolding for logo asset generator"
```

---

### Task 2: Failing asset test

**Files:**
- Create: `tests/logo-assets.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pub = join(root, 'public')
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47])

describe('logo assets', () => {
  for (const name of ['favicon.svg', 'icon.svg']) {
    it(`${name} is the path-based echo mark`, () => {
      const svg = readFileSync(join(pub, name), 'utf8')
      // No <text>: glyphs must be baked paths (viewer-font independence, OFL outlines)
      expect(svg).not.toContain('<text')
      // Main glyph + echo copy
      expect((svg.match(/<path/g) ?? []).length).toBeGreaterThanOrEqual(2)
      expect(svg).toContain('opacity="0.25"')
      expect(svg).toContain('#f87171')
      expect(svg).toContain('#180606')
    })
  }

  for (const name of [
    'apple-touch-icon.png',
    'icon-192.png',
    'icon-512.png',
    'icon-maskable-512.png',
    'og.png',
  ]) {
    it(`${name} exists and is a PNG`, () => {
      const buf = readFileSync(join(pub, name))
      expect(buf.subarray(0, 4).equals(PNG_MAGIC)).toBe(true)
      expect(buf.length).toBeGreaterThan(1000)
    })
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/logo-assets.test.ts
```

Expected: FAIL — `favicon.svg` contains no `<path>` pairs matching / `icon.svg` contains `<text` / PNG files ENOENT.

- [ ] **Step 3: Commit**

```bash
git add tests/logo-assets.test.ts
git commit -m "test: logo asset sanity checks (failing)"
```

---

### Task 3: The generator script

**Files:**
- Create: `scripts/generate-logo.mjs`
- Generates: `public/favicon.svg`, `public/icon.svg`, `public/apple-touch-icon.png`, `public/icon-192.png`, `public/icon-512.png`, `public/icon-maskable-512.png`, `public/og.png`

- [ ] **Step 1: Write the script**

```js
#!/usr/bin/env node
// Generates the Utasync logo asset set: the "echo 歌" mark
// (docs/superpowers/specs/2026-08-01-logo-design.md).
//
// The 歌 glyph is converted to fixed SVG paths from Noto Sans CJK JP Bold
// (SIL OFL — outlines are free to use in logos; also avoids <text> elements
// whose rendering depends on viewer-installed fonts).
//
// Usage: npm run generate:logo
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import opentype from 'opentype.js'
import { Resvg } from '@resvg/resvg-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC = path.join(__dirname, '..', 'public')
const CACHE = path.join(__dirname, '.cache')
const FONT_URL =
  'https://github.com/notofonts/noto-cjk/raw/main/Sans/OTF/Japanese/NotoSansCJKjp-Bold.otf'
const FONT_PATH = path.join(CACHE, 'NotoSansCJKjp-Bold.otf')

const CINNABAR = '#f87171'
const TILE = '#180606'
const OG_BG = '#0d0404'
const ECHO_OPACITY = '0.25'
// Echo offset at 512-tile scale (approved E1 mockup used +11,-8 on a 150 tile)
const ECHO_DX = 37
const ECHO_DY = -27

async function ensureFont() {
  if (fs.existsSync(FONT_PATH)) return
  fs.mkdirSync(CACHE, { recursive: true })
  console.log('Downloading Noto Sans CJK JP Bold (~16 MB, cached in scripts/.cache)...')
  const res = await fetch(FONT_URL)
  if (!res.ok) throw new Error(`Font download failed: ${res.status} ${res.statusText}`)
  fs.writeFileSync(FONT_PATH, Buffer.from(await res.arrayBuffer()))
}

function loadFont() {
  const buf = fs.readFileSync(FONT_PATH)
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
}

/** 歌 as path data at the given font size, with its bounding box. */
function glyph(font, fontSize) {
  const p = font.getPath('歌', 0, 0, fontSize)
  return { d: p.toPathData(2), bb: p.getBoundingBox() }
}

/**
 * The echo mark on a 512x512 tile.
 * rx: corner radius (112 for the rounded tile, 0 for full-bleed rasters).
 * fontSize: 300 = standard margins; 220 = maskable safe zone.
 */
function echoMarkSvg({ rx, fontSize, font }) {
  const { d, bb } = glyph(font, fontSize)
  const cx = (512 - (bb.x2 - bb.x1)) / 2 - bb.x1
  const cy = (512 - (bb.y2 - bb.y1)) / 2 - bb.y1
  const at = (x, y) => `translate(${x.toFixed(1)} ${y.toFixed(1)})`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${rx}" fill="${TILE}"/>
  <g fill="${CINNABAR}">
    <path transform="${at(cx + ECHO_DX, cy + ECHO_DY)}" opacity="${ECHO_OPACITY}" d="${d}"/>
    <path transform="${at(cx, cy)}" d="${d}"/>
  </g>
</svg>
`
}

/** 1200x630 social card: mark + 歌sync wordmark + tagline. */
function ogSvg(markSvg) {
  const markInner = markSvg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${OG_BG}"/>
  <svg x="518" y="118" width="164" height="164" viewBox="0 0 512 512">${markInner}</svg>
  <text x="600" y="415" text-anchor="middle" font-family="Noto Sans CJK JP" font-weight="700"
        font-size="76" letter-spacing="8" fill="${CINNABAR}">歌sync</text>
  <text x="600" y="480" text-anchor="middle" font-family="Noto Sans CJK JP" font-weight="700"
        font-size="30" letter-spacing="1" fill="#ffffff" opacity="0.65">Turn any song into a lyric study session.</text>
</svg>
`
}

function png(svg, width, { withFonts = false } = {}) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: withFonts
      ? { fontFiles: [FONT_PATH], loadSystemFonts: false, defaultFontFamily: 'Noto Sans CJK JP' }
      : { loadSystemFonts: false },
  })
  return resvg.render().asPng()
}

const write = (name, data) => {
  fs.writeFileSync(path.join(PUBLIC, name), data)
  console.log(`  wrote public/${name}`)
}

await ensureFont()
const font = loadFont()

const tileMark = echoMarkSvg({ rx: 112, fontSize: 300, font })
const squareMark = echoMarkSvg({ rx: 0, fontSize: 300, font })
const maskableMark = echoMarkSvg({ rx: 0, fontSize: 220, font })

write('favicon.svg', tileMark)
write('icon.svg', tileMark)
write('apple-touch-icon.png', png(squareMark, 180)) // iOS masks corners itself
write('icon-192.png', png(tileMark, 192))
write('icon-512.png', png(tileMark, 512))
write('icon-maskable-512.png', png(maskableMark, 512))
write('og.png', png(ogSvg(tileMark), 1200, { withFonts: true }))
console.log('Done.')
```

- [ ] **Step 2: Run the generator**

```bash
npm run generate:logo
```

Expected: downloads the font once, then `wrote public/...` for all 7 assets. If the GitHub URL 404s (repo layout changed), find the current static **Bold OTF** under `notofonts/noto-cjk` `Sans/OTF/Japanese/` and update `FONT_URL` — do not substitute a non-OFL font.

- [ ] **Step 3: Run the asset test**

```bash
npx vitest run tests/logo-assets.test.ts
```

Expected: PASS (all assertions).

- [ ] **Step 4: Eyeball the SVG**

Open `public/favicon.svg` in a browser (or the repo preview) and confirm: dark rounded tile, bright cinnabar 歌, faint echo up-right behind it, glyph roughly centered with even margins. This catches bbox-centering surprises the test can't.

- [ ] **Step 5: Commit**

```bash
git add scripts/generate-logo.mjs public/favicon.svg public/icon.svg public/apple-touch-icon.png public/icon-192.png public/icon-512.png public/icon-maskable-512.png public/og.png
git commit -m "feat: echo 歌 logo mark — generator script + full asset set"
```

---

### Task 4: index.html icon + social meta

**Files:**
- Modify: `index.html` (head)
- Modify: `tests/logo-assets.test.ts` (add assertions)

- [ ] **Step 1: Extend the test (failing)**

Add inside the top-level `describe` in `tests/logo-assets.test.ts`:

```ts
it('index.html wires icons and social meta', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8')
  expect(html).toContain('rel="apple-touch-icon"')
  expect(html).toContain('property="og:image" content="https://utasync.app/og.png"')
  expect(html).toContain('name="twitter:card" content="summary_large_image"')
})
```

Run: `npx vitest run tests/logo-assets.test.ts` — expected: this one test FAILS, the rest pass.

- [ ] **Step 2: Add the tags**

In `index.html`, after the `<link rel="icon" ...>` line, add:

```html
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <meta name="theme-color" content="#0d0404" />
    <meta name="description" content="Turn any song into a lyric study session." />
    <meta property="og:title" content="Utasync" />
    <meta property="og:description" content="Turn any song into a lyric study session." />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="https://utasync.app/" />
    <meta property="og:image" content="https://utasync.app/og.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content="https://utasync.app/og.png" />
```

- [ ] **Step 3: Run the test**

```bash
npx vitest run tests/logo-assets.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add index.html tests/logo-assets.test.ts
git commit -m "feat: apple-touch-icon + Open Graph / Twitter card meta"
```

---

### Task 5: PWA manifest icons

**Files:**
- Modify: `vite.config.ts` (manifest `icons`, ~line 357–361)

- [ ] **Step 1: Update the icons array**

Replace:

```ts
        icons: [
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
```

with:

```ts
        icons: [
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
```

(The old `'any maskable'` on the tile SVG was wrong — a maskable icon needs the safe-zone padding the new `icon-maskable-512.png` has. The referenced 192/512 PNGs also finally exist now.)

- [ ] **Step 2: Type-check**

```bash
npx tsc -b
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add vite.config.ts
git commit -m "fix: PWA manifest icons — real PNGs + proper maskable variant"
```

---

### Task 6: Landing header lockup

**Files:**
- Modify: `src/landing/LandingScreen.tsx` (header, ~line 44)

- [ ] **Step 1: Add the mark beside the wordmark**

Replace:

```tsx
          <span className="text-cinnabar-accent font-semibold tracking-widest text-lg">歌sync</span>
```

with:

```tsx
          <span className="flex items-center gap-2">
            <img src="/favicon.svg" alt="" className="w-6 h-6" />
            <span className="text-cinnabar-accent font-semibold tracking-widest text-lg">歌sync</span>
          </span>
```

(`alt=""` — decorative; the wordmark carries the name. Rounded corners are baked into the SVG.)

- [ ] **Step 2: Verify live**

Start the dev server (`.claude/launch.json` / preview tooling), open the landing page, confirm: mark renders next to 歌sync at 24px, corners rounded, echo visible but subtle; browser tab shows the new favicon (hard-reload if the old one is cached).

- [ ] **Step 3: Run the full asset test + lint**

```bash
npx vitest run tests/logo-assets.test.ts && npx eslint src/landing/LandingScreen.tsx
```

Expected: PASS / no lint errors.

- [ ] **Step 4: Commit**

```bash
git add src/landing/LandingScreen.tsx
git commit -m "feat: landing header logo lockup"
```

---

### Task 7: Wrap up

- [ ] **Step 1: Full test suite**

```bash
npx vitest run
```

Expected: no new failures (pre-existing flaky integration tests noted in project memory are not caused by this change — compare against a `git stash` run only if something unexpected fails).

- [ ] **Step 2: Finish the branch**

Use superpowers:finishing-a-development-branch — present merge/PR options for the working branch.
