import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EditMode } from '../../src/lyrics/EditMode'
import type { TimedLine } from '../../src/core/types'

const lines: TimedLine[] = [
  { startTime: 0, endTime: 2, original: 'a', translation: '' },
  { startTime: 0, endTime: 0, original: 'b', translation: '' }, // untimed
]

function renderEditMode(overrides: Partial<Parameters<typeof EditMode>[0]> = {}) {
  const onChangeLines = vi.fn()
  const onAutoAlign = vi.fn()
  const utils = render(
    <EditMode
      lines={lines}
      playhead={() => 9}
      hasLocalAudio
      onChangeLines={onChangeLines}
      onAutoAlign={onAutoAlign}
      title="t"
      artist="a"
      sourceLanguage="ja"
      {...overrides}
    />,
  )
  return { onChangeLines, onAutoAlign, ...utils }
}

describe('EditMode', () => {
  it('tapping the timestamp pill opens a popover instead of stamping', () => {
    const { onChangeLines } = renderEditMode()
    fireEvent.click(screen.getByRole('button', { name: /edit timestamp for line 2/i }))
    expect(onChangeLines).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Scrub start timestamp')).toBeTruthy()
  })

  it('committing the popover stamps the chosen time', () => {
    const { onChangeLines } = renderEditMode()
    fireEvent.click(screen.getByRole('button', { name: /edit timestamp for line 2/i }))
    fireEvent.change(screen.getByLabelText('Scrub start timestamp'), { target: { value: '9' } })
    fireEvent.click(screen.getByText('Done'))
    const next = onChangeLines.mock.calls[0][0] as TimedLine[]
    expect(next[1].startTime).toBe(9)
  })

  it('committing an end anchor from the popover stamps endTime', () => {
    const { onChangeLines } = renderEditMode()
    fireEvent.click(screen.getByRole('button', { name: /edit timestamp for line 1/i }))
    fireEvent.click(screen.getByRole('tab', { name: 'End' }))
    fireEvent.change(screen.getByLabelText('Scrub end timestamp'), { target: { value: '3.5' } })
    fireEvent.click(screen.getByText('Done'))
    const next = onChangeLines.mock.calls[0][0] as TimedLine[]
    expect(next[0]).toMatchObject({ startTime: 0, endTime: 3.5 })
  })

  it('dismissing the popover does not stamp and reverts the preview position', () => {
    const seek = vi.fn()
    const onScrubEnd = vi.fn()
    const { onChangeLines } = renderEditMode({ seek, onScrubStart: vi.fn(), onScrubEnd, playhead: () => 4 })
    fireEvent.click(screen.getByRole('button', { name: /edit timestamp for line 2/i }))
    fireEvent.change(screen.getByLabelText('Scrub start timestamp'), { target: { value: '9' } })
    expect(seek).toHaveBeenCalledWith(9)
    const list = screen.getByLabelText('Lyric lines')
    fireEvent.click(list)
    expect(onChangeLines).not.toHaveBeenCalled()
    expect(seek).toHaveBeenLastCalledWith(4)
    expect(onScrubEnd).toHaveBeenCalled()
    expect(screen.queryByLabelText('Scrub start timestamp')).toBeNull()
  })

  it('tapping another lyric cancels an open timestamp preview', () => {
    const seek = vi.fn()
    const onScrubEnd = vi.fn()
    renderEditMode({ seek, onScrubStart: vi.fn(), onScrubEnd, playhead: () => 4 })
    fireEvent.click(screen.getByRole('button', { name: /edit timestamp for line 2/i }))
    fireEvent.change(screen.getByLabelText('Scrub start timestamp'), { target: { value: '9' } })
    fireEvent.click(screen.getByText('a'))
    expect(seek).toHaveBeenCalledWith(4)
    expect(onScrubEnd).toHaveBeenCalled()
    expect(screen.queryByLabelText('Scrub start timestamp')).toBeNull()
    expect(screen.getByLabelText('Original text')).toBeTruthy()
  })

  it('opens inline editing (does NOT stamp) when the lyric text is tapped', () => {
    const { onChangeLines } = renderEditMode()
    fireEvent.click(screen.getByText('b'))
    expect(onChangeLines).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Original text')).toBeTruthy()
  })

  it('commits text on blur, not on every keystroke', () => {
    const { onChangeLines } = renderEditMode()
    fireEvent.click(screen.getByText('b'))
    const input = screen.getByLabelText('Original text')
    fireEvent.change(input, { target: { value: 'bb' } })
    expect(onChangeLines).not.toHaveBeenCalled()
    fireEvent.blur(input)
    const next = onChangeLines.mock.calls[0][0] as TimedLine[]
    expect(next[1].original).toBe('bb')
  })

  it('shows add/delete icons only while editing', () => {
    renderEditMode()
    expect(screen.queryByLabelText('Delete line 2')).toBeNull()
    fireEvent.click(screen.getByText('b'))
    expect(screen.getByLabelText('Delete line 2')).toBeTruthy()
    expect(screen.getByLabelText('Add line after 2')).toBeTruthy()
  })

  it('requires two taps to delete a line', () => {
    const { onChangeLines } = renderEditMode()
    fireEvent.click(screen.getByText('b'))
    fireEvent.click(screen.getByLabelText('Delete line 2'))
    expect(onChangeLines).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Confirm delete line 2')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Confirm delete line 2'))
    const next = onChangeLines.mock.calls[0][0] as TimedLine[]
    expect(next.length).toBe(1)
  })

  it('shows Auto-align only when audio is available, with a confirm dialog before triggering it', () => {
    const { onAutoAlign } = renderEditMode()
    fireEvent.click(screen.getByRole('button', { name: /auto-align/i }))
    expect(onAutoAlign).not.toHaveBeenCalled()
    expect(screen.getByText(/replaces timing for all 2 lines/i)).toBeTruthy()
    // Sets the expectation that this is a slow operation, not an instant toggle.
    expect(screen.getByText(/takes a few minutes/i)).toBeTruthy()
    fireEvent.click(screen.getByText('Continue'))
    expect(onAutoAlign).toHaveBeenCalled()
  })

  it('shows a local-audio hint instead of Auto-align when hasLocalAudio is false', () => {
    renderEditMode({ hasLocalAudio: false })
    expect(screen.queryByRole('button', { name: /auto-align/i })).toBeNull()
    expect(screen.getByText(/tap-through to time lyrics/i)).toBeTruthy()
  })

  it('marks untimed lines', () => {
    renderEditMode()
    expect(screen.getByText(/untimed/i)).toBeTruthy()
  })

  it('shows alignment quality warnings for auto-aligned rows', () => {
    renderEditMode({
      lineAlignmentQuality: ['good', 'needs_review'],
      showAlignmentQuality: true,
    })
    expect(screen.getAllByText(/off-timing/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/1.*off-timing/i)).toBeTruthy()
  })

  it('hides alignment quality badges when showAlignmentQuality is false', () => {
    renderEditMode({
      lineAlignmentQuality: ['needs_review', 'needs_review'],
      showAlignmentQuality: false,
    })
    expect(screen.queryByText(/timing approximate/i)).toBeNull()
  })

  // Round-6 honest banner (diagnosis H4): approximate lines squashed below the
  // compression threshold of their sung floor are visibly mistimed — the
  // banner must own them, not just needs_review rows.
  it('banner counts approximate lines squashed below their sung floor as off-timing', () => {
    const squashed: TimedLine[] = [
      { startTime: 0, endTime: 5, original: 'a good line here', translation: '' },
      // ~50 normalized glyphs -> 4.5s floor; 0.2s is far below 0.55x that.
      {
        startTime: 5,
        endTime: 5.2,
        original: 'a very long lyric line that can not possibly be sung in a blink',
        translation: '',
      },
    ]
    renderEditMode({
      lines: squashed,
      lineAlignmentQuality: ['good', 'approximate'],
      showAlignmentQuality: true,
    })
    expect(screen.getByText(/1.*off-timing/i)).toBeTruthy()
  })

  it('banner does not count approximate lines with a plausible duration', () => {
    const healthy: TimedLine[] = [
      { startTime: 0, endTime: 5, original: 'a good line here', translation: '' },
      {
        startTime: 5,
        endTime: 11,
        original: 'a very long lyric line that can not possibly be sung in a blink',
        translation: '',
      },
    ]
    renderEditMode({
      lines: healthy,
      lineAlignmentQuality: ['good', 'approximate'],
      showAlignmentQuality: true,
    })
    expect(screen.queryByText(/off-timing/i)).toBeNull()
  })

  // Round-6 A2b: a mixed-language song aligned before the current pipeline
  // version can't be repaired by the single-pass re-refine — surface a
  // re-run-Auto-align recommendation.
  it('shows a re-align recommendation for a stale mixed-language song', () => {
    renderEditMode({ needsMixedRealign: true })
    expect(screen.getByText(/mixed-language song.*re-run Auto-align/i)).toBeTruthy()
  })

  it('hides the mixed re-align recommendation by default', () => {
    renderEditMode()
    expect(screen.queryByText(/mixed-language song/i)).toBeNull()
  })

  it('opens the second-language panel from the More menu', async () => {
    renderEditMode()
    fireEvent.click(screen.getByRole('button', { name: /more/i }))
    fireEvent.click(screen.getByRole('button', { name: /translation/i }))
    expect(await screen.findByRole('heading', { name: /second language/i })).toBeTruthy()
  })

  it('pauses playback when opening the second-language panel', async () => {
    const onPausePlayback = vi.fn()
    renderEditMode({ onPausePlayback })
    fireEvent.click(screen.getByRole('button', { name: /more/i }))
    fireEvent.click(screen.getByRole('button', { name: /translation/i }))
    expect(onPausePlayback).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('heading', { name: /second language/i })).toBeTruthy()
  })

  it('does not clobber an in-progress draft when lines change externally while editing', () => {
    const { rerender } = renderEditMode()
    fireEvent.click(screen.getByText('b'))
    const input = screen.getByLabelText('Original text') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'draft in progress' } })
    expect(input.value).toBe('draft in progress')

    // Simulate an external lines update (e.g. SecondLanguagePanel.onApply) while
    // this row is still being edited — its translation changes but original stays.
    const updatedLines: TimedLine[] = [
      lines[0],
      { ...lines[1], translation: 'new translation from elsewhere' },
    ]
    rerender(
      <EditMode
        lines={updatedLines}
        playhead={() => 9}
        hasLocalAudio
        onChangeLines={vi.fn()}
        onAutoAlign={vi.fn()}
        title="t"
        artist="a"
        sourceLanguage="ja"
      />,
    )

    expect((screen.getByLabelText('Original text') as HTMLInputElement).value).toBe('draft in progress')
  })

  it('requires a fresh tap to re-arm delete after switching to a different row', () => {
    renderEditMode()
    // Arm delete on line 2 ("b").
    fireEvent.click(screen.getByText('b'))
    fireEvent.click(screen.getByLabelText('Delete line 2'))
    expect(screen.getByLabelText('Confirm delete line 2')).toBeTruthy()

    // Switch to editing line 1 ("a") instead, within the confirm window.
    fireEvent.click(screen.getByText('a'))

    // Switch back to line 2 — it should require a fresh tap, not show Confirm? immediately.
    fireEvent.click(screen.getByLabelText('Edit line 2'))
    expect(screen.queryByLabelText('Confirm delete line 2')).toBeNull()
    expect(screen.getByLabelText('Delete line 2')).toBeTruthy()
  })

  it('highlights the row under the current playhead', () => {
    const timedLines: TimedLine[] = [
      { startTime: 0, endTime: 2, original: 'first', translation: '' },
      { startTime: 2, endTime: 5, original: 'second', translation: '' },
    ]
    const { container } = render(
      <EditMode
        lines={timedLines}
        playhead={() => 1}
        playheadPosition={1}
        hasLocalAudio
        onChangeLines={vi.fn()}
        onAutoAlign={vi.fn()}
        title="t"
        artist="a"
        sourceLanguage="ja"
      />,
    )
    const rows = container.querySelectorAll('[class*="ring-cinnabar-accent"]')
    expect(rows.length).toBe(1)
    expect(rows[0].textContent).toMatch(/first/)
  })

  it('undo restores the previous lines after a text edit', () => {
    const { onChangeLines } = renderEditMode()
    fireEvent.click(screen.getByText('b'))
    const input = screen.getByLabelText('Original text')
    fireEvent.change(input, { target: { value: 'bb' } })
    fireEvent.blur(input)
    expect(onChangeLines).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    const undone = onChangeLines.mock.calls[1][0] as TimedLine[]
    expect(undone[1].original).toBe('b')
  })

  it('redo re-applies the change after an undo', () => {
    const { onChangeLines } = renderEditMode()
    fireEvent.click(screen.getByText('b'))
    const input = screen.getByLabelText('Original text')
    fireEvent.change(input, { target: { value: 'bb' } })
    fireEvent.blur(input)

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    const redone = onChangeLines.mock.calls[2][0] as TimedLine[]
    expect(redone[1].original).toBe('bb')
  })

  it('undo/redo buttons are disabled when there is nothing to undo/redo', () => {
    renderEditMode()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled()
  })

  it('a new edit clears the redo stack', () => {
    renderEditMode()
    fireEvent.click(screen.getByText('b'))
    const input = screen.getByLabelText('Original text')
    fireEvent.change(input, { target: { value: 'bb' } })
    fireEvent.blur(input)
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByRole('button', { name: 'Redo' })).not.toBeDisabled()

    fireEvent.click(screen.getByText('a'))
    const input2 = screen.getByLabelText('Original text')
    fireEvent.change(input2, { target: { value: 'aa' } })
    fireEvent.blur(input2)

    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled()
  })
})

