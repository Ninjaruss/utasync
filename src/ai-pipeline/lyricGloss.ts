/**
 * Lyric word-pair gloss lexicon: JMdict (comprehensive, lazy-loaded) plus
 * curated overrides for poetic/non-literal translations JMdict cannot cover.
 */

import { morphGlossMatches, type GlossSource } from './morphGloss'
import { dictKeysMatchingStem, inflectionStemCandidates, stemLookupMatchesTarget } from './stemLookup'
import { englishGlossVariants, normalizeLemmaGloss } from './glossNormalize'
import { homographLemmaGloss, homographLemmaKeys } from './homographGloss'
import { runWhenIdle } from '../core/idle'
import {
  getJmdictKanjiRomaji,
  getJmdictRomajiGloss,
  jmdictLemmaKeysForStem,
  prepareJmdictStemIndex,
} from './jmdictGloss'

/**
 * Curated romaji → English glosses. These override JMdict when both define a
 * key — use for poetic aliases (長い→endless), song-specific readings, etc.
 */
export const ROMAJI_GLOSS: Record<string, string> = {
  ai: 'love',
  anata: 'you',
  aozora: 'sky',
  arigatou: 'thank',
  ashita: 'tomorrow',
  atsui: 'hot',
  boku: 'i',
  chikai: 'near',
  chikau: 'promise',
  chizu: 'map',
  dare: 'who',
  dake: 'only',
  eien: 'forever',
  fuyu: 'winter',
  haato: 'heart',
  hana: 'flower',
  hanabi: 'fireworks',
  hikari: 'light',
  hitori: 'alone',
  hoshi: 'star',
  ichiban: 'best',
  itsuka: 'someday',
  itsumo: 'always',
  atashi: 'i',
  ichi: 'one',
  ho: 'step',
  ippo: 'step',
  okure: 'behind',
  toori: 'same',
  sunzen: 'verge',
  bakuhatsu: 'exploding',
  nozoki: 'peek',
  nozokikomare: 'peek',
  suberikomu: 'slide',
  tonariawase: 'adjacent',
  mayoigo: 'stray',
  koyuki: 'snowflake',
  shisen: 'looking',
  komaru: 'trouble',
  furikaeru: 'turning',
  tentou: 'fall',
  koigokoro: 'love',
  senaka: 'back',
  suberidasu: 'slipping',
  awate: 'rush',
  oikakeru: 'after',
  susumu: 'time',
  dou: 'what',
  doushita: 'what',
  koto: 'about',
  kaze: 'wind',
  kibou: 'hope',
  asa: 'morning',
  iwa: 'rock',
  korogaru: 'roll',
  nurikae: 'repaint',
  kimi: 'you',
  kitto: 'surely',
  kokoro: 'heart',
  koi: 'love',
  koe: 'voice',
  koyou: 'come',
  kumo: 'cloud',
  kyou: 'today',
  kuru: 'come',
  machi: 'town',
  mada: 'still',
  mae: 'before',
  mata: 'back',
  michi: 'road',
  mirai: 'future',
  mizu: 'water',
  mou: 'already',
  mune: 'heart',
  itan: 'ached',
  itai: 'ached',
  namida: 'tear',
  natsu: 'summer',
  nee: 'hey',
  nemuru: 'sleep',
  niji: 'rainbow',
  oboeru: 'remember',
  omoide: 'memory',
  omoi: 'thought',
  omou: 'think',
  owaru: 'end',
  renai: 'love',
  rooringu: 'rolling',
  rolling: 'rolling',
  saku: 'bloom',
  samui: 'cold',
  sayonara: 'goodbye',
  sekai: 'world',
  sora: 'sky',
  subete: 'everything',
  suki: 'like',
  tabun: 'maybe',
  taiyou: 'sun',
  toke: 'melt',
  toki: 'time',
  tonari: 'next',
  tomodachi: 'friend',
  tsuki: 'moon',
  tsuyoi: 'strong',
  uta: 'song',
  utau: 'sing',
  watashi: 'i',
  yasashii: 'gentle',
  yoru: 'night',
  yowai: 'weak',
  yoko: 'beside',
  yume: 'dream',
  zutto: 'forever',
  nakusu: 'eliminating',
  chotto: 'bit',
  doko: 'somewhere',
  mebae: 'sprouted',
  abakidasu: 'exposes',
  bokutachi: 'us',
  bokura: 'we',
  chuu: 'sky',
  donnani: 'matter',
  miseru: 'show',
  noni: 'although',
  kotoba: 'words',
  suku: 'save',
  sukue: 'save',
  sukunai: 'cannot',
  mogaku: 'struggles',
  wakachi: 'share',
  hanare: 'released',
  kizuku: 'notice',
  fue: 'increase',
  osamara: 'held',
  mukou: 'beyond',
  aeru: 'meet',
  iro: 'color',
  omo: 'think',
  katado: 'reification',
  fukou: 'misfortune',
  tasukeru: 'save',
}

