import { LegalLinks } from '../core/ui/LegalLinks'

interface Props {
  onOpenApp: () => void
}

// Illustrative in-app snippet for the landing preview. The line is an invented,
// public-domain-safe example (「今日は雪が降る」 — "today snow falls"), NOT from any
// real song. Each content word shares one colour with its English gloss chip; the
// hues are distinct from the cinnabar accent red so they don't read as the CTA.
const PREVIEW_WORDS = [
  { base: '今日', reading: 'きょう', gloss: 'today', color: '#38bdf8' }, // sky blue
  { base: '雪', reading: 'ゆき', gloss: 'snow', color: '#4ade80' }, //  green
  { base: '降', tail: 'る', reading: 'ふ', gloss: 'falls', color: '#fbbf24' }, // amber
]

const FEATURES = [
  {
    badge: '01',
    title: 'Auto alignment',
    body: 'On-device speech recognition times every lyric line to the audio — no tapping along. Repeated choruses and dropped syllables are handled automatically.',
    glyph: '◷',
  },
  {
    badge: '02',
    title: 'Furigana readings',
    body: 'Dictionary furigana on every kanji, then checked against how the singer actually pronounces each word — so you read what you hear.',
    glyph: 'ふ',
  },
  {
    badge: '03',
    title: 'Word pairing',
    body: 'Each Japanese word is colour-matched to its English counterpart, so you can see exactly which part means what — even when Japanese and English put words in opposite order.',
    glyph: '⇄',
  },
]

export function LandingScreen({ onOpenApp }: Props) {
  return (
    <div className="h-[100dvh] overflow-y-auto bg-cinnabar-950 text-white">
      <div className="w-full max-w-2xl mx-auto px-5 pb-16">
        <header className="flex items-center justify-between py-5">
          <span className="text-cinnabar-accent font-semibold tracking-widest text-lg">歌sync</span>
          <button
            type="button"
            onClick={onOpenApp}
            className="min-h-11 px-3 text-white/45 hover:text-white text-xs touch-manipulation transition-colors duration-150 ease-out"
          >
            Open the app →
          </button>
        </header>

        {/* Hero */}
        <section className="pt-10 pb-12 animate-[progress-enter_260ms_ease-out_both]">
          <p className="text-[11px] uppercase tracking-[0.2em] text-cinnabar-accent/80 mb-4">
            Study Japanese songs
          </p>
          <h1 className="text-3xl sm:text-4xl font-semibold leading-tight text-balance">
            Turn any song into a lyric study session.
          </h1>
          <p className="mt-4 text-white/60 text-base text-pretty leading-relaxed max-w-lg">
            Utasync syncs lyrics to the audio, adds furigana the way the singer actually sings them,
            and pairs every word with its translation — all on your device.
          </p>
          <div className="mt-8">
            <button
              type="button"
              onClick={onOpenApp}
              className="min-h-12 px-6 rounded-xl bg-cinnabar-accent hover:bg-cinnabar-accent/90 text-white font-semibold text-sm flex items-center gap-2 touch-manipulation shadow-lg shadow-cinnabar-accent/20 transition-[background-color,transform] duration-150 ease-out active:scale-[0.97]"
            >
              Get started →
            </button>
          </div>
        </section>

        {/* In-app preview — illustrative snippet of a synced lyric line. Decorative:
            the feature cards below convey the same ideas as real text, so the whole
            mock is aria-hidden (ruby readings would be announced awkwardly otherwise). */}
        <section
          aria-hidden="true"
          className="mb-10 rounded-2xl border border-cinnabar-900 bg-gradient-to-b from-cinnabar-900/45 to-cinnabar-950 p-5 sm:p-6 shadow-lg shadow-black/20"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-[0.2em] text-white/30">Preview</span>
            <span className="flex items-center gap-1.5 text-[10px] text-white/30">
              <span className="w-1.5 h-1.5 rounded-full bg-cinnabar-accent/70" />
              Synced line
            </span>
          </div>

          {/* Japanese line: real HTML ruby furigana + colour-paired content words. */}
          <p className="font-jp furigana-text mt-5 flex flex-wrap items-end gap-x-1.5 gap-y-3 text-2xl sm:text-3xl leading-loose text-white">
            {PREVIEW_WORDS.map((w, i) => (
              <span key={w.gloss} className="contents">
                <span
                  className="pb-0.5"
                  style={{ borderBottom: `2px solid ${w.color}` }}
                >
                  <ruby>
                    {w.base}
                    <rt>{w.reading}</rt>
                  </ruby>
                  {w.tail}
                </span>
                {/* grammatical particles, rendered muted like the real app */}
                {i === 0 && <span className="text-white/40">は</span>}
                {i === 1 && <span className="text-white/40">が</span>}
              </span>
            ))}
          </p>

          {/* Colour-matched word → English gloss chips. */}
          <div className="mt-5 flex flex-wrap gap-2">
            {PREVIEW_WORDS.map((w) => (
              <span
                key={w.gloss}
                className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium"
                style={{
                  color: w.color,
                  borderColor: `${w.color}59`,
                  backgroundColor: `${w.color}14`,
                }}
              >
                {w.gloss}
              </span>
            ))}
          </div>
        </section>

        {/* Feature blocks */}
        <section className="grid gap-3 sm:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.badge}
              className="rounded-2xl border border-cinnabar-900 bg-cinnabar-900/40 p-5 transition-colors duration-150 ease-out hover:border-cinnabar-800"
            >
              <div className="w-10 h-10 rounded-xl bg-cinnabar-950 border border-cinnabar-800 flex items-center justify-center text-cinnabar-accent text-lg mb-4">
                {f.glyph}
              </div>
              <p className="text-[10px] uppercase tracking-wide text-white/30 tabular-nums">{f.badge}</p>
              <h2 className="mt-1 text-base font-semibold text-balance">{f.title}</h2>
              <p className="mt-2 text-white/55 text-[13px] text-pretty leading-relaxed">{f.body}</p>
            </div>
          ))}
        </section>

        {/* Closing CTA */}
        <section className="mt-12 rounded-2xl border border-cinnabar-900 bg-gradient-to-b from-cinnabar-900/50 to-cinnabar-950 p-6 text-center">
          <h2 className="text-lg font-semibold text-balance">Ready to study your favourite song?</h2>
          <p className="mt-2 text-white/55 text-sm text-pretty max-w-md mx-auto">
            Add any song with a YouTube link or a local audio file and let Utasync do the rest.
          </p>
          <button
            type="button"
            onClick={onOpenApp}
            className="mt-5 min-h-12 px-6 rounded-xl bg-cinnabar-accent hover:bg-cinnabar-accent/90 text-white font-semibold text-sm touch-manipulation shadow-lg shadow-cinnabar-accent/20 transition-[background-color,transform] duration-150 ease-out active:scale-[0.97]"
          >
            Open the app
          </button>
        </section>

        <footer className="mt-10 text-center">
          <p className="text-[11px] text-white/45 text-pretty">
            Runs entirely in your browser. Audio streams from YouTube — nothing is uploaded.
          </p>
          <LegalLinks className="mt-3" />
        </footer>
      </div>
    </div>
  )
}
