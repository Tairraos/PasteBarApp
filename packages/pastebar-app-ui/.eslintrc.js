/**
 * The UI workspace package resolves ESLint configuration from the repository root.
 *
 * This file previously duplicated the root config with a plugin/extends chain that could
 * not resolve (`eslint-plugin-import` was never installed, so `plugin:import/electron`
 * and friends aborted every run). It is now a thin stub so there is exactly one lint
 * policy in the repository.
 *
 * See `/.eslintrc.js` and `docs/harness/GOLDEN-RULES.md`.
 */
module.exports = {
  root: false,
}
