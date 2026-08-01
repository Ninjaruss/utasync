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
