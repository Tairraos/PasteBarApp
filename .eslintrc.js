/**
 * ESLint configuration — harness Phase 3.
 *
 * Format: eslintrc (ESLint 8), as decided in `docs/harness/DECISIONS.md` (D-002).
 * A flat-config migration is deferred and is not part of this overhaul.
 *
 * NOTE: `packages/pastebar-app-ui/.eslintrc.js` is kept as a one-line stub that extends
 * this file, so the UI package resolves to this single source of truth. Its previous
 * contents declared plugins (`eslint-plugin-react-compiler`, `eslint-plugin-import`)
 * that were never installed and a `plugin:import/*` extends chain that cannot resolve,
 * which is why no lint run was possible before Phase 3.
 *
 * Baseline policy: taste rules (complexity, unused vars, `any`, suppression comments)
 * are `error` with an explicit per-path exemption list recorded in
 * `docs/harness/DEBT-BASELINE.md`. That list may shrink, never grow. Rationale for each
 * threshold is in `docs/harness/GOLDEN-RULES.md`.
 */
module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    node: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint', 'sonarjs'],
  extends: ['plugin:@typescript-eslint/recommended', 'plugin:sonarjs/recommended'],
  ignorePatterns: [
    'node_modules/',
    'dist-ui/',
    'src-tauri/',
    // Vendored third-party copies — never edited, never linted (AGENTS.md rule 2).
    'packages/pastebar-app-ui/src/components/libs/',
    'scripts/',
    '*.config.js',
    '*.config.mts',
    '.eslintrc.js',
  ],
  rules: {
    // --- the project's original rule set, preserved --------------------------
    '@typescript-eslint/no-var-requires': 'off',
    '@typescript-eslint/ban-ts-comment': 'off',
    '@typescript-eslint/no-empty-function': 'off',
    'no-empty-function': 'off',
    'import/no-named-as-default': 'off',
    'import/no-named-as-default-member': 'off',
    camelcase: ['error', { ignoreDestructuring: true }],
    'computed-property-spacing': [2, 'never'],
    'no-extend-native': 2,
    'no-mixed-spaces-and-tabs': ['warn', 'smart-tabs'],
    'object-curly-spacing': [2, 'always'],
    quotes: [2, 'single', { avoidEscape: true, allowTemplateLiterals: true }],
    // Prettier owns formatting; the original `warn` would double-report.
    'no-trailing-spaces': 'off',

    // The original config used `[2, 'nofunc']`, which flags every hoisted function
    // declaration and every module-level const referenced from a later component — 45
    // false positives across the codebase, none of them real TDZ defects. TypeScript
    // already reports genuine use-before-define errors, so this rule is restricted to
    // the case that actually bites at runtime: `let`/`var` class-like bindings.
    'no-use-before-define': [2, { functions: false, classes: false, variables: false }],

    // --- harness rules: ratchet targets from GOLDEN-RULES.md ----------------
    // Cognitive complexity. Was 200 (effectively disabled) before Phase 3.
    // Phase 3 baseline: 40. Phase 4 W6 target: 25.
    'sonarjs/cognitive-complexity': ['error', 40],

    // Rules that were off before and stay off. `no-duplicate-string` is genuinely noisy
    // here (61 hits) with little defect signal; the others cover a small number of sites.
    // All four are recorded in DEBT-BASELINE.md as deliberate non-targets.
    'sonarjs/no-duplicate-string': 'off',
    'sonarjs/no-duplicated-branches': 'off',
    'sonarjs/no-nested-template-literals': 'off',
    'sonarjs/no-identical-functions': 'off',

    // Rules that were off (via `plugin:sonarjs/recommended` only) and caught real
    // dead-branch / redundant-code defects in the existing source. Kept as errors.
    'prefer-const': 'error',
    'sonarjs/no-collapsible-if': 'error',
    'sonarjs/no-all-duplicated-branches': 'error',
    'sonarjs/no-identical-conditions': 'error',
    'sonarjs/no-redundant-jump': 'error',
    'sonarjs/prefer-immediate-return': 'error',

    // Highest-value rule here (97 hits). The codebase uses a leading-underscore
    // convention for deliberately unused bindings, so honour it.
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
    ],

    // `any` is a W6 ratchet target, not a Phase-3 blocker: several sites are deliberate
    // at library boundaries. Warn now, error in W6.
    '@typescript-eslint/no-explicit-any': 'warn',
  },
  overrides: [
    {
      // shadcn/ui-style primitive wrappers forward props verbatim; `any` is idiomatic there.
      files: ['packages/pastebar-app-ui/src/components/ui/**/*.tsx'],
      rules: { '@typescript-eslint/no-explicit-any': 'off' },
    },
    {
      // Type declarations are hoisted by TypeScript, so referring to a type before its
      // declaration is legal and unavoidable in generated .d.ts files.
      files: ['**/*.d.ts'],
      rules: { 'no-use-before-define': 'off' },
    },
  ],
}
