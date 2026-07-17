import { useEffect, useState } from 'react'
import type { Token } from '../core/types'
import { lookupWord, jishoSearchUrl, type WordLookupResult } from '../language/japanese/wordLookup'
import { useSettingsStore } from '../payment/SettingsStore'
import { LookupPopoverShell } from './LookupPopoverShell'

interface Props {
  token: Token
  anchorRect: DOMRect | null
  onClose: () => void
}

export function WordLookupPopover({ token, anchorRect, onClose }: Props) {
  const [resolved, setResolved] = useState<{ token: Token; result: WordLookupResult | null } | null>(null)
  const result: WordLookupResult | null | 'loading' = resolved && resolved.token === token ? resolved.result : 'loading'
  const readingMode = useSettingsStore((s) => s.readingMode)
  const immersion = useSettingsStore((s) => s.immersionDefinitions)

  useEffect(() => {
    let cancelled = false
    void lookupWord(token, readingMode, { immersion }).then((r) => { if (!cancelled) setResolved({ token, result: r }) })
    return () => { cancelled = true }
  }, [token, readingMode, immersion])

  useEffect(() => { if (result === null) onClose() }, [result, onClose])
  if (result === null) return null

  const loading = result === 'loading'
  const headword = loading ? token.surface : result.headword
  const reading = loading ? null : result.reading
  const pos = loading ? null : result.posLabel ?? result.pos
  const glosses = loading ? [] : result.glosses

  const externalLink = immersion
    ? { href: `https://www.weblio.jp/content/${encodeURIComponent(headword)}`, label: 'weblio 国語辞書 ↗' }
    : { href: jishoSearchUrl(headword), label: 'jisho.org ↗' }

  return (
    <LookupPopoverShell
      ariaLabel={`Dictionary entry for ${headword}`}
      anchorRect={anchorRect}
      externalLink={externalLink}
      onClose={onClose}
    >
      <div className="flex items-baseline gap-2 flex-wrap pr-9">
        <span lang="ja" className="font-jp text-lg font-semibold text-white">{headword}</span>
        {reading && reading !== headword && (
          <span lang="ja" className="font-jp text-sm text-cinnabar-accent/90">{reading}</span>
        )}
        {!loading && result.dictionaryReading && (
          <span lang="ja" className="font-jp text-xs text-white/40">dictionary: {result.dictionaryReading}</span>
        )}
        {pos && <span className="text-[10px] text-white/40">{pos}</span>}
      </div>
      {loading ? (
        <p className="text-xs text-white/40">Looking up…</p>
      ) : glosses.length > 0 ? (
        <p className="text-sm text-white/80 text-pretty">{glosses.join('; ')}</p>
      ) : result.dictionaryAvailable ? (
        <p className="text-xs text-white/40">No definition found.</p>
      ) : (
        <p className="text-xs text-white/40">Definitions unavailable.</p>
      )}
    </LookupPopoverShell>
  )
}
