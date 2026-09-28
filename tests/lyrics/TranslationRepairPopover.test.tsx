import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TranslationRepairPopover } from '../../src/lyrics/TranslationRepairPopover'

describe('TranslationRepairPopover', () => {
  const candidates = [
    { text: 'the current one', score: 0.4, source: 'nearby' as const, sourceLineIndex: 11 },
    { text: 'a better one', score: 0.8, source: 'nearby' as const, sourceLineIndex: 4 },
    { text: 'an orphaned line', score: 0.6, source: 'unplaced' as const },
  ]

  it('offers candidates best-first and marks unplaced ones', async () => {
    render(
      <TranslationRepairPopover
        lineIndex={3} candidates={candidates} onChoose={() => {}} onClose={() => {}}
      />,
    )
    const options = screen.getAllByRole('button', { name: /one|line/i })
    expect(options[0]).toHaveTextContent('a better one')
    expect(screen.getByText(/unplaced/i)).toBeInTheDocument()
  })

  // Choosing a neighbouring row's translation copies that sentence onto this
  // row, leaving the original looking unchanged — so the picker has to say which
  // row a candidate came from, or two rows silently show the same sentence.
  it('names the row a nearby candidate belongs to', () => {
    render(
      <TranslationRepairPopover
        lineIndex={3} candidates={candidates} onChoose={() => {}} onClose={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: /a better one/i })).toHaveTextContent('from line 5')
    expect(screen.getByRole('button', { name: /the current one/i })).toHaveTextContent('from line 12')
    // …and an orphan has no row to name.
    expect(screen.getByRole('button', { name: /an orphaned line/i })).not.toHaveTextContent(/from line/)
  })

  it('reports the chosen text and where it came from', async () => {
    const onChoose = vi.fn()
    render(
      <TranslationRepairPopover
        lineIndex={3} candidates={candidates} onChoose={onChoose} onClose={() => {}}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /a better one/i }))
    expect(onChoose).toHaveBeenCalledWith('a better one', 'nearby')

    await userEvent.click(screen.getByRole('button', { name: /an orphaned line/i }))
    expect(onChoose).toHaveBeenLastCalledWith('an orphaned line', 'unplaced')
  })
})
