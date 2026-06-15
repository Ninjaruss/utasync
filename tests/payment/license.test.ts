import { describe, it, expect } from 'vitest'
import { verifyLicense } from '../../src/payment/license'

describe('verifyLicense', () => {
  it('rejects an obviously invalid token', async () => {
    const result = await verifyLicense('not.a.jwt')
    expect(result.valid).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('returns valid=false for malformed token', async () => {
    const result = await verifyLicense('eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ0ZXN0IiwiZXhwIjoxfQ.invalid')
    expect(result.valid).toBe(false)
  })
})
