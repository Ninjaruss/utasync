import Kuroshiro from 'kuroshiro'
import KuromojiAnalyzer from 'kuroshiro-analyzer-kuromoji'

let kuroshiro: Kuroshiro | null = null

async function getKuroshiro(): Promise<Kuroshiro> {
  if (kuroshiro) return kuroshiro
  kuroshiro = new Kuroshiro()
  await kuroshiro.init(new KuromojiAnalyzer({ dictPath: '/dict' }))
  return kuroshiro
}

export async function toRomaji(text: string): Promise<string> {
  const k = await getKuroshiro()
  return k.convert(text, { to: 'romaji', mode: 'spaced', romajiSystem: 'hepburn' })
}

export async function toFurigana(text: string): Promise<string> {
  const k = await getKuroshiro()
  return k.convert(text, { to: 'hiragana', mode: 'furigana' })
}

export async function toKatakana(text: string): Promise<string> {
  const k = await getKuroshiro()
  return k.convert(text, { to: 'katakana' })
}
