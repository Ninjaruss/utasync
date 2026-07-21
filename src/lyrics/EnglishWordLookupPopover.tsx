import { useEffect, useState } from 'react'
import { lookupEnglishWord, jishoSearchUrl, type EnWordLookupResult } from '../language/english/wordLookupEn'
import { useSettingsStore } from '../payment/SettingsStore'
import { LookupPopoverShell } from './LookupPopoverShell'

interface Props {
  word: string
  anchorRect: DOMRect | null
  onClose: () => void
}

export function EnglishWordLookupPopover({ word, anchorRect, onClose }: Props) {
  const [resolved, setResolved] = useState<{ word: string; result: EnWordLookupResult | null } | null>(null)
  const result: EnWordLookupResult | null | 'loading' = resolved && resolved.word === word ? resolved.result : 'loading'

  const immersion = useSettingsStore((s) => s.immersionDefinitions)

  useEffect(() => {
    let cancelled = false
    void lookupEnglishWord(word, { immersion }).then((r) => { if (!cancelled) setResolved({ word, result: r }) })
    return () => { cancelled = true }
  }, [word, immersion])

  useEffect(() => { if (result === null) onClose() }, [result, onClose])
  if (result === null) return null

  const loading = result === 'loading'
  const headword = loading ? word : result.headword
  const equivalents = loading ? [] : result.equivalents
  const definitions = loading ? [] : result.definitions
  const isJa = !loading && result.definitionLang === 'ja'

  return (
    <LookupPopoverShell
      ariaLabel={`Dictionary entry for ${headword}`}
      anchorRect={anchorRect}
      externalLink={{ href: jishoSearchUrl(headword), label: 'jisho.org ↗' }}
      onClose={onClose}
    >
      <div className="flex items-baseline gap-2 flex-wrap pr-9">
        <span lang="en" className="text-lg font-semibold text-white">{headword}</span>
      </div>
      {loading ? (
        <p className="text-xs text-white/40">Looking up…</p>
      ) : isJa ? (
        equivalents.length > 0 ? (
          <ul className="space-y-0.5">
            {equivalents.map((e, i) => (
              <li key={i} lang="ja" className="font-jp text-sm text-white/80">
                {e.ja}{e.reading && e.reading !== e.ja ? <span className="text-cinnabar-accent/80 text-xs ml-1">{e.reading}</span> : null}
              </li>
            ))}
          </ul>
        ) : result.dictionaryAvailable ? (
          <p className="text-xs text-white/40">No definition found.</p>
        ) : (
          <p className="text-xs text-white/40">Definitions unavailable.</p>
        )
      ) : definitions.length > 0 ? (
        <p lang="en" className="text-sm text-white/80 text-pretty">{definitions.join('; ')}</p>
      ) : result.dictionaryAvailable ? (
        <p className="text-xs text-white/40">No definition found.</p>
      ) : (
        <p className="text-xs text-white/40">Definitions unavailable.</p>
      )}
    </LookupPopoverShell>
  )
}
