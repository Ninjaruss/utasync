#!/usr/bin/env node
/**
 * Downloads large AI model files to public/models/ before the build.
 * Source: public UVR model repo (no auth needed). Files are gitignored
 * to keep the repo lean; this script runs as a prebuild step on Vercel
 * and during local `npm run dev` setup.
 */
import { createWriteStream, existsSync, mkdirSync } from 'fs'
import { stat } from 'fs/promises'
import { pipeline } from 'stream/promises'
import { get } from 'https'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MODELS_DIR = join(ROOT, 'public', 'models')

const MODELS = [
  {
    filename: 'Kim_Vocal_2.onnx',
    url: 'https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/Kim_Vocal_2.onnx',
    expectedBytes: 66759214,
  },
]

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303) {
        httpsGet(res.headers.location).then(resolve, reject)
        res.resume()
        return
      }
      resolve(res)
    }).on('error', reject)
  })
}

async function download(url, destPath, expectedBytes) {
  const res = await httpsGet(url)
  if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode} for ${url}`)
  const tmp = destPath + '.tmp'
  await pipeline(res, createWriteStream(tmp))
  const { size } = await stat(tmp)
  if (size !== expectedBytes) {
    throw new Error(`Size mismatch: got ${size}, expected ${expectedBytes}`)
  }
  await (await import('fs/promises')).rename(tmp, destPath)
}

mkdirSync(MODELS_DIR, { recursive: true })

for (const { filename, url, expectedBytes } of MODELS) {
  const dest = join(MODELS_DIR, filename)

  if (existsSync(dest)) {
    const { size } = await stat(dest)
    if (size === expectedBytes) {
      console.log(`✓ ${filename} already present (${(size / 1e6).toFixed(1)} MB)`)
      continue
    }
    console.log(`⚠ ${filename} size mismatch — re-downloading`)
  }

  process.stdout.write(`↓ Downloading ${filename} (${(expectedBytes / 1e6).toFixed(1)} MB)…`)
  try {
    await download(url, dest, expectedBytes)
    console.log(' done.')
  } catch (err) {
    console.error(`\n✗ Failed to download ${filename}: ${err.message}`)
    process.exit(1)
  }
}