describe('EditMode — local re-align', () => {
  it('shows static off-timing chip when there are needs_review lines', () => {
    renderEditMode({
      lineAlignmentQuality: ['good', 'needs_review'],
      showAlignmentQuality: true,
    })
    expect(screen.getByText('off-timing')).toBeTruthy()
  })

  it('does not render a bulk re-align button', () => {
    renderEditMode({
      lineAlignmentQuality: ['needs_review', 'needs_review'],
      showAlignmentQuality: true,
    })
    expect(screen.queryByRole('button', { name: /re-align.*weak/i })).toBeNull()
  })
})

describe('EditMode — gap recovery (R9-2)', () => {
  it('offers "Recover N sections" when audio is present and holes are recoverable', () => {
    const onRecoverGaps = vi.fn()
    renderEditMode({ recoverableGapCount: 2, onRecoverGaps })
    const btn = screen.getByRole('button', { name: /recover 2 sections/i })
    fireEvent.click(btn)
    expect(onRecoverGaps).toHaveBeenCalledTimes(1)
  })

  it('singularizes the label for a single recoverable section', () => {
    renderEditMode({ recoverableGapCount: 1, onRecoverGaps: vi.fn() })
    expect(screen.getByRole('button', { name: /recover 1 section$/i })).toBeTruthy()
  })

  it('hides the recover button when there are no recoverable holes', () => {
    renderEditMode({ recoverableGapCount: 0, onRecoverGaps: vi.fn() })
    expect(screen.queryByRole('button', { name: /recover/i })).toBeNull()
  })

  it('hides the recover button without local audio', () => {
    renderEditMode({ hasLocalAudio: false, recoverableGapCount: 3, onRecoverGaps: vi.fn() })
    expect(screen.queryByRole('button', { name: /recover/i })).toBeNull()
  })

  it('shows recovering progress and disables the button while recovering', () => {
    const onRecoverGaps = vi.fn()
    renderEditMode({
      recoverableGapCount: 2,
      onRecoverGaps,
      recoveringGaps: true,
      recoverGapsStatus: 'Recovering 2 sections…',
    })
    const btn = screen.getByRole('button', { name: /recovering 2 sections/i })
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(onRecoverGaps).not.toHaveBeenCalled()
  })

  // UI pass item 5: the bare button needs a plain-language explainer.
  it('explains what gap recovery does alongside the button (plural)', () => {
    renderEditMode({ recoverableGapCount: 2, onRecoverGaps: vi.fn() })
    expect(screen.getByText(/2 parts of the song couldn.t be timed/i)).toBeTruthy()
    expect(screen.getByText(/your edits are kept/i)).toBeTruthy()
  })

  it('singularizes the explainer for one recoverable section', () => {
    renderEditMode({ recoverableGapCount: 1, onRecoverGaps: vi.fn() })
    expect(screen.getByText(/1 part of the song couldn.t be timed/i)).toBeTruthy()
  })

  it('shows an inline spinner only while recovering', () => {
    const { container, rerender } = renderEditMode({
      recoverableGapCount: 2,
      onRecoverGaps: vi.fn(),
      recoveringGaps: true,
      recoverGapsStatus: 'Recovering 2 sections…',
    })
    expect(container.querySelector('.animate-spin')).toBeTruthy()
    rerender(
      <EditMode
        lines={lines}
        playhead={() => 9}
        hasLocalAudio
        onChangeLines={vi.fn()}
        onAutoAlign={vi.fn()}
        title="t"
        artist="a"
        sourceLanguage="ja"
        recoverableGapCount={2}
        onRecoverGaps={vi.fn()}
        recoveringGaps={false}
      />,
    )
    expect(container.querySelector('.animate-spin')).toBeNull()
  })
})

