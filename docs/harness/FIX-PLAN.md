# PasteBar Harness — Fix Plan (Phase 1 deliverable)

> **Status:** active · companion to `ISSUES.md` > **Rule:** every ISSUE row has exactly one wave here; a wave is one review point and
> one or more independently revertable commits (§8 of `HARNESS_PLAN.md`).
> **Hard constraint:** behaviour-preserving except where a row is tagged `BUG`.

---

## 1. Priority queue

Ordering rule: P0 first, then P1 grouped so that each wave is independently
revertable; P2/P3 are subsumed by the wave that touches the same file.

| #   | ISSUE                                           | Type    | Severity | Wave  | Phase  |
| --- | ----------------------------------------------- | ------- | -------- | ----- | ------ |
| 1   | ISSUE-001 custom data path breaks config lookup | BUG     | P0       | W1    | 4      |
| 2   | ISSUE-002 monitor runs before db init           | BUG     | P0       | W1    | 4      |
| 3   | ISSUE-003 relocation never validated            | RISK    | P0       | W1    | 4      |
| 4   | ISSUE-004 `.env` tracked                        | HYGIENE | P0       | —     | 3 §5.5 |
| 5   | ISSUE-005 build artifacts tracked               | HYGIENE | P0       | —     | 3 §5.5 |
| 6   | ISSUE-006 zero tests                            | DEBT    | P1       | —     | 5      |
| 7   | ISSUE-007 eslint not installed                  | DEBT    | P1       | —     | 3.1    |
| 8   | ISSUE-008 no typecheck gate                     | DEBT    | P1       | —     | 3.2    |
| 9   | ISSUE-009 no CI quality gate                    | DEBT    | P1       | —     | 3.10   |
| 10  | ISSUE-010 57 uncalled commands                  | DEBT    | P1       | W2    | 4      |
| 11  | ISSUE-011 event-name drift                      | BUG     | P1       | W2    | 4      |
| 12  | ISSUE-012 96 startup-path unwraps               | DEBT    | P1       | W1    | 4      |
| 13  | ISSUE-013 152 raw println                       | DEBT    | P1       | W1    | 4      |
| 14  | ISSUE-014 cron scheduler never ticks            | DEBT    | P1       | W1    | 4      |
| 15  | ISSUE-015 tray menu holds settings lock         | RISK    | P1       | W1    | 4      |
| 16  | ISSUE-016 trust model undocumented              | RISK    | P1       | —     | 2      |
| 17  | ISSUE-017 layering unenforced                   | DEBT    | P2       | W3    | 4      |
| 18  | ISSUE-018 22 files > 1000 lines                 | DEBT    | P2       | W3/W4 | 4      |
| 19  | ISSUE-019 complexity threshold 200              | DEBT    | P2       | W6    | 4      |
| 20  | ISSUE-020 no IPC runtime validation             | DEBT    | P2       | W2    | 4      |
| 21  | ISSUE-021 six silent catches                    | DEBT    | P2       | W1    | 4      |
| 22  | ISSUE-022 React 18/19 split                     | RISK    | P2       | W0    | 4      |
| 23  | ISSUE-023 unbounded text storage                | RISK    | P2       | W2    | 4      |
| 24  | ISSUE-024 per-item regex recompilation          | DEBT    | P2       | W5    | 4      |
| 25  | ISSUE-025 preview-line underflow                | BUG     | P2       | W1    | 4      |
| 26  | ISSUE-027 no IPC contract doc                   | DEBT    | P2       | —     | 2.5    |
| 27  | ISSUE-028 console/any unguarded                 | HYGIENE | P3       | W6    | 4      |
| 28  | ISSUE-029 unattributed TODOs                    | HYGIENE | P3       | W5    | 4      |

---

## 2. Phase map (what each phase must produce)

### Phase 2 — documentation (no code behaviour change)

- `docs/README.md`, `docs/architecture.md`, `docs/security-model.md` (closes ISSUE-016),
  `docs/modules/*`, `docs/contracts/tauri-ipc.md` (closes ISSUE-027),
  `docs/reference/*`, `docs/harness/GOLDEN-RULES.md` (states the layering rule for ISSUE-017).
- `AGENTS.md` ~100 lines; `CLAUDE.md` reduced to a pointer.
- `scripts/harness/gen-ipc-contract.mjs` (contract generator seed), `scripts/harness/docs-lint.sh`.
- **Behaviour change:** none. **Files:** new docs + AGENTS.md + CLAUDE.md + README.md links.

### Phase 3 — gates

- 3.1 eslint@8 install, `npm run lint` (ISSUE-007, ISSUE-019 baseline 200→40, ISSUE-028 baseline)
- 3.2 `npm run typecheck` root + UI (ISSUE-008)
- 3.3 `npm run format:check` (prettier + `cargo fmt --check`)
- 3.4 `cargo clippy` warn-count baseline → `-D warnings`
- 3.5 test job skeleton (filled in Phase 5)
- 3.6 `scripts/harness/check-ipc-drift.mjs` — commands **and** events (ISSUE-010, ISSUE-011)
- 3.7 `scripts/harness/docs-lint.sh` — link validity + staleness (ISSUE-027)
- 3.8 hygiene job — tracked `.env` / artifacts rejected (ISSUE-004, ISSUE-005)
- 3.9 scheduled `npm audit --omit=dev` + `cargo audit`
- 3.10 `.github/workflows/quality.yml`, `build-test.yml` narrowed (ISSUE-009)
- 3.11 `scripts/harness/check-all.sh` single entry point
- **§5.5 hygiene fix executes here** because 3.8 cannot pass otherwise.

