// The English catalog is also the KEY SET: `t('Some sentence')` is looked up by that
// sentence, and `lang/en/*.yaml` maps it to the English display text. It therefore cannot be
// removed even though the UI is Chinese-only — without it every `t()` call would return the
// key itself, and there would be nothing to translate FROM. It is the fallback locale, not a
// user-facing language choice.
export const DEFAULT_LOCALE = 'en'

/**
 * The language a user gets when they have not chosen one, or chose one that no longer exists.
 *
 * Distinct from [`DEFAULT_LOCALE`], and the distinction matters for upgrades. `DEFAULT_LOCALE`
 * is i18next's fallback — the catalog that supplies the key strings when a translation is
 * missing — and must stay `en`. This one is the product's answer to "what language should the
 * UI be in", which is Chinese.
 *
 * Without this, an install whose stored `userSelectedLanguage` is one of the deleted codes
 * (`de`, `fr`, …) would fall through to the i18next fallback and silently become English.
 * That is a confusing outcome for a user who never asked for English.
 */
export const DEFAULT_USER_LOCALE = 'zhCN'

/** Whether `code` is still a language a user can select. */
export function isSupportedLocale(code: string | undefined | null): boolean {
  if (!code) return false
  return LANGUAGES.some(l => l.code === code)
}

/**
 * The languages a user can pick.
 *
 * Chinese only, by product decision. The other nine catalogs (de, esES, fr, it, ru, tr, uk,
 * zhTW) were deleted rather than left unreachable: they were ~1.2 MB of translation that no
 * longer had a selector to reach it, and untranslated strings accumulated unnoticed behind
 * them (see scripts/i18n-missing-keys.mjs, which found 96 UI strings with no English entry
 * at all). They remain in git history if a translation is wanted again.
 *
 * `zhCN` is the default the app falls back to when the stored preference is unset or names a
 * language that no longer exists — which is what an existing install upgraded from a
 * multi-language build will have.
 */
export const LANGUAGES: {
  code: string
  name: string
  website: string
  flag: string
}[] = [
  {
    code: 'zhCN',
    name: '简体中文',
    website: 'www.pastebar.app',
    flag: '🇨🇳',
  },
]
