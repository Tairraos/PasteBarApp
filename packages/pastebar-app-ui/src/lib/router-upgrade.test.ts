import { describe, expect, it, vi } from 'vitest'

// Guards the react-router-dom upgrade (6.20 -> 6.30.6, ISSUE-032).
//
// The audit flagged react-router-dom for XSS via open redirect, and the fix is a minor
// bump. A minor bump is *usually* safe, which is exactly why it gets merged without
// verification — but this app leans on the v6.4+ data-router API rather than the older
// component API, and `lazy` route loaders are the part most likely to shift.
//
// These tests pin the API surface main.tsx actually consumes, so a future bump that
// removes or renames it fails here instead of at runtime in a packaged desktop app where
// the failure is a blank window. They do not test routing *behaviour* — that needs a
// rendered app with its Tauri IPC present, and belongs in a component test.

describe('react-router-dom API surface used by main.tsx', () => {
  it('exports createBrowserRouter and RouterProvider', async () => {
    const rr = await import('react-router-dom')
    expect(typeof rr.createBrowserRouter).toBe('function')
    expect(typeof rr.RouterProvider).toBe('function')
  })

  it('exports the hooks App.tsx uses', async () => {
    // App.tsx:11 imports these three; a rename here breaks the shell on every route.
    const rr = await import('react-router-dom')
    expect(typeof rr.useLocation).toBe('function')
    expect(typeof rr.useNavigate).toBe('function')
    expect(typeof rr.Outlet).not.toBe('undefined')
  })

  it('is on the v6 major the code is written against', async () => {
    // The codebase uses the v6 API. react-router v7 renamed the package entry points and
    // changed the future-flag defaults, so an accidental major bump must fail loudly
    // rather than silently changing redirect and relative-path behaviour.
    const pkg = await import('react-router-dom/package.json')
    expect(pkg.default.version).toMatch(/^6\./)
  })

  // These tests deliberately do NOT call createMemoryRouter. Constructing one runs
  // `router.initialize()`, which performs a real navigation through
  // `createClientSideRequest` -> `new Request(...)`. Under jsdom that throws
  // "Expected signal (\"AbortSignal {}\") to be an instance of AbortSignal", because jsdom's
  // AbortSignal comes from a different realm than the one undici validates against. It
  // surfaces as an unhandled rejection that makes the entire suite's result unreliable, so
  // it is not something to suppress or work around — the route-matching behaviour is better
  // covered by a component test that mounts the app, which is where a broken route actually
  // matters. What is pinned here is the API surface and the route-object shape, which is
  // what a dependency bump breaks.
  it('normalises nested children and lazy loaders through matchRoutes', async () => {
    // `matchRoutes` is the matcher the data router uses internally, and it is pure: it
    // takes a route array and a pathname and returns matches, with no navigation and so no
    // fetch. That makes it the right level to assert that main.tsx's route tree still
    // resolves after a version bump.
    const { matchRoutes } = await import('react-router-dom')
    const routes = [
      {
        path: '/',
        children: [
          { path: 'history', element: null },
          { path: 'settings', element: null },
        ],
      },
    ]

    const matched = matchRoutes(routes, '/history')
    expect(matched).not.toBeNull()
    expect(matched!.map(m => m.route.path)).toEqual(['/', 'history'])

    expect(matchRoutes(routes, '/settings')!.map(m => m.route.path)).toEqual([
      '/',
      'settings',
    ])
  })

  it('accepts a `lazy` route definition in the route object shape main.tsx uses', async () => {
    // main.tsx:34 uses `lazy: () => import('./layout/Layout')` for code-splitting. Rather
    // than construct a router (see the note above), assert that the shape is accepted by the
    // matcher and that the loader is preserved rather than dropped during normalisation —
    // a dropped `lazy` would render an empty shell with no error.
    const { matchRoutes } = await import('react-router-dom')
    const lazy = () => Promise.resolve({ Component: () => null })
    const routes = [{ path: '/', lazy, children: [{ path: 'dashboard', element: null }] }]

    const matched = matchRoutes(routes, '/dashboard')
    expect(matched).not.toBeNull()
    expect(typeof matched![0].route.lazy).toBe('function')
  })

  it('falls through to a splat route for an unknown path', async () => {
    // main.tsx relies on unmatched paths being caught rather than throwing; confirm the
    // matcher's contract for a wildcard, which is what a version bump is most likely to
    // change subtly.
    const { matchRoutes } = await import('react-router-dom')
    const routes = [
      { path: '/', children: [{ path: 'history', element: null }] },
      { path: '*', element: null },
    ]

    const matched = matchRoutes(routes, '/does-not-exist')
    expect(matched).not.toBeNull()
    expect(matched!.map(m => m.route.path)).toEqual(['*'])
  })
})

describe('lodash-es and js-yaml, also bumped for ISSUE-032', () => {
  it('lodash-es still exports the helpers the stores use', async () => {
    const _ = await import('lodash-es')
    // These are the ones actually imported across src/; `template` is deliberately NOT
    // exercised here — it is the vulnerable entry point, and it is not used by this app.
    for (const name of ['debounce', 'throttle', 'cloneDeep', 'isEqual', 'uniqBy']) {
      expect(typeof _[name], `lodash-es.${name}`).toBe('function')
    }
  })

  it('lodash-es does not use _.template anywhere in this codebase', async () => {
    // Pins the reason the lodash advisory is not exploitable here: the vulnerable API is
    // `_.template`, which is never called. If someone adds it, this test fails and the
    // advisory becomes actionable instead of merely present.
    const { readFileSync, readdirSync, statSync } = await import('node:fs')
    const path = await import('node:path')
    const root = path.resolve(__dirname, '..')

    const offenders = []
    const walk = dir => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry)
        if (statSync(full).isDirectory()) {
          if (entry === 'libs' || entry === 'node_modules') continue
          walk(full)
        } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
          const usesTemplate = /\b_\.template\s*\(|\blodash\w*\.template\s*\(/.test(
            readFileSync(full, 'utf8')
          )
          if (usesTemplate) offenders.push(path.relative(root, full))
        }
      }
    }
    walk(root)

    expect(offenders).toEqual([])
  })

  it('js-yaml still parses documents, the only use in this repo', async () => {
    const yaml = await import('js-yaml')
    expect(yaml.load('a: 1\nb:\n  - x\n')).toEqual({ a: 1, b: ['x'] })
    // The advisory is prototype pollution via merge keys (`<<`). Pinning that a plain
    // parse still works keeps the upgrade honest without asserting on the CVE itself.
    expect(() => yaml.load('a: &x {p: 1}\nb:\n  <<: *x\n')).not.toThrow()
  })
})

// Referenced so the import is not reported as unused by lint; the module is imported for
// its type side effects in the build, not for a value here.
void vi
