/// <reference types="vitest" />
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type PluginOption } from 'vite'

// The real i18n loader, not a stub. `~/locales/locales.ts` imports
// "virtual:i18next-loader", which only exists because this plugin provides it — and the
// settings store imports the locales module. Reusing the same plugin (with the same
// options as vite.config.mts:104) means the test environment resolves i18n exactly as the
// application does, instead of against a mock that could drift.
import i18nextLoader from './src/lib/i18n-vite-loaded/loader'

/**
 * Vitest configuration.
 *
 * Kept separate from `vite.config.mts` on purpose: that config carries the whole Tauri
 * build (three entries, wasm copy targets, version stamping, tailwind safelist
 * generation), none of which a unit test needs, and running it would make the test
 * command depend on a full frontend build.
 *
 * The `~` alias must stay identical to the one in vite.config.mts:90 — a test that
 * resolves imports differently from the bundler would test code that never ships.
 *
 * See docs/testing.md for what belongs at this level and what does not.
 */
export default defineConfig({
  plugins: [
    react(),
    i18nextLoader({
      paths: ['./src/locales/lang'],
      namespaceResolution: 'basename',
    }) as PluginOption,
  ],
  resolve: {
    alias: {
      '~': path.join(__dirname, 'src'),
    },
  },
  // The app reads these as compile-time globals that Vite substitutes during a build
  // (see the `define` block in vite.config.mts). Without them, importing a module that
  // references one throws `ReferenceError` at load time.
  define: {
    APP_VERSION: JSON.stringify('0.7.0-test'),
    APP_UI_VERSION: JSON.stringify('0.7.0-test'),
    BUILD_DATE: JSON.stringify('2026-01-01T00:00:00.000Z'),
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // Vendored third-party copies are excluded from every gate (GOLDEN-RULES R7).
    exclude: ['node_modules/**', 'dist-ui/**', 'src/components/libs/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/lib/**', 'src/store/**', 'src/hooks/**'],
      exclude: ['src/components/libs/**', 'src/**/*.test.{ts,tsx}', 'src/test/**'],
      // The ratchet. Raise these as coverage grows; never lower them
      // (docs/harness/GOLDEN-RULES.md R9). Phase 5 target is 50% for this scope.
      thresholds: {
        lines: 0,
        functions: 0,
        branches: 0,
        statements: 0,
      },
    },
  },
})
