import { describe, it, expect } from 'vitest'
import { useSettingsStore } from '../../src/payment/SettingsStore'

describe('immersionDefinitions setting', () => {
  it('defaults to off', () => {
    expect(useSettingsStore.getState().immersionDefinitions).toBe(false)
  })
  it('can be toggled', () => {
    useSettingsStore.getState().setImmersionDefinitions(true)
    expect(useSettingsStore.getState().immersionDefinitions).toBe(true)
    useSettingsStore.getState().setImmersionDefinitions(false)
    expect(useSettingsStore.getState().immersionDefinitions).toBe(false)
  })
})
