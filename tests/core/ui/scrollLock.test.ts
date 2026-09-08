import { describe, it, expect, afterEach } from 'vitest'
import { acquireScrollLock, resetScrollLock } from '../../../src/core/ui/scrollLock'

afterEach(() => {
  // The module holds state (holders count) across tests in this file, so isolation
  // must be explicit rather than incidental. Reset the module first, then the style,
  // so the style reset is not undone if a test's expect() threw before its release().
  resetScrollLock()
  document.body.style.overflow = ''
})

describe('acquireScrollLock', () => {
  it('locks the body while held and restores on release', () => {
    const release = acquireScrollLock()
    expect(document.body.style.overflow).toBe('hidden')
    release()
    expect(document.body.style.overflow).toBe('')
  })

  it('stays locked until the LAST holder releases', () => {
    const a = acquireScrollLock()
    const b = acquireScrollLock()
    a()
    expect(document.body.style.overflow).toBe('hidden')
    b()
    expect(document.body.style.overflow).toBe('')
  })

  it('restores whatever overflow the page already had', () => {
    document.body.style.overflow = 'scroll'
    const release = acquireScrollLock()
    expect(document.body.style.overflow).toBe('hidden')
    release()
    expect(document.body.style.overflow).toBe('scroll')
  })

  it('ignores a double release instead of unlocking someone else', () => {
    const a = acquireScrollLock()
    const b = acquireScrollLock()
    a()
    a()
    expect(document.body.style.overflow).toBe('hidden')
    b()
    expect(document.body.style.overflow).toBe('')
  })

  it('guards against late cleanup after reset (afterEach teardown pattern)', () => {
    // Acquire a lock in the test
    const release = acquireScrollLock()
    expect(document.body.style.overflow).toBe('hidden')

    // Simulate afterEach calling resetScrollLock() and resetting the style
    // (this happens before the unmount cleanup runs in RTL's teardown order)
    resetScrollLock()
    document.body.style.overflow = ''

    // Now simulate RTL cleanup firing the old release closure (unmount cleanup).
    // This runs AFTER afterEach, so holders is now 0 when release() fires.
    release()

    // Acquire again, simulating the next test starting. Without the fix, holders
    // was driven to -1 by the stale release(), and acquireScrollLock() silently
    // fails to lock because if (holders === 0) is false.
    acquireScrollLock()
    expect(document.body.style.overflow).toBe('hidden')
  })
})