describe('EditMode — readable guidance + tintable icons (UI pass)', () => {
  // Item 4: hint paragraphs must be text-xs, not the illegible text-[10px].
  it('renders the no-audio hint at text-xs', () => {
    renderEditMode({ hasLocalAudio: false })
    const hint = screen.getByText(/tap-through to time lyrics/i)
    expect(hint.className).toContain('text-xs')
    expect(hint.className).not.toContain('text-[10px]')
  })

  it('renders the off-timing hint at text-xs', () => {
    renderEditMode({ lineAlignmentQuality: ['good', 'needs_review'], showAlignmentQuality: true })
    const hint = screen.getByText(/adjust the timestamps below/i)
    expect(hint.className).toContain('text-xs')
    expect(hint.className).not.toContain('text-[10px]')
  })

  it('renders the timestamp popover instruction at text-xs text-white/60', () => {
    renderEditMode()
    fireEvent.click(screen.getByRole('button', { name: /edit timestamp for line 1/i }))
    const instruction = screen.getByText(/drag to preview/i)
    expect(instruction.className).toContain('text-xs')
    expect(instruction.className).toContain('text-white/60')
    expect(instruction.className).not.toContain('text-[10px]')
  })

  // Item 6: emoji render as untintable color glyphs on iOS — must be SVG.
  it('timestamp pill uses a tintable SVG icon instead of the ⏱ emoji', () => {
    renderEditMode()
    const pill = screen.getByRole('button', { name: /edit timestamp for line 1/i })
    const svg = pill.querySelector('svg')
    expect(svg).toBeTruthy()
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
    expect(pill.textContent).not.toContain('⏱')
  })

  it('add and delete controls use tintable SVG icons instead of emoji', () => {
    renderEditMode()
    fireEvent.click(screen.getByText('b'))
    const add = screen.getByLabelText('Add line after 2')
    const del = screen.getByLabelText('Delete line 2')
    for (const btn of [add, del]) {
      const svg = btn.querySelector('svg')
      expect(svg).toBeTruthy()
      expect(svg?.getAttribute('aria-hidden')).toBe('true')
    }
    expect(add.textContent).not.toContain('⊕')
    expect(del.textContent).not.toContain('🗑')
  })
})

