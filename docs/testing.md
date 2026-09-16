# Testing

> Last verified: 2026-09-16 · Branch `harnessing` · **Status: Phase 5 pending.**

**There are currently no automated tests in this repository.** `bash scripts/harness/scan.sh`
reports `rust.test_markers = 0`, and the five files that match test vocabulary are vendored
copies under `components/libs/react-twitter-embed/tests/cypress/` (ISSUE-006).

Until Phase 5 lands, verification relies on:

1. `bash scripts/harness/check-all.sh` — the static gates (lint, types, format, IPC drift, docs).
2. [`smoke-checklist.md`](smoke-checklist.md) — the manual flows, which a green gate run does
   **not** replace.

This document specifies what will exist, so that Phase 5 builds it against a fixed target
rather than inventing structure as it goes.

---

## 1. The pyramid

| Level          | Tool                                          | Scope                                                              | Runs in              |
| -------------- | --------------------------------------------- | ------------------------------------------------------------------ | -------------------- |
| Rust unit      | `cargo test`                                  | pure logic in `services/`, Diesel queries against SQLite in-memory | CI (`macos-latest`)  |
| Frontend unit  | `vitest` + `@testing-library/react` + `jsdom` | stores, hooks, pure helpers                                        | CI (`ubuntu-latest`) |
| Contract       | vitest against the fake backend               | every documented IPC command/event                                 | CI                   |
| Smoke (manual) | [`smoke-checklist.md`](smoke-checklist.md)    | window lifecycle, tray, OS clipboard                               | human, per wave      |

No heavy e2e: automating Tauri windows is expensive and brittle relative to what it catches
here (HARNESS_PLAN §10.4). The fake backend plus the contract tests cover the seam that e2e
would otherwise be used for.

---

## 2. Rust tests

### Layout

Unit tests live beside the code they test, in a `#[cfg(test)] mod tests` block at the bottom
of the file — the standard Rust convention, and it keeps a test next to the invariant it
protects.

Integration tests that need a database live in `src-tauri/tests/`.

### What must be covered (Phase 5.3 / 5.5)

| Target                                                              | Why                                                        | Test file                             |
| ------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------- |
| `utils::mask_value`                                                 | security-relevant masking; edge cases at 1–2 char words    | `services/utils.rs` `#[cfg(test)]`    |
| `utils::apply_global_templates`                                     | regex substitution over user-supplied templates            | same                                  |
| `db::to_relative_image_path` ↔ `to_absolute_image_path`            | **round-trip property**; the on-disk format contract       | `src-tauri/tests/path_transform.rs`   |
| `history_service::process_history_item`                             | preview truncation, mask application                       | `src-tauri/tests/history.rs`          |
| `history_service` retention (`delete_clipboard_history_older_than`) | data-loss-adjacent; pinned/starred preservation            | `src-tauri/tests/retention.rs`        |
| `format_converter` round-trips                                      | json ↔ yaml ↔ csv are pure functions                     | `src-tauri/tests/format.rs`           |
| language detection thresholds                                       | `min_lines_required`, enabled/prioritized lists            | `src-tauri/tests/language.rs`         |
| `user_settings_service` config bootstrap                            | ISSUE-001: config found / custom path set / config missing | `src-tauri/tests/config_bootstrap.rs` |

### Database strategy

Use a real SQLite database in memory, driven by the **real** `migrations/` directory, so a
migration that would fail in production fails in the test:

```rust
// Pattern for src-tauri/tests/*.rs — the pool is process-global, so DB-touching
// tests must not run concurrently against it. Prefer direct connections in tests.
fn test_connection() -> SqliteConnection {
    let mut conn = SqliteConnection::establish(":memory:").unwrap();
    conn.run_pending_migrations(crate::MIGRATIONS).unwrap();
    conn
}
```

This requires exposing `MIGRATIONS` (currently private in `db.rs`) or re-embedding it in a
test-only module. That small refactor is part of Phase 5.3.

**Constraint:** `DB_POOL_CONNECTION` is a process-global `lazy_static`, so tests that touch it
interfere with each other. Services that take a connection parameter are easy to test;
services that call `establish_pool_db_connection()` internally are not. Wave W1/W3 reduce the
number of the latter. Where a function still depends on the global pool, mark the test
`#[serial]` and document why.

### Property tests

`proptest` for the two genuine invariants:

1. **Path round-trip:** for any path under the data directory,
   `to_absolute_image_path(to_relative_image_path(p)) == p`, and for any path _outside_ it,
   both functions are the identity.
