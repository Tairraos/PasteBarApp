import { readFileSync } from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

import { TEXT_TRANSFORMS, TRANSFORM_CATEGORIES } from '../lib/text-transforms'

/**
 * Some `t()` calls take a variable: `t(category.label)`, `t(transform.label)`,
 * `t(tourName)`. A static scan cannot see those keys, so the gate is blind to them — the
 * strings come from data structures instead of literals.
 *
 * Closing that gap means checking the DATA rather than the call site: whether each label the
 * registry defines has an entry in the zhCN catalog.
 *
 * The namespace matters and is easy to get wrong: the menu calls
 * `t(transform.label, { ns: 'specialCopyPaste' })`, NOT `common`. Checking against the wrong
 * catalog reports all 47 labels as missing when they are in fact translated.
 */
/** Reads the zhCN entry directly, so "verbatim on purpose" can be told from "absent". */
function catalogZh(key: string): string | undefined {
  const file = path.resolve(__dirname, 'lang/zhCN/specialCopyPaste.yaml')
  const data = yaml.load(readFileSync(file, 'utf8')) as Record<string, string>
  return data[key]
}

/**
 * True when the label has a zhCN catalog entry at all.
 *
 * Comparing the resolved value to the key would call `HTML`, `URL` and `camelCase` defects:
 * they are deliberately identical in both catalogs. Presence is what matters — a label with
 * no entry renders English because i18next falls back, which is the actual bug.
 */
function resolves(label: string): boolean {
  return catalogZh(label) !== undefined
}

describe('data-driven translation keys', () => {
  it('every transform label resolves', () => {
    const untranslated = TEXT_TRANSFORMS.filter(t => !resolves(t.label)).map(t => t.label)
    expect(
      untranslated,
      `transform labels with no translation:\n${untranslated.join('\n')}`
    ).toEqual([])
  })

  it('every category label resolves', () => {
    const untranslated = TRANSFORM_CATEGORIES.filter(c => !resolves(c.label)).map(
      c => c.label
    )
    expect(
      untranslated,
      `category labels with no translation:\n${untranslated.join('\n')}`
    ).toEqual([])
  })

  it('leaves case-convention names untranslated on purpose', () => {
    // `camelCase`, `snake_case`, `kebab-case`, `PascalCase` are the names of the conventions
    // themselves. A Chinese translation would obscure which one the entry applies, so the
    // zhCN catalog keeps them verbatim. This test documents that the exemption above is a
    // decision rather than an oversight — and pins the exact set, so a genuinely missing
    // label cannot hide behind it.
    const intentionallyVerbatim = ['camelCase', 'snake_case', 'kebab-case', 'PascalCase']
    for (const label of intentionallyVerbatim) {
      expect(catalogZh(label), `${label} should be present verbatim in zhCN`).toBe(label)
    }
  })
})
