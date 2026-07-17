import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AlignmentEditor } from '../../src/lyrics/AlignmentEditor'

function renderEditor(overrides: Partial<Parameters<typeof AlignmentEditor>[0]> = {}) {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  const utils = render(
    <AlignmentEditor
      originalLines={['line one', 'line two', 'line three']}
      translationLines={['one', 'two']}
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...overrides}
    />,
  )
  return { onConfirm, onCancel, ...utils }
}

describe('AlignmentEditor', () => {
  // Item 1 (P0): the editor used to be a full-screen trap — the only exit
  // committed the pairing. Cancel must exist and must NOT confirm.
  it('renders a Cancel button that exits without confirming', () => {
    const { onConfirm, onCancel } = renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('Cancel button meets the 44px tap-target sizing', () => {
    renderEditor()
    const btn = screen.getByRole('button', { name: 'Cancel' })
    expect(btn.className).toContain('min-h-11')
    expect(btn.className).toContain('min-w-11')
  })

  // Item 2: explain WHY the user landed here and that blank rows are safe.
  it('explains the line-count mismatch and that blank rows stay untranslated', () => {
    renderEditor()
    expect(screen.getByText(/couldn.t automatically match every line/i)).toBeTruthy()
    expect(screen.getByText(/rows left blank just stay untranslated/i)).toBeTruthy()
  })

  it('counts unmatched rows in plain language (plural)', () => {
    // 3 originals, 1 translation -> 2 empty rows.
    renderEditor({ translationLines: ['one'] })
    expect(screen.getByText(/2 lines without a translation/i)).toBeTruthy()
  })

  it('counts unmatched rows in plain language (singular)', () => {
    // 3 originals, 2 translations -> 1 empty row.
    renderEditor()
    expect(screen.getByText(/1 line without a translation/i)).toBeTruthy()
  })

  it('hides the unmatched count when every row has a translation', () => {
    renderEditor({ translationLines: ['one', 'two', 'three'] })
    expect(screen.queryByText(/without a translation/i)).toBeNull()
  })

  // Item 3: row controls must be 44px tap targets, not ~18x24px.
  it('reorder and clear controls meet the 44px tap-target sizing', () => {
    renderEditor()
    for (const label of ['Move translation up', 'Move translation down', 'Clear translation']) {
      const btn = screen.getAllByLabelText(label)[0]
      expect(btn.className).toContain('min-w-11')
      expect(btn.className).toContain('min-h-11')
    }
  })

  // Regression: the confirm path still applies the pairs.
  it('Confirm pairings applies the row pairs and does not cancel', () => {
    const { onConfirm, onCancel } = renderEditor()
    fireEvent.click(screen.getByRole('button', { name: /confirm pairings/i }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm.mock.calls[0][0]).toEqual([
      { original: 'line one', translation: 'one' },
      { original: 'line two', translation: 'two' },
      { original: 'line three', translation: '' },
    ])
    expect(onCancel).not.toHaveBeenCalled()
  })
})