describe('EditMode playhead centering on mount', () => {
  const timedLines: TimedLine[] = [
    { startTime: 0, endTime: 2, original: 'first', translation: '' },
    { startTime: 2, endTime: 4, original: 'second', translation: '' },
    { startTime: 4, endTime: 6, original: 'third', translation: '' },
  ]

  it('scrolls the playhead line into view when entering edit mode', () => {
    const original = window.HTMLElement.prototype.scrollIntoView
    const scrolled: Array<{ el: HTMLElement; opts: unknown }> = []
    window.HTMLElement.prototype.scrollIntoView = function (opts?: unknown) {
      scrolled.push({ el: this as HTMLElement, opts })
    }
    try {
      renderEditMode({ lines: timedLines, playheadPosition: 4.5 })
      expect(scrolled).toHaveLength(1)
      expect(scrolled[0].opts).toMatchObject({ block: 'center' })
      expect(scrolled[0].el.textContent).toContain('third')
    } finally {
      window.HTMLElement.prototype.scrollIntoView = original
    }
  })

  it('does not scroll when no line matches the playhead', () => {
    const original = window.HTMLElement.prototype.scrollIntoView
    const spy = vi.fn()
    window.HTMLElement.prototype.scrollIntoView = spy
    try {
      renderEditMode({ lines: timedLines, playheadPosition: undefined })
      expect(spy).not.toHaveBeenCalled()
    } finally {
      window.HTMLElement.prototype.scrollIntoView = original
    }
  })
})

