import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PhraseChange } from '../../src/lyrics/phraseLayout'
import { PhraseNormalizePanel } from '../../src/lyrics/PhraseNormalizePanel'

const changes: PhraseChange[] = [
  { kind: 'merge', sourceLineIndices: [0, 1], before: ['岩は転がって', ''], after: ['岩は転がって'] },
  { kind: 'split', sourceLineIndices: [2], before: ['君の声が　遠くで響く'], after: ['君の声が', '遠くで響く'] },
]

const noop = () => {}

describe('PhraseNormalizePanel', () => {
  it('renders nothing when there are no changes', () => {
    const { container } = render(
      <PhraseNormalizePanel changes={[]} active={false} onApply={noop} onRevert={noop} onDismiss={noop} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('lists each change with its before and after text and a kind badge', () => {
    render(
      <PhraseNormalizePanel changes={changes} active={false} onApply={noop} onRevert={noop} onDismiss={noop} />,
    )
    expect(screen.getByText('Merge')).toBeTruthy()
    expect(screen.getByText('Split')).toBeTruthy()
    expect(screen.getByText('君の声が')).toBeTruthy()
    expect(screen.getByText('遠くで響く')).toBeTruthy()
  })

  it('applies the sung layout when not yet active', async () => {
    const onApply = vi.fn()
    render(
      <PhraseNormalizePanel changes={changes} active={false} onApply={onApply} onRevert={noop} onDismiss={noop} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Match phrasing' }))
    expect(onApply).toHaveBeenCalledOnce()
  })

  it('offers a restore action when the sung layout is active', async () => {
    const onRevert = vi.fn()
    render(
      <PhraseNormalizePanel changes={changes} active onApply={noop} onRevert={onRevert} onDismiss={noop} />,
    )
    expect(screen.queryByRole('button', { name: 'Match phrasing' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Restore pasted layout' }))
    expect(onRevert).toHaveBeenCalledOnce()
  })
})
