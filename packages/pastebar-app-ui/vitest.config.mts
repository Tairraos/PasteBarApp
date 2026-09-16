/// <reference types="vitest" />
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

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
  plugins: [react()],
  resolve: {
    alias: {
      '~': path.join(__dirname, 'src'),
    },
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
