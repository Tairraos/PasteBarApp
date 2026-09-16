/**
 * Vitest setup file.
 *
 * Runs before every test file. Responsibilities, in order:
 *   1. add jest-dom's DOM matchers (`toBeInTheDocument`, …);
 *   2. give jsdom the browser APIs the app touches but jsdom does not implement;
 *   3. silence the app's own `console.*` noise so a failing assertion is readable.
 *
 * Anything a test needs that is *specific* to one module belongs in that test file, not
 * here. This file must stay small enough to read in one screen.
 *
 * See docs/testing.md.
 */
import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { afterEach, beforeAll, vi } from 'vitest'

// --- jsdom gaps ----------------------------------------------------------------------
// jsdom implements neither of these, and the app reaches for both during render.

if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  })
}

if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}

// The app calls these on window/tray interactions; jsdom has no implementation.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn()
}

// --- Tauri ---------------------------------------------------------------------------
// `@tauri-apps/api/window` builds a `WebviewWindow` at *module load time* from
// `window.__TAURI_METADATA__.__currentWindow` and dereferences `.label` with no guard, so
// importing any module that transitively imports the API throws before a single test runs.
// The shape below mirrors what the real Tauri runtime injects. Tests that exercise IPC mock
// `@tauri-apps/api/tauri` and `@tauri-apps/api/event` directly (see ./fake-backend); this
// stub only satisfies module-load-time reads.
const tauriWindow = {
  label: 'main',
  url: 'tauri://localhost/index.html',
  title: 'PasteBar',
  skip: true,
}
;(window as unknown as Record<string, unknown>).__TAURI_METADATA__ = {
  __windows: [tauriWindow],
  __currentWindow: tauriWindow,
}

// --- console hygiene -----------------------------------------------------------------
// The app logs a lot (167 console.* call sites at Phase 3). Letting that through buries
// the assertion output, so it is muted by default. A test that asserts on logging can
// restore the original with `vi.unstubAllGlobals()` or import { originalConsole }.
export const originalConsole = { ...console }

beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'debug').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
  // console.warn / console.error are NOT muted: React's warning output is a real signal
  // (act() violations, invalid props) and hiding it is how those become permanent.
})

// --- isolation -----------------------------------------------------------------------
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  localStorage.clear()
  sessionStorage.clear()
})