/** Kanji surface → romaji when kuromoji omits reading (common lyric characters). */
export const KANJI_ROMAJI: Record<string, string> = {
  愛: 'ai',
  君: 'kimi',
  心: 'kokoro',
  星: 'hoshi',
  空: 'sora',
  青空: 'aozora',
  夢: 'yume',
  光: 'hikari',
  風: 'kaze',
  花: 'hana',
  月: 'tsuki',
  夜: 'yoru',
  声: 'koe',
  恋: 'koi',
  長: 'nagai',
  時: 'toki',
  道: 'michi',
  未来: 'mirai',
  記憶: 'memory',
  涙: 'namida',
  笑: 'warai',
  恋愛: 'renai',
  隣: 'tonari',
  一歩: 'ippo',
  世界: 'sekai',
  岩: 'iwa',
  塗: 'nurikae',
  塗り: 'nurikae',
  胸: 'mune',
  朝: 'asa',
  転がる: 'korogaru',
  ローリング: 'rooringu',
  寸前: 'sunzen',
  爆発: 'bakuhatsu',
  覗き: 'nozoki',
  覗き込まれ: 'nozokikomare',
  滑り込む: 'suberikomu',
  隣り合わせ: 'tonariawase',
  ハート: 'haato',
  視線: 'shisen',
  困る: 'komaru',
  迷い子: 'mayoigo',
  粉雪: 'koyuki',
  滑り出す: 'suberidasu',
  慌て: 'awate',
  追いかける: 'oikakeru',
  振り返る: 'furikaeru',
  転倒: 'tentou',
  恋心: 'koigokoro',
  背中: 'senaka',
  進む: 'susumu',
  溶け: 'toke',
  進ん: 'susumu',
  来よ: 'koyou',
  どう: 'dou',
  どうした: 'doushita',
  事: 'koto',
  僕たち: 'bokutachi',
  宙: 'chuu',
  言葉: 'kotoba',
  救: 'suku',
  指: 'yubi',
}

/**
 * English words that often translate a gloss entry poetically (e.g. 長い → "endless").
 * Maps lowercase EN → romaji gloss key for exact-match scoring.
 */
