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

| #   | Gate          | Command                                             | Fails when                                                                                                                                                                                           | Blocks                  |
| --- | ------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 1   | **hygiene**   | `scripts/harness/check-hygiene.sh`                  | a tracked file matches a forbidden pattern (`.env`, build artifacts, DB files, `node_modules`), or `.env` uses a key undocumented in `.env.sample`                                                   | everything              |
| 2   | **scan**      | `scripts/harness/scan.sh`                           | the scan itself errors. Metrics are compared by hand against `scan-baseline.txt`                                                                                                                     | nothing (informational) |
| 3   | **ipc-drift** | `node scripts/harness/gen-ipc-contract.mjs --check` | a frontend-invoked command is not registered, or a registered command has no `#[tauri::command]` definition                                                                                          | PR                      |
| 4   | **docs-lint** | `scripts/harness/docs-lint.sh`                      | a doc is unreachable from `docs/README.md`/`AGENTS.md`, a relative link dangles, a `file:line` reference points at a missing file or an out-of-range line, or a "Last verified" date exceeds 90 days | PR                      |
| 5   | **typecheck** | `npx tsc --noEmit -p tsconfig.json`                 | TypeScript errors. **Advisory until W4a** — see below                                                                                                                                                | W4a onward              |
| 6   | **lint**      | `npx eslint . --ext .ts,.tsx`                       | any error above the per-file baseline in `DEBT-BASELINE.md`                                                                                                                                          | PR                      |
| 7   | **format**    | `prettier --check` + `cargo fmt --check`            | any file is not Prettier/rustfmt-clean                                                                                                                                                               | PR                      |
| 8   | **clippy**    | `node scripts/harness/clippy-ratchet.mjs`           | the count of `clippy::*` lints in this crate grows past the baseline                                                                                                                                 | PR (macOS runner only)  |
| 9   | **test-rust** | `cargo test`                                        | any test fails                                                                                                                                                                                       | PR                      |
| 10  | **test-js**   | `vitest run`                                        | any test fails, or coverage drops below the ratchet                                                                                                                                                  | PR                      |

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

## Gate 5 — typecheck (advisory until W4a)

**Purpose:** type errors are compile errors that TypeScript only reports if you ask.

**Current state: 408 errors, ~301 of them in vendored code and the rest almost entirely in
the 191 unreachable source files** (ISSUE-030). The gate therefore cannot be hard yet: making
it fail today would block every PR on pre-existing dead code unrelated to the change.

**This is a deliberate, bounded exemption with a named exit:** wave W4a deletes the
unreachable set, after which the typecheck gate becomes a hard failure and this paragraph is
deleted. Tracked in `DEBT-BASELINE.md` §3.

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

## Gate 10 — tests (Phase 5)

The runner is wired but no tests exist yet (`rust.test_markers = 0`, ISSUE-006). The gate
reports success when `vitest` is absent, so that Phase 3's gate set is green while Phase 5 is
pending; it becomes a real requirement the moment the first test file lands.

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
| `quality` | `ubuntu-latest` | hygiene, scan, ipc-drift, docs-lint, lint, format (prettier only), typecheck (advisory) |
| `rust`    | `macos-latest`  | clippy, cargo test, `cargo fmt --check` (macOS-only code must be type-checked on macOS) |
| `tests`   | `ubuntu-latest` | vitest (Phase 5)                                                                        |
| `audit`   | `ubuntu-latest` | `npm audit --omit=dev` — scheduled weekly, does not block PRs                           |

`.github/workflows/build-test.yml` remains the release-bundle workflow. Its `push` trigger
stays commented out and its `workflow_dispatch` entry point is unchanged; version bumping
belongs in a release workflow, not in a quality gate (HARNESS_PLAN §5.2 task 3.10).

**Expected CI duration:** ~3–5 minutes for `quality` and `tests`; the `rust` job is longer
because it compiles Tauri, and is the reason the plan's 15-minute budget excludes bundling.

---

## Adding a gate

1. Write it as a script under `scripts/harness/` with a non-zero exit on failure.
2. Add it to `check-all.sh` as a function and a `run_gate` line.
3. Add the same step to `quality.yml`.
4. Document it in this file, including what happens when it fails.
5. If it cannot be green immediately, add a per-item exemption to `DEBT-BASELINE.md` with a
   removal wave. Never add a blanket ignore.
