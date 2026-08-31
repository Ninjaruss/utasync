import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TranslationRepairPopover } from '../../src/lyrics/TranslationRepairPopover'

describe('TranslationRepairPopover', () => {
  const candidates = [
    { text: 'the current one', score: 0.4, source: 'nearby' as const },
    { text: 'a better one', score: 0.8, source: 'nearby' as const },
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

  it('reports the chosen text', async () => {
    const onChoose = vi.fn()
    render(
      <TranslationRepairPopover
        lineIndex={3} candidates={candidates} onChoose={onChoose} onClose={() => {}}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /a better one/i }))
    expect(onChoose).toHaveBeenCalledWith('a better one')
  })
})
