import BBCodeParser from '~/libs/bbcode'
import { describe, expect, it } from 'vitest'

// Guards the linkify-it 5 -> 6 major upgrade (ISSUE-035), which was taken to close a
// quadratic-complexity DoS advisory in the `mailto:` validator scan loop.
//
// That advisory is not academic for this app: linkification runs over clipboard content,
// which is by definition text the user did not write. The upgrade was also a real API
// break — linkify-it 6 replaced the callable default export with named exports
// (`linkifyit`, `LinkifyIt`, `REBuilder`), so every call site had to change.
//
// These assertions therefore pin the *behaviour* the app depends on, not the import shape:
// if a future bump changes which URLs are detected, what `raw`/`url` contain, or how the
// match offsets map back onto the source string, the failure shows up here rather than as
// broken links in a user's clipboard.
//
// `linkifyText` returns `React.ReactNode[]` — a mix of plain-string slices and JSX spans.
// The helper below flattens that into a comparable string form so the assertions read as
// "what the user sees".

const parser = new BBCodeParser({})

/**
 * Flatten linkifyText's result to a marker string: plain text stays, links become
 * [text](url).
 *
 * Note the two return shapes: with no matches the method returns the input STRING
 * unchanged (an early return, so the no-link fast path allocates nothing), and only with
 * matches does it return a node array. A helper that assumed an array would pass on linked
 * input and crash on the far more common unlinked input.
 */
function render(text: string): string {
  const result = parser.linkifyText(text) as string | Array<unknown>
  if (typeof result === 'string') return result
  return result
    .map(node => {
      if (typeof node === 'string') return node
      if (node && typeof node === 'object' && 'props' in node) {
        const props = (node as { props: { children?: unknown; onClick?: unknown } }).props
        const label = typeof props.children === 'string' ? props.children : ''
        return `[${label}](${label})`
      }
      return ''
    })
    .join('')
}

describe('linkifyText (linkify-it 6)', () => {
  it('leaves text with no URL completely untouched', () => {
    // The common case by far: most clipboard text has no link, and it must come back
    // byte-identical rather than reconstructed from slices.
    expect(render('just some words')).toBe('just some words')
    expect(render('')).toBe('')
  })

  it('detects an http URL and preserves the surrounding text', () => {
    const out = render('see https://example.com/x for details')
    expect(out).toBe('see [https://example.com/x](https://example.com/x) for details')
  })

  it('detects a bare domain without a scheme — the v5 behaviour linkify-it 6 dropped', () => {
    // THE regression this whole test file exists for. linkify-it 6 flipped `fuzzyLink` to
    // false (it was true in 5), so `example.com` stopped being detected and only
    // `https://example.com` survived — a bare domain pasted into a clip quietly stopped
    // being clickable. `createLinkify()` sets `fuzzyLink: true` to restore it, and this
    // assertion is what makes a future bump that flips it back fail loudly instead of
    // silently.
    expect(render('go to example.com now')).toBe('go to [example.com](example.com) now')
    expect(render('www.example.com')).toBe('[www.example.com](www.example.com)')

    const email = parser.linkifyText('write to someone@example.com') as Array<unknown>
    const link = email.find(n => n && typeof n === 'object' && 'props' in n) as {
      props: { children: string }
    }
    expect(link.props.children).toBe('someone@example.com')
  })

  it('detects every URL in a multi-link string, in order', () => {
    // Two links in one string is the case that depends on match offsets being applied
    // against the ORIGINAL string: the parser slices between `lastIndex` and `match.index`,
    // so a wrong offset silently reorders or duplicates the text around the links.
    const out = render('a https://one.example b https://two.example c')
    expect(out).toBe(
      'a [https://one.example](https://one.example) b [https://two.example](https://two.example) c'
    )
  })

  it('does not treat a trailing punctuation mark as part of the URL', () => {
    const out = render('read https://example.com/x.')
    expect(out).toBe('read [https://example.com/x](https://example.com/x).')
  })

  it('handles the mailto heavy input the DoS advisory was about, quickly', () => {
    // The advisory: a quadratic scan loop in the `mailto:` validator. The regression it
    // guards against is pathological time, so this asserts a generous wall-clock bound on
    // input shaped to trigger the slow path. A quadratic implementation blows well past
    // this; the linear one finishes in single-digit milliseconds.
    const evil = `mailto:${'a'.repeat(4000)}@${'b'.repeat(4000)}.com ${'x'.repeat(
      2000
    )}@ `
    const started = Date.now()
    parser.linkifyText(evil)
    const elapsed = Date.now() - started

    expect(elapsed).toBeLessThan(1000)
  })

  it('returns plain text unchanged when given only whitespace', () => {
    expect(render('   \n\t  ')).toBe('   \n\t  ')
  })
})
