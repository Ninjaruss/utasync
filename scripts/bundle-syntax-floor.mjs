#!/usr/bin/env node
/**
 * Bundle syntax floor — what does the built output ACTUALLY require?
 *
 * `build.target` in vite.config.ts controls how far syntax is downlevelled.
 * With `esnext`, nothing is downlevelled and the real minimum browser is
 * whatever the emitted syntax happens to demand — a number nobody has measured
 * and which no test enforces. The failure mode is a parse error and a blank
 * page, not graceful degradation.
 *
 * This scans dist/ for syntax features with known browser floors and reports
 * the highest one found, so the documented support matrix can be checked
 * against reality rather than trusted.
 *
 *   npx vite build && node scripts/bundle-syntax-floor.mjs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Each probe: syntax that only parses on browsers at or above the listed
// versions. Ordered roughly oldest-to-newest requirement.
const PROBES = [
  {
    name: 'optional chaining  ?.',
    re: /[\w)\]]\?\.[\w[(]/,
    floors: { chrome: 80, safari: 13.1, firefox: 74 },
  },
  {
    name: 'nullish coalescing  ??',
    re: /[\w)\]"'`\s]\?\?[\s\w("'`]/,
    floors: { chrome: 80, safari: 13.1, firefox: 72 },
  },
  {
    name: 'logical assignment  ??= ||= &&=',
    re: /(\?\?=|\|\|=|&&=)/,
    floors: { chrome: 85, safari: 14, firefox: 79 },
  },
  {
    name: 'class static blocks  static {',
    re: /\bstatic\s*\{/,
    floors: { chrome: 94, safari: 16.4, firefox: 93 },
  },
  {
    name: 'private class fields  #x',
    re: /(^|[^\w$#])#[A-Za-z_$][\w$]*\s*[=;.(]/m,
    floors: { chrome: 74, safari: 14.1, firefox: 90 },
  },
  {
    name: 'top-level await',
    // Crude but effective on minified ESM: `await` not preceded by a function
    // context on the first statement level is hard to detect textually, so we
    // look for the import.meta + await combination bundlers emit.
    re: /^\s*await\s|[;}]\s*await\s+[A-Za-z_$(]/m,
    floors: { chrome: 89, safari: 15, firefox: 89 },
  },
  {
    name: 'RegExp `v` flag / unicodeSets',
    re: /\/[^\n/]+\/[dgimsuy]*v[dgimsuy]*[;,)\]}\s]/,
    floors: { chrome: 112, safari: 17, firefox: 116 },
  },
  {
    name: 'Array.prototype.at(',
    re: /\.at\(/,
    floors: { chrome: 92, safari: 15.4, firefox: 90 },
  },
  {
    name: 'Object.hasOwn(',
    re: /Object\.hasOwn\(/,
    floors: { chrome: 93, safari: 15.4, firefox: 92 },
  },
  {
    name: 'Array.prototype.findLast(',
    re: /\.findLast(Index)?\(/,
    floors: { chrome: 97, safari: 15.4, firefox: 104 },
  },
  {
    name: 'structuredClone(',
    re: /\bstructuredClone\(/,
    floors: { chrome: 98, safari: 15.4, firefox: 94 },
  },
]

function jsFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...jsFiles(full))
    else if (entry.endsWith('.js')) out.push(full)
  }
  return out
}

const files = jsFiles('dist')
if (files.length === 0) {
  console.error('No JS in dist/ — run `npx vite build` first.')
  process.exit(1)
}

const hits = []
for (const probe of PROBES) {
  const found = files.filter((f) => probe.re.test(readFileSync(f, 'utf8')))
  if (found.length > 0) hits.push({ ...probe, count: found.length, sample: found[0] })
}

console.log(`\nScanned ${files.length} JS files in dist/\n`)
console.log('=== syntax/API features present ===')
for (const h of hits) {
  const f = h.floors
  console.log(`  ${h.name.padEnd(34)} chrome>=${f.chrome} safari>=${f.safari} firefox>=${f.firefox}   (${h.count} files)`)
}

const floor = (browser) => Math.max(...hits.map((h) => h.floors[browser]), 0)

console.log('\n=== implied minimum browser ===')
console.log(`  Chrome  >= ${floor('chrome')}`)
console.log(`  Safari  >= ${floor('safari')}`)
console.log(`  Firefox >= ${floor('firefox')}`)
console.log(
  '\nCompare against docs/DEPLOYMENT.md "Browser support". A floor ABOVE the\n'
  + 'documented matrix means the doc overclaims and users on those versions get\n'
  + 'a blank page, not a degraded experience.\n',
)
