import { describe, it, expect, afterEach } from 'vitest'
import { acquireScrollLock } from '../../../src/core/ui/scrollLock'

afterEach(() => {
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
