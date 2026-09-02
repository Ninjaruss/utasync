import '@testing-library/jest-dom'
import 'fake-indexeddb/auto'
import { configure } from '@testing-library/react'

/**
 * Testing Library's default `waitFor` budget is 1s. Most of this suite's
 * assertions ride on an effect, a microtask chain or `runWhenIdle`, all of which
 * are scheduled against a CPU this suite shares with 280 other files — so under
 * load the work is real but late, and a 1s ceiling reports it as a failure. That
 * produced failures that moved between files run to run and had nothing to do
 * with the change being tested, which is worse than useless: it teaches you to
 * discount red.
 *
 * Raising the ceiling costs nothing on a green run — `waitFor` returns the
 * moment its callback passes — and only makes genuine failures slower to
 * surface. It buys back the signal.
 */
configure({ asyncUtilTimeout: 5_000 })

// jsdom doesn't implement scrollIntoView; LyricDisplay relies on it to keep
// the active line centered. Stub it so component tests don't crash.
if (typeof window !== 'undefined' && !window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = () => {}
}

/**
 * No test may reach the real network.
 *
 * Ten test files render the add-song flow, which awaits resolveCoverArt — a real
 * request to itunes.apple.com with a 5s timeout. Vitest's own testTimeout is
 * also 5s, so those tests were a dead heat between the two, decided by live
 * network conditions. That is why they failed intermittently, differently per
 * run, and differently per machine — and why a genuine regression could hide
 * behind "probably the known flake".
 *
 * Failing loudly and instantly is strictly better than hanging for five seconds.
 * A test that is genuinely ABOUT fetching installs its own (global.fetch =
 * vi.fn(), or vi.stubGlobal), which overrides this.
 */
globalThis.fetch = ((input: RequestInfo | URL): Promise<Response> => {
  const url =
    typeof input === 'string' ? input
    : input instanceof URL ? input.href
    : (input as Request).url
  return Promise.reject(new Error(
    `Unmocked network request in a test: ${url}\n` +
    'Tests must not reach the network. Either mock the module that makes this ' +
    "call (e.g. vi.mock('../../src/sources/coverArt')), or, if this test is " +
    'specifically about fetching, install your own: global.fetch = vi.fn().',
  ))
}) as typeof fetch
