# Quality gates

> Last verified: 2026-09-16 · Branch `harnessing` · Phase 3

Every gate below runs in two places with the same command: locally through
`bash scripts/harness/check-all.sh` and in CI through `.github/workflows/quality.yml`.
A gate that cannot run in both is not a gate — it is a habit.

## Run them

```bash
bash scripts/harness/check-all.sh          # every gate
bash scripts/harness/check-all.sh --fast   # skip cargo fmt/clippy (seconds instead of minutes)
bash scripts/harness/check-all.sh --list   # names only
```

Exit code is 0 only when every gate passes. Each gate prints `[PASS]`/`[FAIL]` with its
elapsed time, followed by a summary naming what failed.

---

## The gates

| #   | Gate           | Command                                             | Fails when                                                                                                                                                                                           | Blocks                  |
| --- | -------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 1   | **hygiene**    | `scripts/harness/check-hygiene.sh`                  | a tracked file matches a forbidden pattern (`.env`, build artifacts, DB files, `node_modules`), or `.env` uses a key undocumented in `.env.sample`                                                   | everything              |
| 2   | **scan**       | `scripts/harness/scan.sh`                           | the scan itself errors. Metrics are compared by hand against `scan-baseline.txt`                                                                                                                     | nothing (informational) |
| 3   | **ipc-drift**  | `node scripts/harness/gen-ipc-contract.mjs --check` | a frontend-invoked command is not registered, or a registered command has no `#[tauri::command]` definition                                                                                          | PR                      |
| 4   | **docs-lint**  | `scripts/harness/docs-lint.sh`                      | a doc is unreachable from `docs/README.md`/`AGENTS.md`, a relative link dangles, a `file:line` reference points at a missing file or an out-of-range line, or a "Last verified" date exceeds 90 days | PR                      |
| 4b  | **issue-refs** | `node scripts/harness/check-issue-refs.mjs`         | an ISSUE-ID is duplicated, a `file:line` reference in `ISSUES.md` cannot be resolved, or points past the end of its file                                                                             | PR                      |
| 5   | **typecheck**  | `node scripts/harness/typecheck-ratchet.mjs`        | any type error in project code, or the vendored error set growing past `typecheck-baseline.json`                                                                                                     | PR                      |
| 6   | **lint**       | `npx eslint . --ext .ts,.tsx`                       | any error above the per-file baseline in `DEBT-BASELINE.md`                                                                                                                                          | PR                      |
| 7   | **format**     | `prettier --check` + `cargo fmt --check`            | any file is not Prettier/rustfmt-clean                                                                                                                                                               | PR                      |
| 7b  | **audit**      | `node scripts/harness/audit-ratchet.mjs`            | the production advisory count grows past `audit-baseline.json`, or the advisory database cannot be reached                                                                                           | PR                      |
| 8   | **clippy**     | `node scripts/harness/clippy-ratchet.mjs`           | the count of `clippy::*` lints in this crate grows past the baseline                                                                                                                                 | PR (macOS runner only)  |
| 9   | **test-rust**  | `cargo test`                                        | any test fails                                                                                                                                                                                       | PR                      |
| 10  | **test-js**    | `vitest run`                                        | any test fails, or coverage drops below the ratchet                                                                                                                                                  | PR                      |

---

## Gate 1 — hygiene

**Purpose:** the repository must not carry machine-local state or build output.

**Checks:** `git ls-files` against a forbidden-pattern list (`.env`, env variants,
`*.timestamp-*`, `tailwind-safelist.txt`, `node_modules/`, `dist-ui/`, `target/`,
`*.data`/`*.db`, `pastebar_settings.yaml`), plus a cross-check that every key in `.env`
is documented in `.env.sample`.

**On failure:** the gate prints the offending tracked paths and the exact fix
(`git rm --cached <file>`, which keeps the working copy).

**History:** the first run of this gate failed on 3 tracked files, resolved in Phase 3 §5.5.
`npm ci` no longer needs `.env`, because `DATABASE_URL` is only consumed by the `diesel` CLI
and the app builds its own diesel environment at runtime.

---

## Gate 3 — IPC drift

