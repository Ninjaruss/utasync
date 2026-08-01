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
// Floor, not exact match: releases can shift slightly; ~16 MB is the real size.
const FONT_MIN_BYTES = 1_000_000

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
  const buf = Buffer.from(await res.arrayBuffer())
  // Download to a temp file and rename into place, with a size sanity check,
  // so a killed/truncated download can never leave a corrupt file at FONT_PATH
  // that existsSync() would then treat as valid forever (see scripts/download-models.mjs).
  const tmpPath = `${FONT_PATH}.tmp`
  fs.writeFileSync(tmpPath, buf)
  if (buf.length < FONT_MIN_BYTES) {
    fs.rmSync(tmpPath, { force: true })
    throw new Error(
      `Font download from ${FONT_URL} looks truncated: got ${buf.length} bytes, expected at least ${FONT_MIN_BYTES}`
    )
  }
  fs.renameSync(tmpPath, FONT_PATH)
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
  // Strips the outer <svg> tag to inline the mark's children into the nested
  // <svg> below. Coupled to echoMarkSvg()'s exact output shape (single root
  // <svg ...>...</svg> with no trailing content after the closing tag).
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
