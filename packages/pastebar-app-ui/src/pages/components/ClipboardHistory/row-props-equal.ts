import { CSSProperties } from 'react'

function areStylesEqual(prev: unknown, next: unknown): boolean {
  if (prev === next) {
    return true
  }
  if (
    typeof prev !== 'object' ||
    prev === null ||
    typeof next !== 'object' ||
    next === null
  ) {
    return false
  }
  const prevStyle = prev as CSSProperties
  const nextStyle = next as CSSProperties
  return (
    prevStyle.position === nextStyle.position &&
    prevStyle.left === nextStyle.left &&
    prevStyle.top === nextStyle.top &&
    prevStyle.width === nextStyle.width &&
    prevStyle.height === nextStyle.height
  )
}

/**
 * Props equality for virtualized history rows. ISSUE-045.
 *
 * react-window hands every row a fresh `style` object on each render and the pages pass
 * inline event-handler closures, so React.memo's default shallow compare never holds and
 * every parent state change re-renders all visible rows. Event handlers are treated as
 * equal — they are only invoked from DOM events and their behavior does not change
 * between renders — while `style` is compared by value because it carries the row's
 * absolute position inside the virtual list.
 */
export function areHistoryRowPropsEqual<P extends object>(prev: P, next: P): boolean {
  const prevKeys = Object.keys(prev) as Array<keyof P>
  const nextKeys = Object.keys(next) as Array<keyof P>

  if (prevKeys.length !== nextKeys.length) {
    return false
  }

  for (const key of nextKeys) {
    const prevValue = prev[key]
    const nextValue = next[key]

    if (key === 'style') {
      if (!areStylesEqual(prevValue, nextValue)) {
        return false
      }
      continue
    }

    if (typeof prevValue === 'function' && typeof nextValue === 'function') {
      continue
    }

    if (!Object.is(prevValue, nextValue)) {
      return false
    }
  }

  return true
}