2. **Preview truncation:** `process_history_item` never panics and never underflows
   (ISSUE-025) for any generated value, including empty strings, values with more newlines
   than characters, and non-ASCII text.

---

## 3. Frontend tests

### Layout

```
packages/pastebar-app-ui/
  src/**/*.test.ts(x)        unit tests, beside the code (excluded from the reachability scan)
  src/test/
    setup.ts                 jsdom setup, Tauri mock registration
    fake-backend.ts          in-memory Tauri command handlers (Phase 5.2)
    factories.ts             typed fixtures
```

`*.test.ts(x)` files are excluded from `scan.sh` metrics, the reachability scan, and the lint
baseline.

### The fake backend (Phase 5.2)

Every frontend test that touches IPC runs against an in-memory implementation driven by
[`contracts/tauri-ipc.md`](../contracts/tauri-ipc.md):

```ts
// src/test/fake-backend.ts (shape, not final)
import { vi } from 'vitest'

export function installFakeBackend(initial: Partial<Db> = {}) {
  const db = { history: [], items: [], collections: [], ...initial }
  const handlers: Record<string, (args: unknown) => unknown> = {
    get_clipboard_histories: ({ limit }) => db.history.slice(0, limit ?? 100),
    // one entry per documented command; unimplemented commands THROW rather than
    // returning undefined, so a missing fixture is a loud failure, not a silent pass
  }
  vi.mock('@tauri-apps/api/tauri', () => ({
    invoke: (cmd: string, args: unknown) => {
      const h = handlers[cmd]
      if (!h)
        throw new Error(`fake backend: '${cmd}' has no handler — add it or fix the call`)
      return Promise.resolve(h(args))
    },
  }))
  return db
}
```

**Design rule:** an unimplemented command throws. A fake backend that silently returns
`undefined` produces tests that pass against a lie.

### What must be covered

| Target                                                   | Why                                      |
| -------------------------------------------------------- | ---------------------------------------- |
| `settingsStore` update + `settings-store-sync` broadcast | every setting flows through here         |
| store rehydration on a sync event                        | cross-window consistency is event-driven |
| `lib/commands.ts` wrappers                               | the IPC boundary                         |
| pure helpers in `lib/utils.ts`, `lib/text-transforms.ts` | cheap, high-value                        |
| component render for the split-out components in W4      | the split must not change rendering      |

---

## 4. Coverage ratchet (Phase 5.6)

Coverage is recorded as a baseline file and **may only go up** (GOLDEN-RULES R9).

| Scope                               | Phase 5 target |
| ----------------------------------- | -------------- |
| frontend `lib/`, `store/`, `hooks/` | ≥ 50%          |
| backend `services/`                 | ≥ 60%          |
| files touched by Phase 4 refactors  | ≥ 80%          |

Vendored code (`components/libs/**`, `src-tauri/libs/**`) is excluded from coverage, matching
every other gate.

`cargo-llvm-cov` is not used — the plan rejected it as too heavy for this repository. Backend
coverage is reported for `services/` only.

---

## 5. Naming and conventions

| Rule                  | Detail                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| File naming           | `*.test.ts(x)` for frontend, beside the code; `src-tauri/tests/*.rs` for integration                   |
| Test naming           | `describe('<unit>', …)` / `it('<expected behaviour>')` — describe the behaviour, not the function name |
| No network            | Tests never hit the network; stub `reqwest`-backed commands in the fake backend                        |
| No sleeps             | Use fake timers; a `setTimeout` in a test is a flaky test                                              |
| One assertion subject | A test that asserts five unrelated things reports one failure for five bugs                            |
| Fixtures are typed    | Build fixtures with the real types, so a contract change breaks the fixture at compile time            |

---

## 6. Running

```bash
npm test                          # vitest (UI package)
npm run test:rust                 # cargo test (src-tauri)
bash scripts/harness/check-all.sh # both, plus every other gate
```

CI runs `tests` on `ubuntu-latest` (vitest) and `rust` on `macos-latest` (`cargo test`).
macOS is required for the Rust job because tray and accessibility code is platform-gated.

---

## 7. Breaking-change verification (Phase 5.3 acceptance)

A suite that never fails is worthless. Before Phase 5 is declared done, revert the fix for
three separate `BUG` issues (ISSUE-002 and ISSUE-014 are good candidates — startup ordering
and a scheduler that never ticks) and confirm the corresponding test **fails**. A test that
stays green when its subject is broken is deleted, not kept.
