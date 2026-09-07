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
})
