/**
 * Version markers — the part of a title that says WHICH recording this is.
 *
 * `cleanTitle`/`TITLE_NOISE` in youtube.ts deliberately strip these so a search
 * finds candidates at all. That is right for finding and wrong for choosing: once
 * several candidates come back, the marker is often the only thing distinguishing
 * a live take from the studio master. This module keeps that signal so scoring can
 * use it, without touching how searches are built.
 *
 * Pure — no network, no DOM.
 *
 * Note on `\b` and Japanese: `\b` is a transition between a "word" character
 * (`\w`, i.e. `[A-Za-z0-9_]`) and a non-word character. Katakana/kanji are not
 * `\w`, so wrapping a whole `(latin|japanese)` alternation in `\b...\b` silently
 * fails to match the Japanese side (both neighbours are non-word, so there is no
 * boundary at all). Each pattern below therefore scopes `\b` to only its Latin
 * alternative(s) and leaves the Japanese alternative(s) unanchored.
 */

/** Canonical token per marker family, so spelling variants compare equal. */
const MARKER_PATTERNS: Array<{ token: string; re: RegExp }> = [
  { token: 'live', re: /\blive\b|ライブ|ライヴ/i },
  { token: 'acoustic', re: /\bacoustic\b|アコースティック/i },
  { token: 'instrumental', re: /\binstrumental\b|\binst\.?\b|インスト(ゥルメンタル)?/i },
  { token: 'remaster', re: /\bremaster(ed)?\b|リマスター/i },
  { token: 'remix', re: /\bremix\b|リミックス/i },
  { token: 'karaoke', re: /\bkaraoke\b|off ?vocal|カラオケ/i },
  // Generic "some other version" — deliberately last, and deliberately broad
  // enough to catch 山下ヴォーカル・バージョン, which is the reported case.
  { token: 'version', re: /\bver(sion)?\.?\b|バージョン|ヴァージョン/i },
]

/**
 * Production noise that looks like a marker but says nothing about the recording.
 * Treating these as versions would penalise almost every correct YouTube match.
 */
const NOT_A_VERSION = /\b(official|music ?video|m\/?v|lyric[s]?|audio|hd|4k|visualizer|color coded|explicit|clean)\b/i

/** The bracketed or trailing-dash segments of a title, where markers live. */
function candidateSegments(title: string): string[] {
  const segments: string[] = []
  for (const m of title.matchAll(/[([【]([^)\]】]+)[)\]】]/g)) segments.push(m[1])
  const dash = title.match(/\s[-–—]\s(.+)$/)
  if (dash) segments.push(dash[1])
  return segments
}

/** Canonical version tokens declared by a title, deduped, in pattern order. */
export function extractVersionMarkers(title: string): string[] {
  if (!title) return []
  const found = new Set<string>()
  for (const seg of candidateSegments(title)) {
    if (NOT_A_VERSION.test(seg)) continue
    for (const { token, re } of MARKER_PATTERNS) {
      if (re.test(seg)) {
        found.add(token)
        // One family per segment: "2019 Remastered Version" is a remaster, not
        // also a generic "version".
        break
      }
    }
  }
  return [...found]
}

const AGREE = 0.12
const CONFLICT = -0.18

/**
 * Score adjustment for how well two titles agree about which recording they are.
 *
 * Returns 0 when neither declares a version — the overwhelmingly common case,
 * which must stay exactly as it scores today. A one-sided declaration is treated
 * as a conflict: it is the reported failure mode, where the user asks for a
 * specific vocal version and gets the plain master.
 *
 * Symmetric, so callers need not care about argument order.
 *
 * AGREE/CONFLICT are starting values chosen by judgement, NOT measurement. A later
 * task tunes them against a real corpus.
 */
export function versionAgreement(queryTitle: string, candidateTitle: string): number {
  const q = extractVersionMarkers(queryTitle)
  const c = extractVersionMarkers(candidateTitle)
  if (q.length === 0 && c.length === 0) return 0
  if (q.length === 0 || c.length === 0) return CONFLICT
  return q.some((t) => c.includes(t)) ? AGREE : CONFLICT
}