export const EN_POETIC_ALIASES: Record<string, string> = {
  endless: 'nagai',
  eternal: 'eien',
  eternity: 'eien',
  forever: 'eien',
  always: 'itsumo',
  back: 'mata',
  beside: 'yoko',
  come: 'koyou',
  definitely: 'kitto',
  maybe: 'tabun',
  only: 'dake',
  repainted: 'nurikae',
  repaint: 'nurikae',
  rock: 'iwa',
  rocks: 'iwa',
  rolling: 'korogaru',
  roll: 'korogaru',
  world: 'sekai',
  morning: 'asa',
  behind: 'okure',
  same: 'toori',
  step: 'ippo',
  me: 'atashi',
  perhaps: 'tabun',
  gently: 'yasashii',
  kindness: 'yasashii',
  tender: 'yasashii',
  alone: 'hitori',
  lonely: 'hitori',
  solitude: 'hitori',
  shine: 'kagayaku',
  shining: 'kagayaku',
  bright: 'hikari',
  glow: 'hikari',
  bloom: 'saku',
  blossom: 'saku',
  remember: 'oboeru',
  memories: 'omoide',
  memory: 'omoide',
  melt: 'toke',
  next: 'tonari',
  thought: 'omoi',
  thinking: 'omou',
  ending: 'owaru',
  goodbye: 'sayonara',
  farewell: 'sayonara',
  ache: 'itan',
  ached: 'itan',
  hearts: 'haato',
  thanks: 'thank',
  grateful: 'thank',
  sweetheart: 'koi',
  darling: 'koi',
  beloved: 'ai',
  tears: 'namida',
  tear: 'namida',
  verge: 'sunzen',
  exploding: 'bakuhatsu',
  explode: 'bakuhatsu',
  peeks: 'nozokikomare',
  peek: 'nozoki',
  peeking: 'nozokikomare',
  slide: 'suberikomu',
  sliding: 'suberidasu',
  adjacent: 'tonariawase',
  stray: 'mayoigo',
  snowflake: 'koyuki',
  powder: 'koyuki',
  looking: 'shisen',
  trouble: 'komaru',
  turning: 'furikaeru',
  fall: 'tentou',
  falling: 'tentou',
  slipping: 'suberidasu',
  rush: 'awate',
  rushing: 'awate',
  after: 'oikakeru',
  okay: 'daijoubu',
  dissolving: 'toke',
  melting: 'toke',
  time: 'susumu',
  what: 'dou',
  up: 'dou',
  your: 'kimi',
  about: 'koto',
  god: 'dou',
  eliminate: 'nakusu',
  eliminating: 'nakusu',
  somewhere: 'doko',
  where: 'doko',
  sprout: 'mebae',
  sprouted: 'mebae',
  sprouting: 'mebae',
  expose: 'abakidasu',
  exposes: 'abakidasu',
  exposing: 'abakidasu',
  us: 'bokutachi',
  we: 'bokutachi',
  matter: 'donnani',
  show: 'miseru',
  although: 'noni',
  though: 'noni',
  even: 'temo',
  from: 'kara',
  because: 'kara',
  since: 'kara',
  until: 'made',
  than: 'yori',
  want: 'itai',
  keep: 'itai',
  without: 'naide',
  wonder: 'kana',
  probably: 'darou',
  words: 'kotoba',
  word: 'kotoba',
  dreaming: 'yume',
  'mid-air': 'chuu',
  mid: 'chuu',
  save: 'sukue',
  struggles: 'mogaku',
  struggle: 'mogaku',
  share: 'wakachi',
  released: 'hanare',
  notice: 'kizuku',
  increase: 'fue',
  held: 'osamara',
  beyond: 'mukou',
  meet: 'aeru',
  know: 'shiri',
  color: 'iro',
  surely: 'darou',
  finger: 'yubi',
  solemn: 'warae',
  reification: 'katado',
  misfortune: 'fukou',
  untouchable: 'furenai',
  every: 'futo',
}

/** Additional EN→romaji aliases (multiple romaji may map to the same English word). */
const EN_POETIC_ALIASES_EXTRA: Array<[string, string]> = [
  ['about', 'sunzen'],
  ['memories', 'omoi'],
  ['untouchable', 'fure'],
  ['unsalvageable', 'tasukeru'],
  ['released', 'hanareru'],
  ['held', 'osamaru'],
]

/** Reverse lookup: English target word → set of romaji keys that gloss to it. */
const EN_TO_ROMAJI = new Map<string, Set<string>>()
let enToRomajiBuilt = false

function addEnToRomaji(romaji: string, english: string): void {
  const key = english.toLowerCase()
  if (!EN_TO_ROMAJI.has(key)) EN_TO_ROMAJI.set(key, new Set())
  EN_TO_ROMAJI.get(key)!.add(romaji)
}

function buildEnToRomaji(): void {
  if (enToRomajiBuilt) return
  for (const [romaji, english] of Object.entries(ROMAJI_GLOSS)) {
    addEnToRomaji(romaji, english)
  }
  for (const [english, romaji] of Object.entries(EN_POETIC_ALIASES)) {
    addEnToRomaji(romaji, english)
  }
  for (const [english, romaji] of EN_POETIC_ALIASES_EXTRA) {
    addEnToRomaji(romaji, english)
  }
  enToRomajiBuilt = true
}

/** Loads JMdict gloss data and rebuilds reverse indexes. Call before word pairing. */
export async function ensureGlossLexicon(): Promise<void> {
  await prepareJmdictStemIndex()
  enToRomajiBuilt = false
  buildEnToRomaji()
}

/** Low-priority warm-up — fetches jmdict-gloss.json when the browser is idle. */
export function preloadGlossLexicon(): void {
  runWhenIdle(() => {
    void ensureGlossLexicon()
  }, 8000)
}

