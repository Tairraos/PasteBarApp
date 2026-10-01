import type { CSSProperties } from 'react'
import { describe, expect, it } from 'vitest'

import { areHistoryRowPropsEqual } from './row-props-equal'

// ISSUE-045: the virtualized history rows are wrapped in React.memo with this comparator.
// react-window hands every row a fresh `style` object and the pages pass inline event
// closures, so the comparator's decisions are what keeps a parent state change from
// re-rendering every visible row. These tests pin those decisions.

const rowStyle = (top: number): CSSProperties => ({
  position: 'absolute',
  left: 0,
  top,
  width: 100,
  height: 40,
})

describe('areHistoryRowPropsEqual', () => {
  it('is true when every prop is shallow-equal', () => {
    expect(areHistoryRowPropsEqual({ id: 1, label: 'a' }, { id: 1, label: 'a' })).toBe(
      true
    )
  })

  it('is false when a primitive prop differs', () => {
    expect(areHistoryRowPropsEqual({ id: 1 }, { id: 2 })).toBe(false)
  })

  it('is false when the key sets differ', () => {
    expect(areHistoryRowPropsEqual({ id: 1 }, { id: 1, extra: true })).toBe(false)
  })

  it('treats two function props as equal even when their references differ', () => {
    expect(areHistoryRowPropsEqual({ onClick: () => 1 }, { onClick: () => 2 })).toBe(true)
  })

  it('does not treat a function and a non-function as equal', () => {
    expect(areHistoryRowPropsEqual({ data: () => 1 }, { data: 1 })).toBe(false)
  })

  it('compares style by value: same values in a fresh object are equal', () => {
    expect(
      areHistoryRowPropsEqual({ style: rowStyle(10) }, { style: rowStyle(10) })
    ).toBe(true)
  })

  it('compares style by value: a moved row is not equal', () => {
    expect(
      areHistoryRowPropsEqual({ style: rowStyle(10) }, { style: rowStyle(20) })
    ).toBe(false)
  })

  it('compares only the virtual-list fields of style, ignoring cosmetic ones', () => {
    const prev = { style: rowStyle(10) }
    const next = { style: { ...rowStyle(10), color: 'red', background: 'blue' } }
    expect(areHistoryRowPropsEqual(prev, next)).toBe(true)
  })

  it('is false when style is an object on one side and a primitive on the other', () => {
    expect(areHistoryRowPropsEqual({ style: rowStyle(10) }, { style: 10 })).toBe(false)
    expect(areHistoryRowPropsEqual({ style: null }, { style: rowStyle(10) })).toBe(false)
  })

  it('uses Object.is for non-style props, so NaN equals NaN', () => {
    expect(areHistoryRowPropsEqual({ ratio: NaN }, { ratio: NaN })).toBe(true)
  })
})
