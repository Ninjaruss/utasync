import '@testing-library/jest-dom'
import 'fake-indexeddb/auto'

// jsdom doesn't implement scrollIntoView; LyricDisplay relies on it to keep
// the active line centered. Stub it so component tests don't crash.
if (typeof window !== 'undefined' && !window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = () => {}
}
