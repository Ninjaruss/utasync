// Characters worth matching on: lowercase Latin letters and Japanese scripts
// (kana + prolonged mark + kanji blocks). Everything else (spaces, punctuation,
// full-width symbols) is dropped so it can't block a match.
const MATCH_CHAR = /[a-z぀-ヿー㐀-鿿豈-﫿]/

export function normalizeForMatch(text: string): string {
  let out = ''
  for (const ch of text.toLowerCase()) if (MATCH_CHAR.test(ch)) out += ch
  return out
}