// Wave 2, item 1: the toolbar collapses to a single 44px row — Auto-align is the
// primary action, Undo/Redo are icon buttons, and the secondary actions live in
// a "More" overflow menu so nothing wraps on a 375px phone.
describe('EditMode — single-row toolbar hierarchy', () => {
  it('renders Auto-align as the visually primary (accent) action', () => {
    renderEditMode()
    const btn = screen.getByRole('button', { name: /auto-align/i })
    expect(btn.className).toMatch(/bg-cinnabar-accent/)
  })

  it('renders Undo and Redo as icon-only buttons with accessible labels', () => {
    renderEditMode()
    const undo = screen.getByRole('button', { name: 'Undo' })
    const redo = screen.getByRole('button', { name: 'Redo' })
    expect(undo.querySelector('svg')).toBeTruthy()
    expect(redo.querySelector('svg')).toBeTruthy()
    // Icon only — no visible text label.
    expect(undo.textContent?.trim()).toBe('')
    expect(redo.textContent?.trim()).toBe('')
  })

  it('tucks Replace / Tap-through / Translation behind a collapsed More menu', () => {
    renderEditMode({ onReplaceLyrics: vi.fn(), showTapSync: true, onTapSync: vi.fn() })
    // Collapsed by default — none of the secondary actions are in the DOM yet.
    expect(screen.queryByRole('button', { name: /replace lyrics/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /tap-through/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /translation/i })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /more/i }))

    expect(screen.getByRole('button', { name: /replace lyrics/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /tap-through/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /translation/i })).toBeTruthy()
  })

  it('lists only applicable actions in the More menu', () => {
    // No replace handler and no tap-sync — only the always-available Translation.
    renderEditMode()
    fireEvent.click(screen.getByRole('button', { name: /more/i }))
    expect(screen.queryByRole('button', { name: /replace lyrics/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /tap-through/i })).toBeNull()
    expect(screen.getByRole('button', { name: /translation/i })).toBeTruthy()
  })

  it('a More-menu action fires its handler and closes the menu', () => {
    const onReplaceLyrics = vi.fn()
    renderEditMode({ onReplaceLyrics })
    fireEvent.click(screen.getByRole('button', { name: /more/i }))
    fireEvent.click(screen.getByRole('button', { name: /replace lyrics/i }))
    expect(onReplaceLyrics).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: /replace lyrics/i })).toBeNull()
  })
})