**Purpose:** the frontend and backend agree about the command surface.

**Checks:** parses `tauri::generate_handler!` in `src-tauri/src/main.rs`, every
`#[tauri::command]` definition, every literal `invoke('…')` in the frontend, and every
emitted/listened event name. Fails on **ghost commands** (invoked but not registered) and on
**registered-without-definition** (a typo in the handler list).

**Known limitation, stated honestly:** the _uncalled_ command list (57 at Phase 3) is
reported, not failed on. Several are plausibly intentional API surface (ISSUE-010), and
turning that into a hard failure would require a per-command decision this gate cannot make.
It becomes a hard failure in W2 once each is classified.

**Not checkable:** `hooks/queries/use-invoke.ts` calls `invoke(command, args)` with a
computed name. The generator lists that file explicitly rather than pretending full coverage.

---

## Gate 4 — docs-lint

**Purpose:** the record system must not rot.

**Checks:** (1) every `docs/**.md` is linked from `docs/README.md` or `AGENTS.md`;
(2) every relative markdown link resolves; (3) every `` `path.ext:NN` `` reference points at a
real file and a line within its length — bare basenames are resolved by lookup and reported
as ambiguous when they match more than one tracked file; (4) any `Last verified:` date older
than `STALE_DAYS` (default 90) fails.

**Why it matters:** documentation that describes a function that no longer exists is worse
than no documentation, because it is confidently wrong. This gate catches the mechanical
half of that; review catches the rest.

---

## Gate 4b — issue references

**Purpose:** `ISSUES.md` is the spine of the record system, and a reference that cannot be
followed is worse than no reference — the reader lands in unrelated code and believes it.

**Checks:** (1) every ISSUE-ID is unique; (2) every backticked `file.ext:NN` or
`file.ext:NN-MM` resolves to a tracked file and a line within it, with bare paths resolved
by unique suffix so `services/utils.rs` finds `src-tauri/src/services/utils.rs` but an
ambiguous match is reported; (3) every `ISSUE-NNN` mentioned anywhere in the file has a
definition, or is explicitly marked withdrawn.

**Withdrawn issues** keep their heading as a tombstone (ISSUE-026 was merged into
ISSUE-005) so a historical commit message still resolves, but carry no `ID |` row. Numbers
are never reused — reusing one would silently repoint every earlier citation at a different
defect.

**On failure:** fix the reference, or update the line numbers if the code moved. The gate
found a genuine gap the first time it ran (a cited id with no row).

## Gate 5 — typecheck (hard, ratcheted)

**Purpose:** type errors are compile errors that TypeScript only reports if you ask.

**Command:** `node scripts/harness/typecheck-ratchet.mjs`, which wraps
`npx tsc --noEmit -p tsconfig.json` and fails when **any error lands in project code**.
The 9 remaining errors are all inside vendored copies (`src/components/libs/**`,
GOLDEN-RULES R7) and are frozen per-file in `docs/harness/typecheck-baseline.json`:
the total may not grow, and a newly failing vendored file is itself a regression — it means
something new started depending on broken vendored code. `--strict` (used by the scheduled
CI job) fails on any error including the vendored tail, so it stays visible.

**Why it could not ship this way in Phase 3** (DECISIONS D-005): the gate started at 408
errors, almost all of them in the 191 unreachable files (ISSUE-030) and the vendored
cypress tests. W4a deleted the dead set, and the dependency prune (ISSUE-032 follow-up)
removed the hoisted transitive packages those vendored tests silently resolved, which let
`tsconfig.json` exclude them. D-005's named exit condition is met; the advisory mode is
retired. The default gate is now hard for project code; `HARNESS_TYPECHECK_STRICT=1` adds
the vendored tail on top (used by the scheduled CI job so the R7 debt stays visible).

---

## Gate 6 — lint

**Purpose:** enforce the taste invariants in `GOLDEN-RULES.md`.

**Configuration:** `.eslintrc.js` (ESLint 8, eslintrc format — DECISIONS D-002).
`packages/pastebar-app-ui/.eslintrc.js` is a `root: false` stub so there is one policy.

