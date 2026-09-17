import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createInstance } from 'i18next'
import yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

/**
 * `<Trans>` keys must be reachable too, and they are easier to get wrong than `t()` keys.
 *
 * `t()` takes a plain sentence, but a `Trans` key can contain markup, and i18next decodes
 * HTML entities in it before lookup. The code here wrote `&#123;&#123;<b>{{name}}</b>&#125;&#125;`
 * intending "literal braces around a bolded value"; after decoding that is
 * `{{<b>{{name}}</b>}}`, which is not a valid interpolation — no catalog entry can match it,
 * and the string rendered in English.
 *
 * These tests run the real catalogs through a real i18next, so they fail for that class of
 * mistake rather than only for a plainly absent key.
 */
function buildI18n() {
  const base = path.resolve(__dirname, 'lang')
  // i18next types `resources` as its own `Resource` shape; a plain nested Record is not
  // assignable to it because the leaf values must be string maps.
  const resources: Record<string, Record<string, Record<string, string>>> = {}
  for (const lang of readdirSync(base)) {
    resources[lang] = {}
    for (const f of readdirSync(path.join(base, lang))) {
      if (!f.endsWith('.yaml')) continue
      resources[lang][f.replace(/\.yaml$/, '')] = yaml.load(
        readFileSync(path.join(base, lang, f), 'utf8')
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

describe('<Trans> keys resolve to Chinese', () => {
  const i18n = buildI18n()

  // The exact keys the component passes, after i18next's entity decoding.
  const keys: Array<[string, string]> = [
    [
      'common',
      'Field <b>{{Clipboard}}</b> has been found in the template. This allows you to copy text to the clipboard, and it will be inserted into the template',
    ],
    ['dashboard', 'Field {{name}} has been found in the template'],
    ['dashboard', 'Disabled field {{name}} has been found in the template'],
    [
      'common',
      'Add <b>{{Clipboard}}</b> field to template. This allows you to copy text to the clipboard, and it will be inserted into the template',
    ],
    ['dashboard', 'Add field <b>{{name}}</b> into the template'],
    ['dashboard', 'Disabled field <b>{{name}}</b> has been found in the template'],
  ]

  for (const [ns, key] of keys) {
    it(`resolves "${key.slice(0, 50)}..." (${ns})`, () => {
      const value = String(i18n.t(key, { ns, defaultValue: '' }))
      expect(value, 'no Chinese translation resolved for this key').not.toBe('')
      expect(value).not.toBe(key)
      // A resolved translation must keep the interpolation placeholder intact, or the
      // rendered tooltip would show the raw {{name}} instead of the field's label.
      if (key.includes('{{name}}')) expect(value).toContain('{{name}}')
      if (key.includes('{{Clipboard}}')) expect(value).toContain('{{Clipboard}}')
    })
  }

  it('has no catalog key carrying a stray "? " prefix', () => {
    // YAML's explicit-key marker is syntax, not part of the key. One entry had it inside the
    // quotes, making a key that could never be looked up.
    const offenders: string[] = []
    for (const lang of readdirSync(path.resolve(__dirname, 'lang'))) {
      for (const f of readdirSync(path.resolve(__dirname, 'lang', lang))) {
        if (!f.endsWith('.yaml')) continue
        const data = yaml.load(
          readFileSync(path.resolve(__dirname, 'lang', lang, f), 'utf8')
        ) as Record<string, string> | null
        for (const k of Object.keys(data ?? {})) {
          if (k.startsWith('? ')) offenders.push(`${lang}/${f} :: ${k.slice(0, 60)}`)
        }
      }
    }
    expect(offenders, `keys with a stray '? ' prefix:\n${offenders.join('\n')}`).toEqual(
      []
    )
  })
})
