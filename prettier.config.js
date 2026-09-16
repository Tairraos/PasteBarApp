/**
 * Prettier configuration.
 *
 * `@ianvs/prettier-plugin-sort-imports` v4 removed the boolean `importOrder*` flags in
 * favour of a `importOrder` array that carries the blank-line separators inline. The old
 * flags were still present here and Prettier printed
 * "Ignored unknown option { importOrderSeparation: true }" on every run — noisy, and it
 * meant the intended import grouping was only half-applied.
 *
 * This file is the root config. `packages/pastebar-app-ui/prettier.config.js` exists
 * separately for the workspace package; keep the two in sync.
 *
 * @see .prettierignore for what is deliberately excluded (vendored and generated code).
 * @type {import('prettier').Config}
 */
module.exports = {
  printWidth: 90,
  semi: false,
  singleQuote: true,
  tabWidth: 2,
  useTabs: false,
  bracketSpacing: true,
  arrowParens: 'avoid',
  endOfLine: 'auto',
  trailingComma: 'es5',

  // Import grouping. An empty string is a blank-line separator, which is what the removed
  // `importOrderSeparation: true` flag used to mean. `importOrderSortSpecifiers` and
  // `importOrderMergeDuplicateImports` are now always-on behaviours of the plugin.
  importOrder: [
    '^(react/(.*)$)|^(react$)',
    '<THIRD_PARTY_MODULES>',
    '',
    '^~/app/(.*)$',
    '',
    '^~/lib/(.*)$',
    '',
    '^~/components/ui/(.*)$',
    '^~/components/(.*)$',
    '',
    '^~/store/(.*)$',
    '^~/config/(.*)$',
    '',
    '^~/hooks/(.*)$',
    '^~/constants/(.*)$',
    '',
    '^~/types$',
    '^~/types/(.*)$',
    '',
    '^~/styles/(.*)$',
    '',
    '^[./]',
  ],
  importOrderParserPlugins: ['typescript', 'jsx', 'decorators-legacy'],
  plugins: ['@ianvs/prettier-plugin-sort-imports'],
}
