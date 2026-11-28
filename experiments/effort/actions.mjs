// Approach B's gate: does an aligner's draft cost the user fewer actions than tapping
// every line? See README.md, written first, including the declaration that L62's table
// was already read and why the threshold is argued from the complaint instead.
//
// Input is L62's published per-song table (line counts and how many lines are over 1 s
// and over 2 s from the reference). No lyric text, no re-scoring of arm D.
const SONGS = [
  // song, lines, lines >1s from the reference, lines >2s  (ledger L62, part 2)
  ['guitar-loneliness', 36, 12, 4],
  ['recollect', 47, 11, 4],
  ['stranger-than-heaven', 59, 6, 4],
  ['veil', 48, 4, 3],
  ['going-my-way', 31, 2, 1],
]

/** A route worth reversing an ADR for must at least halve the work. Argued from the
 *  user's complaint ("a bunch of work"), not from these numbers — see README. */
const REQUIRED_RATIO = 2

const MODELS = [
  { name: 'nudge (3 actions/line), user fixes >1s', cost: 3, col: 2, exists: true },
  { name: 'tap-to-fix (1 action/line), user fixes >1s', cost: 1, col: 2, exists: false },
  { name: 'nudge (3 actions/line), user fixes only >2s', cost: 3, col: 3, exists: true },
  { name: 'tap-to-fix (1 action/line), user fixes only >2s', cost: 1, col: 3, exists: false },
]

for (const m of MODELS) {
  const ratios = SONGS.map(([name, n, ...bad]) => {
    const actions = m.cost * bad[m.col - 2]
    return { name, n, actions, ratio: actions === 0 ? Infinity : n / actions }
  })
  const worst = Math.min(...ratios.map((r) => r.ratio))
  console.log(`\n${m.name}${m.exists ? '' : '   [affordance does not exist today]'}`)
  for (const r of ratios) {
    console.log(`  ${r.name.padEnd(22)} tap all ${String(r.n).padStart(3)}  vs correct ${String(r.actions).padStart(3)}  = ${r.ratio.toFixed(2)}x`)
  }
  console.log(`  worst song ${worst.toFixed(2)}x -> ${worst >= REQUIRED_RATIO ? 'PASS' : 'FAIL'} (needs >=${REQUIRED_RATIO}x on every song)`)
}

console.log(`\nVERDICT: the gate is on the first model, the only one buildable today.`)
