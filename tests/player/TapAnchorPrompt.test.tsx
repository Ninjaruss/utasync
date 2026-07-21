import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TapAnchorPrompt } from '../../src/player/TapAnchorPrompt'

describe('TapAnchorPrompt', () => {
  it('reports the line index and captured time on tap', () => {
    const onAnchor = vi.fn()
    render(<TapAnchorPrompt lineIndex={4} getTime={() => 12.5} onAnchor={onAnchor} />)
    fireEvent.click(screen.getByRole('button', { name: /tap when this line starts/i }))
    expect(onAnchor).toHaveBeenCalledWith(4, 12.5)
  })

  it('renders nothing when lineIndex is null', () => {
    const { container } = render(<TapAnchorPrompt lineIndex={null} getTime={() => 0} onAnchor={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })
})
