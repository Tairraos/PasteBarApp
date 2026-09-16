import { describe, expect, it, vi } from 'vitest'

import {
  applyTransform,
  getAllCategoryIds,
  getCategoryById,
  getTransformById,
  getTransformIdsInCategory,
  TEXT_TRANSFORMS,
  TRANSFORM_CATEGORIES,
} from '~/lib/text-transforms'

/**
 * These tests describe the *registry's* invariants rather than re-testing each transform's
 * string manipulation — those are the transform author's business. What matters here is
 * that the registry itself is coherent, because the UI builds its menu from it and a
 * duplicate id silently makes one entry unreachable.
 */
describe('text transform registry', () => {
  it('exposes at least one category and one transform', () => {
    expect(TRANSFORM_CATEGORIES.length).toBeGreaterThan(0)
    expect(TEXT_TRANSFORMS.length).toBeGreaterThan(0)
  })

  it('gives every transform a unique id', () => {
    const ids = TEXT_TRANSFORMS.map(t => t.id)
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i)
    expect(duplicates).toEqual([])
  })

  it('gives every category a unique id', () => {
    const ids = TRANSFORM_CATEGORIES.map(c => c.id)
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i)
    expect(duplicates).toEqual([])
  })

  it('gives every transform a label and a callable transform function', () => {
    for (const t of TEXT_TRANSFORMS) {
      expect(t.id, `transform ${t.id} is missing a label`).toBeTruthy()
      expect(typeof t.transform, `transform ${t.id} is not callable`).toBe('function')
    }
  })

  it('describes every transform in exactly one place', () => {
    // A category with subcategories must not also carry direct transforms, or its
    // transforms would appear twice in TEXT_TRANSFORMS.
    for (const category of TRANSFORM_CATEGORIES) {
      if (category.subcategories) {
        expect(
          category.transforms ?? [],
          `category ${category.id} has both subcategories and direct transforms`
        ).toEqual([])
      }
    }
  })
})

describe('getTransformById / getCategoryById', () => {
  it('finds a transform that exists', () => {
    const first = TEXT_TRANSFORMS[0]
    expect(getTransformById(first.id)).toBe(first)
  })

  it('returns undefined for an unknown transform rather than throwing', () => {
    expect(getTransformById('definitely-not-a-transform')).toBeUndefined()
  })

  it('finds a category that exists', () => {
    const first = TRANSFORM_CATEGORIES[0]
    expect(getCategoryById(first.id)).toBe(first)
  })

  it('returns undefined for an unknown category', () => {
    expect(getCategoryById('nope')).toBeUndefined()
  })
})

describe('applyTransform', () => {
  it('applies the transform and returns its result', async () => {
    const target = TEXT_TRANSFORMS[0]
    // Calling the real transform keeps this test honest about the async wrapper without
    // asserting on the transform's own output, which is not this suite's subject.
    const expected = await Promise.resolve(target.transform('  Hello World  '))
    await expect(applyTransform('  Hello World  ', target.id)).resolves.toBe(expected)
  })

  it('rejects with a named error for an unknown transform', async () => {
    await expect(applyTransform('x', 'no-such-transform')).rejects.toThrow(
      'Transform not found: no-such-transform'
    )
  })

  it('propagates a throwing transform instead of swallowing it', async () => {
    // Regression guard: an earlier shape of this helper caught and logged, then returned
    // the original text, which made a broken transform look like a no-op transform.
    const failing = TEXT_TRANSFORMS[0]
    const spy = vi.spyOn(failing, 'transform').mockImplementation(() => {
      throw new Error('boom')
    })

    await expect(applyTransform('x', failing.id)).rejects.toThrow('boom')
    spy.mockRestore()
  })

  it('awaits an async transform rather than returning a promise', async () => {
    const asyncTransform = TEXT_TRANSFORMS[0]
    const spy = vi
      .spyOn(asyncTransform, 'transform')
      .mockImplementation(() => Promise.resolve('resolved') as unknown as string)

    await expect(applyTransform('x', asyncTransform.id)).resolves.toBe('resolved')
    spy.mockRestore()
  })
})

describe('getAllCategoryIds / getTransformIdsInCategory', () => {
  it('returns one id per category', () => {
    expect(getAllCategoryIds()).toEqual(TRANSFORM_CATEGORIES.map(c => c.id))
  })

  it('returns the transform ids of a category', () => {
    const withTransforms = TRANSFORM_CATEGORIES.find(c => c.transforms?.length)
    if (withTransforms) {
      expect(getTransformIdsInCategory(withTransforms.id)).toEqual(
        withTransforms.transforms!.map(t => t.id)
      )
    }
  })

  it('returns an empty list for an unknown category instead of throwing', () => {
    expect(getTransformIdsInCategory('nope')).toEqual([])
  })
})