**Before Phase 3 this gate could not run at all:** neither `eslint` nor
`@typescript-eslint/*` appeared in any `package.json`, no `lint` script existed, the UI
config extended a `plugin:import/*` chain whose plugin was never installed, and the
complexity threshold was 200.

**Baseline:** 66 files / 123 errors, enumerated per-file in `DEBT-BASELINE.md` §2. The list
may shrink, never grow (GOLDEN-RULES R9).

---

## Gate 7 — format

Prettier (`.prettierrc` via `prettier.config.js`, 90-column, no semicolons, single quotes)
plus `cargo fmt`. `cargo fmt --check` is skipped under `--fast`.

---

## Gate 7b — dependency advisories

**Purpose:** nothing in this repository had ever run a dependency audit. `npm audit` was
not scripted, no workflow ran it, and every install site passed `--no-audit`, suppressing
even npm's own warning.

**First run: 51 production advisories, 30 of them high** (ISSUE-032). Three are direct
dependencies that reach the shipped renderer — `react-router-dom` (XSS via open redirect,
imported at `main.tsx:16`), `lodash-es` (code injection via `_.template`) and `js-yaml`
(prototype pollution). A desktop app ships its renderer, and that webview holds the user's
clipboard history with the IPC bridge exposed to it.

**Why it is a ratchet and not `--strict` in `check-all.sh`:** the pre-existing advisories
must not block unrelated PRs, but the failure mode that actually matters is _silence_. So:

| Invocation | Behaviour                                                   | Where                                      |
| ---------- | ----------------------------------------------------------- | ------------------------------------------ |
| default    | fails only if the count **grew** past `audit-baseline.json` | `check-all.sh` gate 7b, and CI on every PR |
| `--strict` | fails on **any** high/critical advisory                     | CI `audit` job, weekly schedule            |

**Inconclusive is a failure.** When the registry is unreachable, npm reports a zero count —
which naive code reads as "no vulnerabilities". The gate detects a missing
`metadata.dependencies.prod` (only filled by a completed audit) or an `error` field and
fails with `AUDIT GATE INCONCLUSIVE`. A security gate that passes because the network was
down is a false green that trains people to ignore the job.

**On failure:** upgrade the dependency, or explain in the PR why the advisory does not apply
and update the baseline in its own commit. The count may only shrink.

**Dev-only advisories are excluded** (`--omit=dev`): real, but a different blast radius, and
mixing them makes the number useless as a signal.

---

## Gates 8–9 — Rust

`cargo test` runs from `src-tauri/`. It currently reports **0 tests** (ISSUE-006); Phase 5
populates it.

Clippy runs through a **ratchet**, not `-- -D warnings`. Measured at Phase 3 with
`cargo clippy --all-targets`: **647 warnings**, of which 364 are rustc's `unexpected_cfgs`
and 124 `deprecated` — dominated by dependency and toolchain noise rather than by this
crate's code. Gating on all of them would require either a blanket `#[allow]` or a
whole-backend refactor in one wave, and the plan forbids the latter.

`clippy-ratchet.mjs` therefore counts only `clippy::*` lints in this crate's own targets,
with vendored paths excluded: **62**. That is the baseline in `clippy-baseline.json`, and it
may only shrink (GOLDEN-RULES R9).

`cargo clippy --fix --allow-dirty --all-targets` applied 236 mechanical fixes in this wave
(298 → 62 clippy lints; mostly `needless_return` ×60 and `needless_borrow` ×48). The
remainder is itemised by rule and by file in `DEBT-BASELINE.md` §4.

**No `#[allow]` attribute was added anywhere.** The baseline file is the only exemption
mechanism, which is what keeps the list visible and shrinking.

Both gates are skipped under `--fast` because a cold Tauri build is minutes, not seconds.

---

## Gates 9–10 — tests

`cargo test` (26 tests) and `bash scripts/harness/run-tests.sh --coverage` (33 tests).

Both are **hard gates**. A missing `vitest` install is a failure rather than a skip: a gate
that silently passes when its tool is absent is how a "green" build ends up testing nothing
— the exact failure mode this overhaul exists to remove.

