import { describe, it, expect } from 'vitest'
import { findLyrics } from '../../src/sources/lrclib'

const LIVE = process.env.RUN_LRCLIB_LIVE === '1'

describe.skipIf(!LIVE)('LRCLIB live (RUN_LRCLIB_LIVE=1)', () => {
  it('finds AKFG Rockn Roll Morning Light within reasonable time', async () => {
    const start = performance.now()
    const result = await findLyrics(
      'Rockn Roll Morning Lights Falls On You',
      'ASIAN KUNG-FU GENERATION',
    )
    const elapsed = performance.now() - start
    expect(result?.lrc).toBeTruthy()
    expect(result?.lrc).toMatch(/出来れば|Dekireba|sekai/i)
    expect(elapsed).toBeLessThan(120_000)
    console.log(`Live LRCLIB search completed in ${Math.round(elapsed / 1000)}s`)
  }, 120_000)
})
