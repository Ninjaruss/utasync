/**
 * Builds public/cmudict.json — the English pronunciation lexicon behind the
 * IPA reading line (src/language/english/phonetics.ts).
 *
 * Source: the CMU Pronouncing Dictionary (cmusphinx/cmudict), pinned to a
 * commit so the artifact is reproducible. Downloaded into .cache/cmudict/
 * (gitignored) and parsed here; the built JSON is committed, like the JMdict
 * artifacts.
 *
 * Output shape is a FLAT uppercase word -> ARPAbet map, matching what
 * getCMUDict()/wordToIPA already index into, so nothing at runtime changes.
 *
 * Usage:
 *   node scripts/build-cmudict.mjs
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cacheDir = join(root, '.cache/cmudict')
const outPath = join(root, 'public/cmudict.json')
const licenseDir = join(root, 'public/licenses')
const licenseOut = join(licenseDir, 'cmudict.txt')

// Pinned so a rebuild is reproducible; bump deliberately, then re-verify sizes.
const SHA = '74790861f652b15e4ac49015a90074ad62a27690'
const base = `https://raw.githubusercontent.com/cmusphinx/cmudict/${SHA}`

function fetchTo(url, dest) {
  if (existsSync(dest)) return dest
  console.log(`Downloading ${url} ...`)
  execSync(`curl -fsSL -o "${dest}" "${url}"`, { stdio: 'inherit' })
  return dest
}

function ensureSource() {
  mkdirSync(cacheDir, { recursive: true })
  return {
    dict: fetchTo(`${base}/cmudict.dict`, join(cacheDir, 'cmudict.dict')),
    license: fetchTo(`${base}/LICENSE`, join(cacheDir, 'LICENSE')),
  }
}

/**
 * One pronunciation per word. CMUdict lists alternates as `word(2)`, which the
 * lookup has no way to choose between — the first (canonical) entry wins and the
 * variants are dropped.
 */
export function parseCmudict(text) {
  const entries = Object.create(null)
  let variants = 0
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith(';;;')) continue
    // Trailing provenance comments: "aalborg AO1 L B AO0 R G # place, danish"
    const withoutComment = line.split('#')[0].trim()
    if (!withoutComment) continue
    const space = withoutComment.indexOf(' ')
    if (space <= 0) continue
    const word = withoutComment.slice(0, space)
    const phonemes = withoutComment.slice(space + 1).trim()
    if (!phonemes) continue
    if (/\(\d+\)$/.test(word)) { variants++; continue }
    const key = word.toUpperCase()
    // First entry wins; the file is sorted so that is the canonical one.
    if (entries[key] === undefined) entries[key] = phonemes
  }
  return { entries, variants }
}

function main() {
  const { dict, license } = ensureSource()
  console.log(`Building pronunciation lexicon from ${dict} ...`)
  const { entries, variants } = parseCmudict(readFileSync(dict, 'utf8'))
  const count = Object.keys(entries).length
  if (count < 100_000) {
    throw new Error(`Only ${count} entries parsed — the source looks wrong or truncated`)
  }
  writeFileSync(outPath, JSON.stringify(entries))
  mkdirSync(licenseDir, { recursive: true })
  writeFileSync(
    licenseOut,
    `The CMU Pronouncing Dictionary\nSource: https://github.com/cmusphinx/cmudict\nRevision: ${SHA}\n\n${readFileSync(license, 'utf8')}`,
  )
  const mb = (readFileSync(outPath).length / 1024 / 1024).toFixed(2)
  console.log(`Wrote ${outPath} (${mb} MB, ${count} words, ${variants} alternate pronunciations dropped)`)
  console.log(`Wrote ${licenseOut}`)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