The frontend gate additionally enforces the coverage ratchet in
`docs/harness/coverage-baseline.json`. Coverage is currently low and that is expected — the
ratchet's job at this stage is that it can no longer _fall_, not that it is high. See
docs/testing.md §8 for what is still outstanding.

---

## Baselines and the ratchet

Every gate that cannot be green on the existing code carries an explicit, per-item exemption
in [`DEBT-BASELINE.md`](DEBT-BASELINE.md) with a named removal wave. **No blanket
exemptions**, and no exemption without an owner.

The rule (GOLDEN-RULES R9): a baseline number may only move down. Raising one is an edit to
`DEBT-BASELINE.md` and is reviewed as a decision, not as a config tweak.

---

## CI

`.github/workflows/quality.yml` runs on `pull_request` and on pushes to `main`/`harnessing`:

| Job       | Runner          | Gates                                                                                   |
| --------- | --------------- | --------------------------------------------------------------------------------------- |
| `quality` | `ubuntu-latest` | hygiene, scan, ipc-drift, docs-lint, lint, format (prettier only), typecheck (ratchet)  |
| `rust`    | `macos-latest`  | clippy, cargo test, `cargo fmt --check` (macOS-only code must be type-checked on macOS) |
| `tests`   | `ubuntu-latest` | vitest (Phase 5)                                                                        |
| `audit`   | `ubuntu-latest` | gate 7b (`audit-ratchet.mjs`); runs `--strict` on a weekly schedule                     |

`.github/workflows/build-test.yml` remains the release-bundle workflow. Its `push` trigger
stays commented out and its `workflow_dispatch` entry point is unchanged; version bumping
belongs in a release workflow, not in a quality gate (HARNESS_PLAN §5.2 task 3.10).

**Expected CI duration:** ~3–5 minutes for `quality` and `tests`; the `rust` job is longer
because it compiles Tauri, and is the reason the plan's 15-minute budget excludes bundling.

---

## Verification: the gates actually fail

Plan §5.4 requires proving the gates go red, not just green. Each was verified by
deliberately introducing the fault it exists to catch. A gate that has never been observed
failing is an untested gate.

| Fault introduced                                    | Gate             | Observed                                                                                      |
| --------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------- |
| `git add -f .env`                                   | gate 1 hygiene   | `HYGIENE FAIL: .env is tracked`, exit 1                                                       |
| `invoke('this_command_does_not_exist_anywhere')`    | gate 3 ipc-drift | `ghost commands: this_command_does_not_exist_anywhere`, exit 1                                |
| `const x: number = 'a string'`                      | gate 5 typecheck | project error 0 → 1, `TYPECHECK RATCHET FAILED` even without `--strict` — blocking by default |
| Lowering `audit-baseline.json` below the real count | gate 7b audit    | `AUDIT RATCHET FAILED: production advisories 51 exceeds baseline 40`, exit 1                  |
| Pointing npm at an unreachable registry             | gate 7b audit    | `AUDIT GATE INCONCLUSIVE`, exit 1 — **not** a pass                                            |
| Reverting `get_default_data_dir()`'s fix            | gate 9 test-rust | 2 tests fail, both with a panic                                                               |
| Removing `regex::escape(name)`                      | gate 9 test-rust | 2 tests fail (metacharacter and catastrophic-backtracking cases)                              |
| Deleting `DB_POOL_CONNECTION` init guard            | gate 9 test-js   | coverage ratchet reports the dropped metric                                                   |

The audit-inconclusive row is the one worth keeping: the first implementation of that gate
_passed_ when the registry was unreachable, because npm reports a zero count in that case.
It now fails, since a security gate that passes because the network was down is worse than
no gate at all.

---

## Adding a gate

1. Write it as a script under `scripts/harness/` with a non-zero exit on failure.
2. Add it to `check-all.sh` as a function and a `run_gate` line.
3. Add the same step to `quality.yml`.
4. Document it in this file, including what happens when it fails.
5. If it cannot be green immediately, add a per-item exemption to `DEBT-BASELINE.md` with a
   removal wave. Never add a blanket ignore.
