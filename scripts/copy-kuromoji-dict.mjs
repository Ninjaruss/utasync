import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const src = join(root, 'node_modules', 'kuromoji', 'dict')
const dest = join(root, 'public', 'dict')

if (!existsSync(src)) {
  console.warn('[copy-kuromoji-dict] node_modules/kuromoji/dict not found — skipping')
  process.exit(0)
}

mkdirSync(dest, { recursive: true })
cpSync(src, dest, { recursive: true })
console.log('[copy-kuromoji-dict] Copied kuromoji dictionary to public/dict')