### Phase 4 — waves

| Wave   | Scope                                                                              | Issues                                            | Est. files / lines            |
| ------ | ---------------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------- |
| **W0** | Dependency hygiene: single React version, align types (own commit, no code change) | ISSUE-022                                         | 2 files / ~6 lines            |
| **W1** | Backend error/logging convergence + startup safety                                 | ISSUE-001, 002, 003, 012, 013, 014, 015, 021, 025 | ~8 files / ~400 lines         |
| **W2** | IPC boundary typed + event constants + dead-command decision + value fetch         | ISSUE-010, 011, 020, 023                          | ~12 files / ~500 lines        |
| **W3** | Backend giant-file split (pure moves)                                              | ISSUE-017, 018                                    | 8 files / ~2000 lines moved   |
| **W4** | Frontend giant-file split (pure moves)                                             | ISSUE-018                                         | ~10 files / ~4000 lines moved |
| **W5** | Shared-logic extraction + TODO triage                                              | ISSUE-024, 029                                    | cross-module                  |
| **W6** | Ratchet: complexity 40→25, console/any→error, file-length rule                     | ISSUE-019, 028                                    | config                        |

**W1 must not change frontend-visible error strings.** `Result<_, String>` boundaries
keep their current text; only the internal panic paths change. W1 commits are
independently revertable: `db.rs` (ISSUE-001/002), `user_settings_command.rs`
(ISSUE-003), `main.rs` (ISSUE-012/013), `cron_jobs.rs` (ISSUE-014), `menu.rs` (ISSUE-015),
frontend catches (ISSUE-021), `history_service.rs` (ISSUE-025) are separate commits.

### Phase 5 — tests

| Sub | Content                                                                                                                       | Closes         |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 5.1 | vitest + testing-library + jsdom in the UI package                                                                            | ISSUE-006      |
| 5.2 | in-memory fake Tauri backend driven by the contract schemas                                                                   | ISSUE-006, 020 |
| 5.3 | `cargo test` for services (masking, path transform, retention, converters, language detect) + SQLite in-memory Diesel queries | ISSUE-006      |
| 5.4 | boundary/exception cases for every P0/P1 row                                                                                  | all P0/P1      |
| 5.5 | property tests: `{{base_folder}}` round-trip, format converters, preview truncation                                           | ISSUE-025      |
| 5.6 | coverage ratchet (frontend lib/store/hooks ≥50%, backend services ≥60%)                                                       | —              |
| 5.7 | wire tests into CI as required checks                                                                                         | ISSUE-009      |

---

## 3. Test tasks attached to each P0/P1 fix

Rules: each row needs ≥1 positive, ≥1 boundary and ≥1 failure case by the end of
Phase 5. The "test" column names the Phase 5 file that must exist.

| ISSUE      | Test artefact (Phase 5)                                                                        | Cases                                                                                                                   |
| ---------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| ISSUE-001  | `src-tauri/src/services/user_settings_service.rs` `#[cfg(test)]` + `tests/config_bootstrap.rs` | config found in default dir; custom path set; config missing but data dir present (must not silently create a fresh DB) |
| ISSUE-002  | `tests/startup_order.rs`                                                                       | monitor start deferred until db ready; copy during startup window does not panic                                        |
| ISSUE-003  | `tests/relocate.rs`                                                                            | valid dir; path is a file; read-only dir; `..` traversal rejected                                                       |
| ISSUE-010  | `scripts/harness/check-ipc-drift.mjs` + `docs/contracts/tauri-ipc.md` entry per command        | every invoked command documented; dead-command list stays in sync                                                       |
| ISSUE-011  | `tests/event_names.rs` + frontend `events.test.ts`                                             | emitted set ⊆ documented set; each documented event has a listed listener                                               |
| ISSUE-012  | clippy + `tests/startup_paths.rs`                                                              | missing main window is an error, not a panic                                                                            |
| ISSUE-013  | `scripts/harness/scan.sh` ratchet                                                              | `rust.println` count strictly decreases per wave                                                                        |
| ISSUE-014  | `tests/retention.rs`                                                                           | scheduler ticks on an interval; age-based cleanup removes only older rows; pinned/starred kept                          |
| ISSUE-015  | `tests/tray_menu.rs`                                                                           | menu build does not hold the settings lock across a DB call                                                             |
| ISSUE-011b | `tests/masking.rs`                                                                             | mask list applied to matching rows only; empty list is a no-op; `has_masked_words` set correctly                        |
| ISSUE-023  | `tests/history_value.rs`                                                                       | over-cap text stored per policy; value fetch round-trips                                                                |
| ISSUE-025  | `tests/truncation.rs` + proptest                                                               | no underflow for any value shape                                                                                        |

---

## 4. Explicitly out of scope for this overhaul

- Tauri 1.x → 2.x migration.
- eslintrc → flat config migration (recorded as a post-Phase-6 option).
- Heavy e2e (Tauri window automation); replaced by the fake backend + contract tests + the manual smoke checklist.
- Any functional feature work unrelated to harness hardening.
- `sonarjs` threshold **below** 25; 25 is the Phase 4 target.
- Rewriting vendored libraries under `components/libs/**` and `src-tauri/libs/**`; they are excluded from every metric and every lint baseline.