/** Curated override first, then JMdict (with US spelling normalization). */
function dictionaryGlossForKey(key: string): string | undefined {
  const curated = ROMAJI_GLOSS[key.trim().toLowerCase()]
  if (curated) return curated
  const jm = getJmdictRomajiGloss(key)
  if (jm) return normalizeLemmaGloss(jm)
  return undefined
}

/** Curated override first, then JMdict, then homograph + inflection stem inference. */
export function lemmaGloss(romaji: string, surface?: string): string | undefined {
  const r = romaji.trim().toLowerCase()
  if (!r) return undefined

  const homograph = homographLemmaGloss(surface, r, { glossForKey: dictionaryGlossForKey })
  if (homograph) return homograph

  const direct = dictionaryGlossForKey(r)
  if (direct) return direct

  for (const key of homographLemmaKeys(surface, r)) {
    const gloss = dictionaryGlossForKey(key)
    if (gloss) return gloss
  }

  for (const stem of inflectionStemCandidates(r, 2)) {
    const stemHomograph = homographLemmaGloss(surface, stem, { glossForKey: dictionaryGlossForKey })
    if (stemHomograph) return stemHomograph

    const stemGloss = dictionaryGlossForKey(stem)
    if (stemGloss) return stemGloss

    for (const key of homographLemmaKeys(surface, stem)) {
      const gloss = dictionaryGlossForKey(key)
      if (gloss) return gloss
    }

    for (const key of dictKeysMatchingStem(stem, jmdictLemmaKeysForStem(stem))) {
      const gloss = dictionaryGlossForKey(key)
      if (gloss) return gloss
    }
  }

  return undefined
}

/** Curated kanji map first, then JMdict. */
export function kanjiLemmaRomaji(surface: string): string | undefined {
  const s = surface.trim()
  return KANJI_ROMAJI[s] ?? getJmdictKanjiRomaji(s)
}

/** True when romaji glosses to the English target (direct, poetic, or morphological). */
export function glossMatchesTarget(romaji: string, targetWord: string, surface?: string): boolean {
  return glossMatchesSource({ romaji, surface }, targetWord)
}

function glossEqualsTarget(gloss: string | undefined, target: string): boolean {
  if (!gloss) return false
  const g = gloss.trim().toLowerCase()
  if (g === target) return true
  return normalizeLemmaGloss(g) === target
}

/** Like `glossMatchesTarget` but accepts merged surface for morphology rules. */
export function glossMatchesSource(source: GlossSource, targetWord: string): boolean {
  buildEnToRomaji()
  const r = source.romaji.trim().toLowerCase()
  const surface = source.surface

  const stemCtx = {
    glossForKey: (key: string) => dictionaryGlossForKey(key),
    aliasKeysForTarget: (target: string) => EN_TO_ROMAJI.get(target.trim().toLowerCase()),
    lemmaKeysForStem: (stem: string) => {
      const keys = new Set<string>(Object.keys(ROMAJI_GLOSS))
      for (const key of jmdictLemmaKeysForStem(stem)) keys.add(key)
      return keys
    },
  }

  for (const variant of englishGlossVariants(targetWord)) {
    if (glossEqualsTarget(lemmaGloss(r, surface), variant)) return true
    const aliasRomaji = EN_POETIC_ALIASES[variant]
    if (aliasRomaji && aliasRomaji === r) return true
    const romajiSet = EN_TO_ROMAJI.get(variant)
    if (romajiSet?.has(r)) return true
    if (morphGlossMatches(source, variant)) return true
    if (stemLookupMatchesTarget(r, variant, stemCtx, surface)) return true
  }
  return false
}

/** Romaji keys that share the same English gloss as `romaji`. */
export function glossClusterRomaji(romaji: string, surface?: string): string[] {
  buildEnToRomaji()
  const r = romaji.trim().toLowerCase()
  const english = lemmaGloss(r, surface)
  if (!english) return [r]
  const cluster = EN_TO_ROMAJI.get(english.toLowerCase())
  return cluster ? [...cluster] : [r]
}

/** True when two romaji strings share the same English gloss cluster. */
export function romajiShareGloss(a: string, b: string): boolean {
  const cluster = new Set(glossClusterRomaji(a))
  return cluster.has(b.trim().toLowerCase())
}
