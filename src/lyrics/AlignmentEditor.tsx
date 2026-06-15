import { useState } from 'react'

interface Props {
  originalLines: string[]
  translationLines: string[]
  onConfirm: (pairs: Array<{ original: string; translation: string }>) => void
}

export function AlignmentEditor({ originalLines, translationLines, onConfirm }: Props) {
  const maxLen = Math.max(originalLines.length, translationLines.length)
  const [pairs, setPairs] = useState<Array<{ original: string; translation: string }>>(
    Array.from({ length: maxLen }, (_, i) => ({
      original: originalLines[i] ?? '',
      translation: translationLines[i] ?? '',
    }))
  )

  const updatePair = (i: number, field: 'original' | 'translation', value: string) => {
    setPairs((prev) => prev.map((p, j) => j === i ? { ...p, [field]: value } : p))
  }

  const addRow = () => setPairs((prev) => [...prev, { original: '', translation: '' }])
  const removeRow = (i: number) => setPairs((prev) => prev.filter((_, j) => j !== i))

  return (
    <div className="min-h-screen bg-cinnabar-950 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-white font-semibold">Align Lines</h2>
        <p className="text-white/40 text-xs">Line counts differ — fix pairings below</p>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs text-white/40 px-1">
        <span>Original</span>
        <span>Translation</span>
      </div>

      <div className="space-y-2 max-h-[60vh] overflow-y-auto">
        {pairs.map((pair, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
            <input
              value={pair.original}
              onChange={(e) => updatePair(i, 'original', e.target.value)}
              className="bg-cinnabar-900 text-white text-sm px-2 py-1 rounded-lg outline-none border border-cinnabar-800 focus:border-cinnabar-accent font-jp"
            />
            <input
              value={pair.translation}
              onChange={(e) => updatePair(i, 'translation', e.target.value)}
              className="bg-cinnabar-900 text-white text-sm px-2 py-1 rounded-lg outline-none border border-cinnabar-800 focus:border-cinnabar-accent"
            />
            <button onClick={() => removeRow(i)} className="text-red-400 text-xs hover:text-red-300">✕</button>
          </div>
        ))}
      </div>

      <button onClick={addRow} className="text-cinnabar-accent text-sm underline">+ Add line</button>

      <button
        onClick={() => onConfirm(pairs.filter((p) => p.original))}
        className="w-full py-3 bg-cinnabar-accent text-white rounded-xl font-medium"
      >
        Confirm Pairings
      </button>
    </div>
  )
}
