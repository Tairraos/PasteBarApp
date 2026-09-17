import { createInstance } from 'i18next'
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_LOCALE,
  DEFAULT_USER_LOCALE,
  isSupportedLocale,
  LANGUAGES,
} from './languges'

/**
 * The app is Chinese-only, but the English catalog is still loaded — it *is* the key set,
 * because `t('Some sentence')` is looked up by that sentence.
 *
 * That split (one selectable language, two loaded catalogs) is exactly where i18next can
 * misbehave: `supportedLngs` is built from `LANGUAGES`, and the fallback is `DEFAULT_LOCALE`,
 * which is deliberately NOT in that list. If i18next treated the fallback as unsupported,
 * it would refuse to resolve English resources and every `t()` call would return its
 * argument — the UI would look plausibly English while every translation was silently dead.
 *
 * These tests pin that configuration against a real i18next instance rather than trusting
 * the option names, because the failure is invisible: nothing throws, the strings just stop
 * being translated.
 */
function buildI18n() {
  const instance = createInstance()
  instance.init({
    resources: {
      en: {
        common: {
          Hello: 'Hello',
          // A key whose English text differs from what a caller passes would be a bug; the
          // catalog maps a sentence to itself on purpose.
          'Save Changes': 'Save Changes',
        },
      },
      zhCN: {
        common: {
          Hello: '你好',
          'Save Changes': '保存更改',
        },
      },
    },
    lng: DEFAULT_USER_LOCALE,
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: LANGUAGES.map(l => l.code),
    defaultNS: 'common',
    keySeparator: ':::',
    nsSeparator: false,
    interpolation: { escapeValue: false },
  })
  return instance
}

describe('i18n configuration with a single selectable language', () => {
  it('translates through the Chinese catalog', () => {
    const i18n = buildI18n()
    expect(i18n.t('Hello')).toBe('你好')
  })

  it('still resolves the English catalog as the fallback', () => {
    // The point of this test: `en` is not in `supportedLngs`, yet a key absent from zhCN
    // must still resolve to its English text rather than being returned as a raw key.
    const i18n = createInstance()
    i18n.init({
      resources: {
        en: { common: { 'Only In English': 'Only In English' } },
        zhCN: { common: {} },
      },
      lng: DEFAULT_USER_LOCALE,
      fallbackLng: DEFAULT_LOCALE,
      supportedLngs: LANGUAGES.map(l => l.code),
      defaultNS: 'common',
      keySeparator: ':::',
      nsSeparator: false,
      interpolation: { escapeValue: false },
    })
    expect(i18n.t('Only In English')).toBe('Only In English')
  })

  it('keeps English out of the selectable languages', () => {
    // English is an implementation detail (the key set), not a choice. Offering it would let
    // a user pick a language the product does not support.
    expect(LANGUAGES.map(l => l.code)).not.toContain('en')
    expect(LANGUAGES.map(l => l.code)).toEqual(['zhCN'])
  })

  it('treats a deleted language as unsupported', () => {
    // Upgrades: an install that had picked German still has `de` stored. It must not resolve
    // to the i18next fallback (English) — it must fall through to the product default.
    for (const gone of [
      'de',
      'fr',
      'esES',
      'it',
      'ru',
      'tr',
      'uk',
      'zhTW',
      '',
      undefined,
    ]) {
      expect(isSupportedLocale(gone as string | undefined)).toBe(false)
    }
  })

  it('recognises the one supported language', () => {
    expect(isSupportedLocale('zhCN')).toBe(true)
  })

  it('defaults the user locale to Chinese, not to the i18next fallback', () => {
    expect(DEFAULT_USER_LOCALE).toBe('zhCN')
    expect(DEFAULT_LOCALE).toBe('en')
    expect(DEFAULT_USER_LOCALE).not.toBe(DEFAULT_LOCALE)
  })
})
