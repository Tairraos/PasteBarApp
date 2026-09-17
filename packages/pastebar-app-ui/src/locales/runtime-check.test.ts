import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createInstance } from 'i18next'
import yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

/**
 * Loads the real catalogs into a real i18next and asserts that the strings the user
 * reported seeing in English now resolve to Chinese.
 *
 * Static checks prove a key EXISTS; only this proves it is REACHABLE, because the lookup
 * goes through i18next's namespace, key-separator and plural handling.
 */
function loadCatalogs() {
  const base = path.resolve(__dirname, 'lang')
  const resources: Record<string, Record<string, Record<string, string>>> = {}
  for (const lang of readdirSync(base)) {
    resources[lang] = {}
    for (const file of readdirSync(path.join(base, lang))) {
      if (!file.endsWith('.yaml')) continue
      const ns = file.replace(/\.yaml$/, '')
      resources[lang][ns] = yaml.load(
        readFileSync(path.join(base, lang, file), 'utf8')
      ) as Record<string, string>
    }
  }
  const i18n = createInstance()
  i18n.init({
    resources,
    lng: 'zhCN',
    fallbackLng: 'en',
    supportedLngs: ['zhCN'],
    defaultNS: 'common',
    keySeparator: ':::',
    nsSeparator: false,
    interpolation: { escapeValue: false },
  })
  return i18n
}

describe('Chinese catalogs resolve at runtime', () => {
  const i18n = loadCatalogs()

  // These are the exact strings reported as showing English in the UI.
  const reported: Array<[string, string, string]> = [
    ['settings2', 'Copy items only (no auto-paste)', '仅复制条目'],
    ['settings2', 'Auto-close window after action', '操作后自动关闭窗口'],
    [
      'settings2',
      'When enabled, single click will copy/paste items in Quick Paste window. If global single click is also enabled, both settings work together.',
      '单击即可',
    ],
    [
      'settings2',
      'When enabled, the Quick Paste window will automatically close after copying or pasting an item.',
      '自动关闭',
    ],
  ]

  for (const [ns, key, expectedFragment] of reported) {
    it(`translates "${key.slice(0, 45)}..." (${ns})`, () => {
      const value = i18n.t(key, { ns })
      expect(value, `key returned untranslated`).not.toBe(key)
      expect(value).toContain(expectedFragment)
    })
  }

  it('resolves a nested ::: key', () => {
    // Type:::Image Base64 is the shape that a naive parser reports as missing.
    expect(i18n.t('Type:::Image Base64', { ns: 'common' })).toBe('图像 Base64')
  })

  it('resolves a key containing a colon', () => {
    // `Permission Check Failed: ...` is written in YAML with explicit `? key` syntax.
    const value = i18n.t(
      'Permission Check Failed: PasteBar has not been successfully added to Accessibility settings. Please grant the required permissions and click Done again.',
      { ns: 'common' }
    )
    expect(value).not.toContain('Permission Check Failed')
  })

  it('does not leak an untranslated key anywhere in the reported namespaces', () => {
    // Broad sweep: every key in the four namespaces the user is most likely to browse must
    // return something other than itself. This catches keys that exist in en but were never
    // added to zhCN in the right place.
    const base = path.resolve(__dirname, 'lang')
    const enFiles = ['settings2', 'common', 'dashboard', 'menus']
    const offenders: string[] = []

    for (const ns of enFiles) {
      const en = yaml.load(
        readFileSync(path.join(base, 'en', `${ns}.yaml`), 'utf8')
      ) as Record<string, string>
      const zh = yaml.load(
        readFileSync(path.join(base, 'zhCN', `${ns}.yaml`), 'utf8')
      ) as Record<string, string>

      for (const key of Object.keys(en)) {
        // A key whose zhCN entry is deliberately identical is not an offender: proper nouns
        // and technical terms are untranslatable (`PasteBar`, `HTML`, `URL`, `Bearer Token`).
        // Only a key with NO zhCN entry at all should fall through to English.
        const isPlural = Object.keys(en).some(k => k.startsWith(key + '_'))
        if (isPlural && `${key}_other` in zh) continue
        if (key in zh) continue

        const value = String(i18n.t(key, { ns }))
        if (value === key) offenders.push(`${ns} :: ${key}`)
      }
    }

    expect(
      offenders,
      `these keys returned untranslated:\n${offenders.join('\n')}`
    ).toEqual([])
  })
})
