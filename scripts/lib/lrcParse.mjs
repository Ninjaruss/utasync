const TIMESTAMP = /^\[(\d+):(\d{2}(?:\.\d{1,3})?)\]/

// Pure: LRC text in, ordered { timeSeconds, text } rows out. Metadata tags and empty lines are dropped.
export function parseLrc(text) {
  const rows = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    const m = TIMESTAMP.exec(line)
    if (!m) continue
    const body = line.slice(m[0].length).trim()
    if (!body) continue
    const timeSeconds = Math.round((Number(m[1]) * 60 + Number(m[2])) * 1000) / 1000
    const prev = rows[rows.length - 1]
    if (prev && timeSeconds === prev.timeSeconds) throw new Error(`duplicate timestamp ${timeSeconds}s`)
    if (prev && timeSeconds < prev.timeSeconds) throw new Error(`timestamps out of order at ${timeSeconds}s`)
    rows.push({ timeSeconds, text: body })
  }
  return rows
}
