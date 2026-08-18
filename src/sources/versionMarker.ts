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
 * boundary at all). But dropping `\b` entirely for the Japanese side just trades
 * one bug for another: `ライブ` ("live") is then a substring match inside
 * `東京ライブハウス` ("Tokyo live house", a venue name) or `ライブが始まる`
 * ("the live begins", a lyric fragment) — neither of which declares a version.
 *
 * The fix used below: match the Latin alternative(s) with `\b` against the raw
 * segment (unambiguous — Latin `\w` boundaries work normally), but require the
 * Japanese alternative(s) to equal an *entire token* of the segment, where a
 * token is delimited by whitespace or a small set of title-separator characters
 * (`・･/／|｜,、`). `山下ヴォーカル・バージョン` tokenizes to
 * `[山下ヴォーカル, バージョン]`, so `バージョン` matches as a whole token; the
 * false positives above don't, because their marker substring is glued to
 * surrounding kanji/kana with no separator in between.
 */

/** Canonical token per marker family, so spelling variants compare equal. */
const MARKER_PATTERNS: Array<{ token: string; latin: RegExp; jp: RegExp }> = [
  { token: 'live', latin: /\blive\b/i, jp: /^(ライブ|ライヴ)$/ },
  { token: 'acoustic', latin: /\bacoustic\b/i, jp: /^アコースティック$/ },
  { token: 'instrumental', latin: /\binstrumental\b|\binst\.?\b/i, jp: /^インスト(ゥルメンタル)?$/ },
  { token: 'remaster', latin: /\bremaster(ed)?\b/i, jp: /^リマスター$/ },
  { token: 'remix', latin: /\bremix\b/i, jp: /^リミックス$/ },
  { token: 'karaoke', latin: /\bkaraoke\b|off ?vocal/i, jp: /^カラオケ$/ },
  // Generic "some other version" — deliberately last, and deliberately broad
  // enough to catch 山下ヴォーカル・バージョン, which is the reported case.
  { token: 'version', latin: /\bver(sion)?\.?\b/i, jp: /^(バージョン|ヴァージョン)$/ },
]

/**
 * Production noise that looks like a marker but says nothing about the recording.
 * Treating these as versions would penalise almost every correct YouTube match.
 */
const NOT_A_VERSION = /\b(official|music ?video|m\/?v|lyric[s]?|audio|hd|4k|visualizer|color coded|explicit|clean)\b/i

/** Separators that delimit tokens within a title segment. */
const TOKEN_SEPARATORS = /[\s・･/／|｜,、]+/

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
    const tokens = seg.split(TOKEN_SEPARATORS).filter(Boolean)
    for (const { token, latin, jp } of MARKER_PATTERNS) {
      const matched = latin.test(seg) || tokens.some((t) => jp.test(t))
      if (matched) {
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
