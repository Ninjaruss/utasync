import { describe, it, expect } from 'vitest'
import { selectActiveAnchorTarget } from '../../src/lyrics/anchorRefit'

describe('selectActiveAnchorTarget', () => {
  it('offers the prompt while the flagged line is the active one', () => {
    expect(selectActiveAnchorTarget(5, [5, 20])).toBe(5)
  })

  it('offers nothing when no line is flagged', () => {
    expect(selectActiveAnchorTarget(5, [])).toBeNull()
  })

  it('offers nothing on a line nowhere near a flagged one', () => {
    expect(selectActiveAnchorTarget(12, [5, 20])).toBeNull()
  })

  // Regression: the prompt vanished the moment the flagged line's STORED span
  // elapsed — but that timing is wrong by definition (it is why the line is
  // flagged), so the real vocal usually arrives after the app has already moved
  // on. The user sat ready to tap and the button disappeared under them.
  it('stays offered for a couple of lines past a flagged line', () => {
    expect(selectActiveAnchorTarget(6, [5])).toBe(5)
    expect(selectActiveAnchorTarget(7, [5])).toBe(5)
  })

  it('lets go once the playhead is well past', () => {
    expect(selectActiveAnchorTarget(8, [5])).toBeNull()
  })

  it('hands over to the next flagged line rather than holding the old one', () => {
    expect(selectActiveAnchorTarget(6, [5, 6])).toBe(6)
  })

  it('holds the nearest flagged line when two are close together', () => {
    expect(selectActiveAnchorTarget(7, [4, 5])).toBe(5)
  })

  it('never offers a line the playhead has not reached', () => {
    expect(selectActiveAnchorTarget(3, [5])).toBeNull()
  })

  it('treats no active line as nothing to offer', () => {
    expect(selectActiveAnchorTarget(-1, [5])).toBeNull()
  })
})
