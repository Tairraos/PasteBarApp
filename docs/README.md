# Documentation index

This directory is PasteBar's **record system**: durable knowledge lives here, in version
control, rather than in chat or in one person's head. [`../AGENTS.md`](../AGENTS.md) is the
map; this file is the table of contents. The repository-root `CLAUDE.md` is a deliberate
stub that points back here, so there is only ever one copy of project knowledge.

Every document below is linked from here or from `AGENTS.md` — `scripts/harness/docs-lint.sh`
fails the build if a doc becomes unreachable or a link dangles.

---

## Core

| Document                                 | One-line purpose                                                        | Status     |
| ---------------------------------------- | ----------------------------------------------------------------------- | ---------- |
| [`architecture.md`](architecture.md)     | System shape, layers, dependency arrows, module map                     | ✅ current |
| [`security-model.md`](security-model.md) | Trust boundaries and what the app is allowed to do on the user's behalf | ✅ current |
| [`testing.md`](testing.md)               | How to write, run and mock tests                                        | 🚧 Phase 5 |

## Modules

| Document                                                               | One-line purpose                                                         | Status     |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------- |
| [`modules/backend-commands.md`](modules/backend-commands.md)           | The `#[tauri::command]` layer: conventions, error contract, registration | ✅ current |
| [`modules/backend-services.md`](modules/backend-services.md)           | Business-logic layer: history, items, collections, link metadata, utils  | ✅ current |
| [`modules/backend-clipboard.md`](modules/backend-clipboard.md)         | Clipboard capture pipeline end to end                                    | ✅ current |
| [`modules/backend-database.md`](modules/backend-database.md)           | Diesel/SQLite schema, migrations, `{{base_folder}}` path transforms      | ✅ current |
| [`modules/frontend-architecture.md`](modules/frontend-architecture.md) | Three entries, stores, IPC helper layer, i18n, vendored exemptions       | ✅ current |

## Contracts

| Document                                           | One-line purpose                                                | Status       |
| -------------------------------------------------- | --------------------------------------------------------------- | ------------ |
| [`contracts/tauri-ipc.md`](contracts/tauri-ipc.md) | Generated index of every IPC command and event + drift findings | ⚙️ generated |

## Reference (moved from the repository root)

| Document                                                                           | One-line purpose                                        | Last verified |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------- |
| [`reference/build-and-release.md`](reference/build-and-release.md)                 | Build, bundle and release steps for macOS and Windows   | 2026-09-16    |
| [`reference/database-migrations.md`](reference/database-migrations.md)             | How to add and run a Diesel migration                   | 2026-09-16    |
| [`reference/i18n.md`](reference/i18n.md)                                           | Translation files, key conventions and the audit script | 2026-09-16    |
| [`reference/whats-new-0.7.0.md`](reference/whats-new-0.7.0.md)                     | Release notes for 0.7.0                                 | 2026-09-16    |
| [`reference/build-guide-arm64-windows.md`](reference/build-guide-arm64-windows.md) | ARM64 Windows build guide                               | 2026-09-16    |

## Harness (the engineering-overhaul record)

| Document                                                   | One-line purpose                                                    | Status       |
| ---------------------------------------------------------- | ------------------------------------------------------------------- | ------------ |
| [`harness/HARNESS_PLAN.md`](harness/HARNESS_PLAN.md)       | The five-phase overhaul plan                                        | 📋 planning  |
| [`harness/ISSUES.md`](harness/ISSUES.md)                   | Every known defect and debt row, severity-graded                    | ✅ Phase 1   |
| [`harness/FIX-PLAN.md`](harness/FIX-PLAN.md)               | Priority queue, wave assignment, per-issue test obligations         | ✅ Phase 1   |
| [`harness/scan-baseline.txt`](harness/scan-baseline.txt)   | Frozen static-metric baseline to measure convergence against        | ⚙️ generated |
| [`harness/gates.md`](harness/gates.md)                     | Every gate: purpose, command, failure handling, baseline exemptions | ✅ Phase 3   |
| [`harness/DEBT-BASELINE.md`](harness/DEBT-BASELINE.md)     | Explicit exemption lists with removal plans                         | ✅ Phase 3   |
| [`harness/GOLDEN-RULES.md`](harness/GOLDEN-RULES.md)       | The taste invariants encoded into lint rules                        | ✅ Phase 3   |
| [`harness/DECISIONS.md`](harness/DECISIONS.md)             | Decision log for tradeoffs made during the overhaul                 | ✅ Phase 3   |
| [`harness/smoke-checklist.md`](harness/smoke-checklist.md) | Manual verification list for behaviour-risk changes                 | ✅ Phase 3   |

---

## Conventions

1. **One document per concern.** If a document needs a table of contents, split it.
2. **Reference code, don't copy it.** Link `file.rs:123` instead of pasting a snippet that
   will silently rot. `scripts/harness/docs-lint.sh` checks that referenced paths exist.
3. **Say what is not known.** A `Known limitations` section is worth more than a confident
   paragraph that is wrong.
4. **Date your verification.** Anything that describes external state (a build procedure, a
   platform quirk) carries a `Last verified` date.
5. **Update the doc in the same commit as the code.** The drift gates cannot see prose.
