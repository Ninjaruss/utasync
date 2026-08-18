import { describe, it, expect } from 'vitest'
import { findLyrics } from '../../src/sources/lrclib'

/**
 * Coverage probe through the REAL resolution path.
 *
 * `scripts/lyrics-source-coverage.mjs` queries LRCLIB with exact
 * track_name+artist_name, which is a LOWER BOUND: `findLyrics` also expands
 * title and artist variants and falls back to broader searches, so a song the
 * script reports as absent may still resolve here.
 *
 * This exists to answer one question honestly — for the songs the raw API says
 * it has nothing for, does the app find them anyway? That number decides how
 * large the "no synced lyrics exist" population really is, which is what a
 * Phase 2 retiming fallback would serve.
 *
 * Network-gated; never runs in CI.
 *   RUN_LRCLIB_LIVE=1 npx vitest run tests/sources/lrclib.coverage.live.test.ts
 */

const LIVE = process.env.RUN_LRCLIB_LIVE === '1'

const PROBES = [
  { title: '幸せにさよなら', artist: '山下達郎', note: 'the reported case' },
  { title: 'クリスマス・イブ', artist: '山下達郎', note: 'raw API: 10 results, 0 synced' },
  {
    title: 'Rockn Roll Morning Lights Falls On You',
    artist: 'ASIAN KUNG-FU GENERATION',
    note: 'raw API: 0 results, but the existing live test expects a hit',
  },
]

describe.skipIf(!LIVE)('LRCLIB coverage through findLyrics (RUN_LRCLIB_LIVE=1)', () => {
  for (const probe of PROBES) {
    it(`reports what findLyrics resolves for ${probe.artist} - ${probe.title}`, async () => {
      const found = await findLyrics(probe.title, probe.artist)
      console.log(
        `[coverage] ${probe.artist} - ${probe.title} (${probe.note})\n`
        + `           found=${!!found} synced=${found?.synced ?? false}`
        + ` match="${found?.match?.track ?? '-'}" by "${found?.match?.artist ?? '-'}"`,
      )
      // Deliberately not asserting a hit — this probe measures reality rather
      // than pinning it. A failure here would mean the network is down, not
      // that the app regressed.
      expect(found === null || typeof found.lrc === 'string').toBe(true)
    }, 180_000)
  }
})
