import { JAPANESE_RE } from '../lyrics/bilingual'

function normalizeArtistKey(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/[^a-z0-9\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff]/g, '')
}

/** Known spellings for artists often typed in romanized English. */
const ARTIST_ALIAS_GROUPS: string[][] = [
  ['Keina Suda', 'Suda Keina', '須田景瑚', 'スダケイナ'],
  [
    'ASIAN KUNG-FU GENERATION',
    'Asian Kung-Fu Generation',
    'AKFG',
    'アジアン・カンフー・ジェネレーション',
  ],
  ['LiSA', 'Lisa', 'リサ'],
  ['YOASOBI', 'Yoasobi', 'ヨアソビ'],
  ['Aimer', 'エメ'],
  ['Kenshi Yonezu', 'Yonezu Kenshi', '米津玄師'],
  ['RADWIMPS', 'Radwimps', 'ラッドウィンプス'],
  ['King Gnu', 'King GNU', 'キングヌー'],
  ['Official HIGE DANdism', 'Official髭男dism', 'ヒゲダン'],
]

const aliasByKey = new Map<string, Set<string>>()

for (const group of ARTIST_ALIAS_GROUPS) {
  const names = group.map((n) => n.trim()).filter(Boolean)
  const merged = new Set(names)
  for (const name of names) {
    const key = normalizeArtistKey(name)
    const existing = aliasByKey.get(key) ?? new Set<string>()
    for (const alias of merged) existing.add(alias)
    aliasByKey.set(key, existing)
  }
}

/** All known spellings for an artist name (includes the input). */
export function lookupArtistAliases(artist: string): string[] {
  const trimmed = artist.trim()
  if (!trimmed) return []
  const found = aliasByKey.get(normalizeArtistKey(trimmed))
  if (!found) return [trimmed]
  return [...found]
}

/** True when the artist is known to be Japanese or has a Japanese-script alias. */
export function artistSuggestsJapaneseLyrics(artist: string): boolean {
  if (JAPANESE_RE.test(artist)) return true
  return lookupArtistAliases(artist).some((alias) => JAPANESE_RE.test(alias))
}
