import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LookupPopoverShell } from '../../src/lyrics/LookupPopoverShell'

const link = { href: 'https://jisho.org/search/x', label: 'jisho.org ↗' }

describe('LookupPopoverShell', () => {
  it('renders a labelled dialog with the body, close button, and external link', () => {
    render(
      <LookupPopoverShell ariaLabel="Dictionary entry for x" anchorRect={null} externalLink={link} onClose={() => {}}>
        <p>body</p>
      </LookupPopoverShell>,
    )
    expect(screen.getByRole('dialog', { name: 'Dictionary entry for x' })).toBeTruthy()
    expect(screen.getByText('body')).toBeTruthy()
    expect(screen.getByRole('link').getAttribute('href')).toBe(link.href)
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
  })

  it('sits above the player dock in the bottom-card layout', () => {
    render(
      <LookupPopoverShell ariaLabel="x" anchorRect={null} externalLink={link} onClose={() => {}}>
        <p>body</p>
      </LookupPopoverShell>,
    )
    expect((screen.getByRole('dialog') as HTMLElement).style.bottom).toBe('calc(var(--player-dock-height, 96px) + 12px)')
  })

  it('anchors below the word and clamps to the right edge', () => {
    render(
      <LookupPopoverShell ariaLabel="x" anchorRect={{ left: 1000, top: 100, bottom: 120, right: 1020 } as DOMRect} externalLink={link} onClose={() => {}}>
        <p>body</p>
      </LookupPopoverShell>,
    )
    const dialog = screen.getByRole('dialog') as HTMLElement
    expect(dialog.style.top).toBe('128px')
    expect(dialog.style.left).toBe('728px') // 1024 - 288 - 8
  })

  it('closes on outside pointerdown and swallows the following click, one-shot', () => {
    const onClose = vi.fn()
    const onSibling = vi.fn()
    render(
      <div>
        <button type="button" onClick={onSibling}>seek</button>
        <LookupPopoverShell ariaLabel="x" anchorRect={null} externalLink={link} onClose={onClose}><p>body</p></LookupPopoverShell>
      </div>,
    )
    const sibling = screen.getByRole('button', { name: 'seek' })
    fireEvent.pointerDown(sibling)
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(sibling)
    expect(onSibling).not.toHaveBeenCalled()
    fireEvent.click(sibling)
    expect(onSibling).toHaveBeenCalledTimes(1)
  })
})
