import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PlayEditToggle } from '../../src/player/PlayEditToggle'

/**
 * The active segment's label sits on the solid accent, which is painted by a
 * separate absolutely-positioned sibling rather than by the button itself. A
 * DOM contrast sweep therefore reads the label as sitting on the dark pill and
 * passes it, so white here (2.77:1) survived the pass that moved every other
 * solid-accent surface to the dark token (7.33:1). Pin it.
 */
describe('PlayEditToggle contrast', () => {
  it('gives the active segment the dark label the accent needs', () => {
    render(<PlayEditToggle mode="play" onChange={vi.fn()} />)
    const play = screen.getByRole('button', { name: 'Play' })
    expect(play.className).toContain('text-cinnabar-950')
    expect(play.className).not.toContain('text-white')
  })

  it('moves the dark label with the active segment', () => {
    render(<PlayEditToggle mode="edit" onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Edit' }).className).toContain('text-cinnabar-950')
    // The inactive label is on the pill, not the accent, and measures 5.24:1.
    expect(screen.getByRole('button', { name: 'Play' }).className).toContain('text-white/50')
  })

  it('stays narrow below sm so the song title keeps its room in the header', () => {
    const { container } = render(<PlayEditToggle mode="play" onChange={vi.fn()} />)
    const group = container.querySelector('[role="group"]')!
    expect(group.className).toContain('min-w-[6.5rem]')
    expect(group.className).toContain('sm:min-w-[8.25rem]')
  })
})
