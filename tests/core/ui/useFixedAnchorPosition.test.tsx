import { useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useFixedAnchorPosition } from '../../../src/core/ui/useFixedAnchorPosition'

function Harness() {
  const anchor = useRef<HTMLDivElement>(null), panel = useRef<HTMLDivElement>(null)
  useFixedAnchorPosition(panel, anchor, { estimatedHeightPx: 380 })
  return <><div ref={anchor} data-testid="anchor" /><div ref={panel} data-testid="panel" /></>
}
afterEach(() => vi.restoreAllMocks())
function setup(top: number, height: number, panelHeight: number) {
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(height)
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(375)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.dataset.testid === 'anchor'
      ? { top, bottom: top + 60, left: 12, right: 363, width: 351, height: 60 } as DOMRect
      : { height: Math.min(panelHeight, parseFloat(this.style.maxHeight) || panelHeight), width: 351 } as DOMRect
  })
  render(<Harness />)
  return screen.getByTestId('panel')
}
describe('anchored editor placement', () => {
  it('uses measured height so an early row does not unnecessarily flip above the screen', () => {
    const panel = setup(120, 500, 260)
    expect(panel.style.top).toBe('184px')
    expect(panel.style.bottom).toBe('')
  })
  it('stays on-screen when neither side has room and scrolls tall content', () => {
    const panel = setup(100, 280, 350)
    expect(panel.style.top).toBe('8px')
    expect(panel.style.maxHeight).toBe('264px')
    expect(panel.style.overflowY).toBe('auto')
  })
  it('flips above a late row and repositions on viewport resize', () => {
    const panel = setup(400, 600, 260)
    expect(panel.style.top).toBe('136px')
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(300)
    fireEvent(window, new Event('resize'))
    expect(panel.style.top).toBe('32px')
  })
})