// Wave 2, item 3: EditMode stays mounted while gap recovery or a completed
// auto-align swaps in a new `lines` array from outside. Undo must never silently
// revert that external result to a value the user never produced by hand.
describe('EditMode — external-change undo guard', () => {
  function editModeProps(over: Partial<Parameters<typeof EditMode>[0]>) {
    return {
      playhead: () => 9,
      hasLocalAudio: true,
      onAutoAlign: vi.fn(),
      title: 't',
      artist: 'a',
      sourceLanguage: 'ja' as const,
      ...over,
    }
  }

  it('clears the undo history when lines are replaced externally', () => {
    const onChangeLines = vi.fn()
    const initial: TimedLine[] = [{ startTime: 0, endTime: 2, original: 'a', translation: '' }]
    const { rerender } = render(<EditMode lines={initial} {...editModeProps({ onChangeLines })} />)

    // A hand edit puts the pre-edit lines on the undo stack.
    fireEvent.click(screen.getByText('a'))
    const input = screen.getByLabelText('Original text')
    fireEvent.change(input, { target: { value: 'hand edit' } })
    fireEvent.blur(input)
    expect(onChangeLines).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Undo' })).not.toBeDisabled()

    // An external replacement (gap recovery / completed auto-align) swaps in a
    // brand-new array this component's stack never emitted.
    const external: TimedLine[] = [{ startTime: 3, endTime: 6, original: 'recovered', translation: '' }]
    rerender(<EditMode lines={external} {...editModeProps({ onChangeLines })} />)

    // Undo is now a no-op — it must not restore the pre-external lines.
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
    onChangeLines.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onChangeLines).not.toHaveBeenCalled()
  })

  it('still supports undo for internal edits made after an external change', () => {
    const onChangeLines = vi.fn()
    const initial: TimedLine[] = [{ startTime: 0, endTime: 2, original: 'a', translation: '' }]
    const { rerender } = render(<EditMode lines={initial} {...editModeProps({ onChangeLines })} />)

    const external: TimedLine[] = [{ startTime: 3, endTime: 6, original: 'recovered', translation: '' }]
    rerender(<EditMode lines={external} {...editModeProps({ onChangeLines })} />)
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()

    // A fresh hand edit after the external change is undoable again.
    fireEvent.click(screen.getByText('recovered'))
    const input = screen.getByLabelText('Original text')
    fireEvent.change(input, { target: { value: 'edited' } })
    fireEvent.blur(input)
    expect(screen.getByRole('button', { name: 'Undo' })).not.toBeDisabled()

    onChangeLines.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    const undone = onChangeLines.mock.calls[0][0] as TimedLine[]
    expect(undone[0].original).toBe('recovered')
  })

  it('preserves undo history when an external change only adds enrichment (tokens/reading)', () => {
    const onChangeLines = vi.fn()
    const base: TimedLine[] = [{ startTime: 0, endTime: 2, original: 'a', translation: '' }]
    const { rerender } = render(<EditMode lines={base} {...editModeProps({ onChangeLines })} />)

    // Hand edit — pre-edit lines go on the undo stack.
    fireEvent.click(screen.getByText('a'))
    const input = screen.getByLabelText('Original text')
    fireEvent.change(input, { target: { value: 'hand edit' } })
    fireEvent.blur(input)
    const edited = onChangeLines.mock.calls[0][0] as TimedLine[]
    expect(screen.getByRole('button', { name: 'Undo' })).not.toBeDisabled()

    // Parent commits the edit back by reference (as the store does).
    rerender(<EditMode lines={edited} {...editModeProps({ onChangeLines })} />)
    expect(screen.getByRole('button', { name: 'Undo' })).not.toBeDisabled()

    // Async enrichment swaps in a NEW array — identical timing+text, plus
    // reading/tokens. This must NOT wipe the user's undo history.
    const enriched: TimedLine[] = edited.map((l) => ({ ...l, reading: 'よみ', tokens: [] }))
    rerender(<EditMode lines={enriched} {...editModeProps({ onChangeLines })} />)
    expect(screen.getByRole('button', { name: 'Undo' })).not.toBeDisabled()

    // The manual edit is still undoable — reverts to the pre-edit text.
    onChangeLines.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    const undone = onChangeLines.mock.calls[0][0] as TimedLine[]
    expect(undone[0].original).toBe('a')
  })
})
