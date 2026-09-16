# Testing

> Last verified: 2026-09-16 · Branch `harnessing` · **Status: Phase 5 in progress.**

**The test infrastructure now exists and the gate is enforced.** Before Phase 5 this
repository had zero tests: `scan.sh` reported `rust.test_markers = 0`, and the only files
matching test vocabulary were vendored Cypress copies (ISSUE-006).

Current state:

|                  | Backend (`cargo test`)              | Frontend (`vitest`)                    |
| ---------------- | ----------------------------------- | -------------------------------------- |
| Tests            | 26                                  | 33                                     |
| Coverage ratchet | n/a                                 | 30.27% lines (baseline, may only rise) |
| Gate             | `check-all.sh` gate 9 (`test-rust`) | `check-all.sh` gate 9 (`test-js`)      |

Run them with `bash scripts/harness/check-all.sh`, or individually:
`bash scripts/harness/run-tests.sh` and `npm run test:rust`.

Coverage starts low because the ratchet is deliberately a _floor_, not a target: the point
at Phase 5 is that coverage can no longer fall. Sections 2–4 below describe the target
shape; the concrete Phase 5 obligations still outstanding are listed in §8.

Manual verification is still required for anything the suite does not cover — a green gate
run does **not** replace [`smoke-checklist.md`](harness/smoke-checklist.md).

---

## 1. The pyramid

| Level          | Tool                                               | Scope                                                              | Runs in              |
| -------------- | -------------------------------------------------- | ------------------------------------------------------------------ | -------------------- |
| Rust unit      | `cargo test`                                       | pure logic in `services/`, Diesel queries against SQLite in-memory | CI (`macos-latest`)  |
| Frontend unit  | `vitest` + `@testing-library/react` + `jsdom`      | stores, hooks, pure helpers                                        | CI (`ubuntu-latest`) |
| Contract       | vitest against the fake backend                    | every documented IPC command/event                                 | CI                   |
| Smoke (manual) | [`smoke-checklist.md`](harness/smoke-checklist.md) | window lifecycle, tray, OS clipboard                               | human, per wave      |

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
[`contracts/tauri-ipc.md`](contracts/tauri-ipc.md):

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

---

## 8. Phase 5 — outstanding obligations

Done:

- [x] vitest + `@testing-library/react` + jsdom installed and configured
      (`packages/pastebar-app-ui/vitest.config.mts`).
- [x] In-memory fake Tauri backend (`src/test/fake-backend.ts`), with the rule that an
      unhandled command **throws** rather than resolving `undefined`.
- [x] Test setup shim for the jsdom gaps (`src/test/setup.ts`).
- [x] `cargo test` wired into the gate suite; `{{base_folder}}` path round-trip property
      tests plus regression tests for ISSUE-001/002 in `src-tauri/src/db.rs`.
- [x] `services/utils.rs`: `mask_value` (unicode safety, 1/2-char words, empty input — it
      called `chars().next().unwrap()` per word) and `apply_global_templates` (disabled /
      absent / malformed-JSON no-ops, and `regex::escape` on template names, which is the
      difference between a literal name and a user-authored regex running over every
      clipboard value).
- [x] `settingsStore` custom-data-location actions, the frontend half of ISSUE-001/003.
- [x] Coverage ratchet (`docs/harness/coverage-baseline.json`), enforced by
      `run-tests.sh --coverage` locally and in CI.
- [x] Both suites run in `.github/workflows/quality.yml`.

Still to do — recorded here so the boundary between "harness exists" and "harness is
complete" stays visible:

- [ ] Backend: `history_service::process_history_item`, format converters, language
      detection, and the remaining `services/` modules.
- [ ] Backend: a test that builds a SQLite schema from the real `migrations/` directory, so
      a migration that would fail in production fails in CI. Requires exposing `MIGRATIONS`.
- [ ] Frontend: `settingsStore` update + `settings-store-sync` broadcast, store
      rehydration, and the other stores (`clipboardHistoryStore`, `collectionStore`).
- [ ] Component render tests for the components split out of the large files in W4.
- [ ] Raise the coverage floor toward the §4 targets (50% for `lib`/`store`/`hooks`,
      60% for backend `services/`) and update the baseline in a dedicated commit.
      Current: 30.27% lines / 4.11% functions.
- [x] **Break-it check.** A test that stays green when its subject is broken is worse than
      no test, so the two most important ones were verified by reverting their fix:

      | Reverted fix | Result |
      | --- | --- |
      | `get_default_data_dir()` back to `APP_CONSTANTS.get().unwrap()` (ISSUE-002) | 2 tests fail, both with a panic |
      | `regex::escape(name)` removed from the template pattern | 2 tests fail — the metacharacter and catastrophic-backtracking cases |

      Both were restored and the suite is green again.

- [ ] Break-it check for ISSUE-014 (the retention scheduler) — that code is not yet under
      test.

### Known limitations, stated honestly

- **`cargo test` cannot use the global pool.** `DB_POOL_CONNECTION` is a process-global
  `lazy_static`, so tests that touch it interfere with each other. The current backend tests
  are pure functions and side-step this; service tests will need either a connection
  parameter or `#[serial]`.
- **The frontend suite does not render real window lifecycle.** Tray behaviour, hotkeys and
  multi-window focus remain manual (see the smoke checklist).
- **Coverage scope excludes components** (`src/lib`, `src/store`, `src/hooks` only). That is
  a deliberate Phase 5 choice: component tests are more expensive per unit of confidence
  than logic tests, and the logic layers are where the defects in ISSUES.md actually live.
