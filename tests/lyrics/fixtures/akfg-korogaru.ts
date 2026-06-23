import type { TimedLine } from '../../../src/core/types'
import { lineWeight } from '../../../src/ai-pipeline/aligner'

/** Japanese lyrics (転がる岩 / Korogaru Iwa — AKFG-style excerpt). */
export const AKFG_JA_LINES = `
出来れば世界を僕は塗り変えたい
戦争をなくすような大逸れたことじゃない
だけどちょっと それもあるよな
俳優や映画スターには成れない
それどころか 君の前でさえも上手に笑えない
そんな僕に術はないよな
嗚呼...
何を間違った それさえもわからないんだ
ローリング ローリング
初めから持ってないのに胸が痛んだ
僕らはきっとこの先も
心絡まって ローリング ローリング
凍てつく地面を転がるように走り出した
理由もないのに何だか悲しい
泣けやしないから 余計に救いがない
そんな夜を温めるように歌うんだ
岩は転がって 僕たちを何処かに連れて行くように ように
固い地面を分けて命が芽生えた
あの丘を越えたその先は
光輝いたように ように
君の孤独も全て暴き出す朝だ
赤い 赤い小さな車は君を乗せて
遠く向こうの角を曲がって
此処からは見えなくなった
何をなくした それさえもわからないんだ
ローリング ローリング
初めから持ってないのに胸が痛んだ
僕らはきっとこの先も
心絡まって ローリング ローリング
凍てつく世界を転がるように走り出した
`.trim().split('\n')

/** English translation (same song). */
export const AKFG_EN_BLOCK = `
If possible, I want to repaint the world
It's not a grand thing like eliminating wars
But there's a bit of that too

I can't become an actor or a movie star, in fact
I can't even smile well in front of you
There's no way for me

What did I do wrong? Even that
I don't understand, rolling, rolling
My heart ached even though I didn't have it from the beginning

Surely we will continue
Our hearts entwined, rolling, rolling
We started running as if rolling on the freezing ground

For no reason, I feel somewhat sad
I can't cry, so there's even less comfort
I sing to warm up such nights

The rocks roll us
As if taking us somewhere
Life sprouted breaking through the hard ground

Beyond that hill
Shining brightly
It's a morning that exposes all your loneliness

The small red car carries you
Turning the corner far away
It disappeared from view from here

What did we lose? Even that
I don't understand, rolling, rolling
My heart ached even though I didn't have it from the beginning

Surely we will continue
Our hearts entwined, rolling, rolling
We started running as if rolling on the freezing world
`.trim()

/** Primary timed like a ~4:30 song with gaps between stanzas. */
export function buildAkfgPrimaryTimed(): TimedLine[] {
  const songStart = 12
  const songEnd = 272
  const duration = songEnd - songStart
  const weights = AKFG_JA_LINES.map((t) => Math.max(1, lineWeight(t, 'ja')))
  const total = weights.reduce((a, b) => a + b, 0)
  let cum = 0
  return AKFG_JA_LINES.map((original, i) => {
    cum += weights[i]
    const startFrac = (cum - weights[i]) / total
    const endFrac = cum / total
    return {
      original,
      translation: '',
      startTime: songStart + startFrac * duration,
      endTime: songStart + endFrac * duration,
    }
  })
}

/** Keyword signatures for mock semantic embedding (JA↔EN line pairing). */
const SIGNATURE_RULES: [RegExp, string][] = [
  [/世界を僕は塗り|if possible.*repaint the world/i, 'open-world'],
  [/戦争|eliminating wars/i, 'wars'],
  [/だけど|bit of that too/i, 'but-bit'],
  [/俳優|actor or a movie star/i, 'actor'],
  [/君の前|front of you/i, 'front-you'],
  [/術はない|no way for me/i, 'noway'],
  [/嗚呼/i, 'sigh'],
  [/何を間違|what did I do wrong/i, 'wrong-q'],
  [/わからない.*rolling|don't understand, rolling/i, 'rolling-q1'],
  [/初めから持ってない|didn't have it from the beginning/i, 'heartache1'],
  [/僕らはきっと|surely we will continue/i, 'continue1'],
  [/心絡|hearts entwined/i, 'entwined1'],
  [/凍てつく地面|freezing ground/i, 'run-ground'],
  [/理由もない|for no reason/i, 'sad-reason'],
  [/泣けや|can't cry/i, 'cant-cry'],
  [/温めるように歌|warm up such nights/i, 'sing-warm'],
  [/岩は転が|the rocks roll us/i, 'rocks-roll-main'],
  [/連れて行|taking us somewhere/i, 'take-somewhere'],
  [/the rocks roll us\s*\nas if taking us somewhere/i, 'rocks-bridge-merged'],
  [/命が芽生|life sprouted/i, 'life-sprout'],
  [/丘を越|beyond that hill/i, 'hill'],
  [/光輝|shining brightly/i, 'shine'],
  [/孤独.*朝|loneliness.*morning|morning that exposes/i, 'lonely-morning'],
  [/赤い.*車|red car carries/i, 'red-car'],
  [/角を曲|corner far away/i, 'corner'],
  [/見えなく|disappeared from view/i, 'disappeared'],
  [/何をなく|what did we lose/i, 'lose-q'],
  [/凍てつく世界|freezing world/i, 'run-world'],
]

export function akfgLineSignature(text: string): string {
  const hits = SIGNATURE_RULES.filter(([re]) => re.test(text)).map(([, k]) => k)
  if (hits.length) return hits.join('+')
  return text.trim().slice(0, 12)
}

/** Mock embedder: lines with overlapping signatures get similar vectors. */
export async function akfgEmbed(texts: string[]): Promise<number[][]> {
  const DIM = 48
  const bucket = new Map<string, number>()
  let next = 0
  const id = (sig: string) => {
    if (!bucket.has(sig)) bucket.set(sig, next++)
    return bucket.get(sig)!
  }
  return texts.map((t) => {
    const sig = akfgLineSignature(t)
    const b = id(sig)
    const v = new Array(DIM).fill(0)
    v[b % DIM] = 1
    v[(b * 5 + 11) % DIM] = 0.6
    v[(b * 7 + 3) % DIM] = 0.3
    return v
  })
}

/** Find primary row whose original contains `fragment`. */
export function rowForJa(lines: TimedLine[], fragment: string): TimedLine | undefined {
  return lines.find((l) => l.original.includes(fragment))
}

/** All rows whose translation contains `fragment` (case-insensitive). */
export function rowsForEn(lines: TimedLine[], fragment: string): TimedLine[] {
  const q = fragment.toLowerCase()
  return lines.filter((l) => l.translation.toLowerCase().includes(q))
}
