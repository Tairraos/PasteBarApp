# Decision log

> Last verified: 2026-09-16 · Branch `harnessing`
> One entry per consequential tradeoff. Format: **Decision · Context · Rationale ·
> Consequences · Revisit when.** Append-only: supersede an entry with a new one rather than
> editing history, so the reasoning trail survives.

---

## D-001 · Do the harness overhaul on a long-lived branch, not incrementally on `main`

**Date:** 2026-09-16 · **Phase:** 0 (planning)

**Context.** The repository has no tests, no working linter and no CI gate. Every change is
therefore unverifiable by machine, and the overhaul touches the same files a bug-fix would.

**Decision.** All overhaul work lands on `harnessing`. `main` receives zero changes until the
work is reviewed. Each phase is a separate commit range that can be reverted independently.

**Rationale.** Sub-phase commits stay independently revertable, `git log main..harnessing` is
a complete audit trail, and a phase that fails review can be reverted without touching
shipping code.

**Consequences.** No rebase against `main` during the overhaul; conflicts are resolved at
merge time. Contributors working on `main` do not see the gates until merge.

**Revisit when.** The Phase 5 test suite is green in CI and the branch merges.

---

## D-002 · ESLint stays on v8 / eslintrc format for this overhaul

**Date:** 2026-09-16 · **Phase:** 3

**Context.** The plan (§10.2) proposed locking ESLint 8 to keep the existing `.eslintrc`
format and deferring the flat-config migration. Two config files existed, both broken.

**Decision.** Pin `eslint@8.57.1` + `@typescript-eslint@7.18.0`, keep the eslintrc format in
the root `.eslintrc.js`, and reduce `packages/pastebar-app-ui/.eslintrc.js` to a
`root: false` stub. Flat config is deferred past this overhaul.

**Rationale.** The goal of Phase 3 is to make a gate _exist_. A format migration mixed into
that change would produce a diff nobody can review, and ESLint 8 is still the version whose
rule behaviour matches the existing config's intent. The prior UI config could never have run
regardless of version: it extended `plugin:import/electron` and two more `plugin:import/*`
chains while `eslint-plugin-import` was not installed.

**Consequences.** ESLint 8 is past end-of-life upstream, so `npm` prints a deprecation
warning on install. That warning is expected and is not a defect. The stub-file approach
means one policy for the whole repository.

**Revisit when.** Phase 5 lands and the lint baseline is small enough that a flat-config
migration is a mechanical, reviewable change.

---

## D-003 · `no-use-before-define` is relaxed to `variables: false`

**Date:** 2026-09-16 · **Phase:** 3

**Context.** The original config set `no-use-before-define: [2, 'nofunc']`. Enabling it
produced 45 errors.

**Decision.** `[2, { functions: false, classes: false, variables: false }]`.

**Rationale.** All 45 findings were false positives: hoisted function declarations and
module-level `const`s referenced from a component defined earlier in the file — patterns that
are ubiquitous and correct in React+TS. TypeScript already reports genuine
use-before-define defects (TDZ on `let`/`const`) as compile errors with better messages, so
this rule was adding noise in the exact place a gate can least afford it. This is a _narrowing
to real value_, not a threshold raised to make a failure disappear.

**Consequences.** A genuine TDZ bug in a `.ts` file that never goes through `tsc` would no
longer be caught by ESLint. No such file exists today (`tsconfig.json` covers the UI source).

**Revisit when.** Never, unless TypeScript stops being the compile path.

---

## D-004 · `sonarjs/no-duplicate-string` stays off rather than being baselined

**Date:** 2026-09-16 · **Phase:** 3

**Context.** Enabling it produced 61 errors, almost all i18n keys and Tailwind class strings.

**Decision.** Leave it `off` and record it in `DEBT-BASELINE.md` §5 as a deliberate
non-target, rather than baselining 61 sites.

**Rationale.** A baseline exists to track debt that will be paid. This rule's findings here
are mostly _correct code_: an i18n key repeated in two JSX branches should be repeated, and
extracting it to a constant would obscure the translation lookup. Baselining it would create
a fake obligation and inflate the exemption list.

**Consequences.** The linter will not flag genuinely duplicated magic strings. Accepted.

**Revisit when.** An i18n refactor introduces key constants.

---

## D-005 · The typecheck gate ships advisory, with W4a as its named exit

**Date:** 2026-09-16 · **Phase:** 3

**Context.** The plan (§5.2 task 3.2) specifies the typecheck gate "直接 fail". In reality
`tsc --noEmit` reports 408 errors: 301 in vendored `react-twitter-embed` test files, and
almost all of the remainder inside the **191 unreachable source files** discovered in Phase 1
(ISSUE-030). Three packages those files import (`react-select`, `react-datepicker`, `moment`)
are not dependencies at all.

**Decision.** Ship the gate in advisory mode. It runs in `check-all.sh` and CI, reports its
count, and does not fail the build. `DEBT-BASELINE.md` §3 records the exit condition: wave
W4a deletes the unreachable set, and the gate then becomes hard.

**Rationale.** The plan's acceptance criterion assumed the codebase type-checked and merely
lacked a script to run it. That assumption was wrong, and the honest response is to record
the real blocker rather than either (a) making every PR fail on 408 pre-existing errors, or
(b) suppressing the errors with 408 `@ts-ignore` comments, which would be permanent amnesty.

**Consequences.** Type errors in new code are reported but not blocked during Phases 3–4.
This is a real weakening and is why the exit is named explicitly rather than left open.

**Revisit when.** W4a completes. **This entry is the trigger to delete the advisory mode.**

---

## D-006 · `.env` is untracked; the app does not read it at runtime

**Date:** 2026-09-16 · **Phase:** 3

**Context.** `.env` was git-tracked (ISSUE-004). The plan (§10.1) flagged it as a decision
point: "if you depend on fork-syncing this file, say so".

**Decision.** `git rm --cached .env` (working copy preserved), add `.env` to `.gitignore`,
extend `.env.sample` so no key documentation is lost.

**Rationale.** Verified before acting: `DATABASE_URL` is consumed only by the `diesel` CLI
for migration authoring, and the application builds its own diesel environment at runtime
from `db::get_data_dir()` — it never reads `.env`. `MISSING_TRANSLATION_SAVE_PATH` is read by
`src-tauri/src/commands/translations_commands.rs` behind a `std::env::var(...).unwrap()`, i.e.
it is optional in practice because that code path is only reached from a translation-update
command. Removing the file from git therefore changes no runtime behaviour.

**Consequences.** A developer cloning fresh must `cp .env.sample .env` before running
`diesel migration run`. Documented in `AGENTS.md` and
`docs/reference/build-and-release.md`. The hygiene gate now prevents re-adding it.

**Revisit when.** Any build step acquires a genuine secret.

---

## D-007 · The `npm ci` `EALLOWSCRIPTS` failure is a local-config bug, documented not worked around in-repo

**Date:** 2026-09-16 · **Phase:** 3

**Context.** `npm ci` fails on this machine with `git dep preparation failed` →
`EALLOWSCRIPTS`. Isolated by reproducing it in an empty directory with a single
`github:tauri-apps/tauri-plugin-log` dependency, which ruled out anything PasteBar-specific.
Root cause: npm 11.17 reads a global `~/.npmrc` entry
`allow-scripts = ["esbuild,esbuild,esbuild,esbuild"]` and forwards it to the nested install
that prepares a git dependency; that install rejects it as project-scoped.

**Decision.** Do **not** add an `allow-scripts` field to `package.json` to "fix" it. Document
the workaround (`--ignore-scripts --userconfig /dev/null`) in `AGENTS.md`, and use it in
`check-all.sh`'s install hint.

**Rationale.** The failure is caused by one developer's user-level npm config, not by the
repository. Adding a repo-level `allow-scripts` field would encode a workaround for a local
misconfiguration into everyone's install, and would change script-execution behaviour for
contributors whose machines are fine. CI runners (`setup-node`) have no user npmrc and are
unaffected — which is also why `build-test.yml` uses plain `npm install`.

**Consequences.** A developer with that npmrc line must use the flag or clean their config.
Two documented lines in `AGENTS.md` versus a repository-wide behaviour change: the trade is
worth it toward the local machine.

**Revisit when.** The failing npmrc line is removed, or npm changes the validation.

---

## D-008 · Wave W4a is added: delete the unreachable frontend code before splitting the rest

**Date:** 2026-09-16 · **Phase:** 1 → amends the Phase 4 plan

**Context.** Phase 1's reachability scan (`scripts/harness/reachability.mjs`) found **191 of
428** tracked frontend sources unreachable from the three Vite entries. The plan's wave table
(W3/W4) assumed splitting ~10 large files; it did not anticipate that most of the tree is
dead.

**Decision.** Insert **W4a** before W4: delete the unreachable set in reviewed batches, one
top-level directory per commit, each verified by `reachability.mjs --count` and a production
`vite build`.

**Rationale.** Splitting a 2064-line `NavBar.tsx` and separately deleting 191 dead files both
touch the same module graph; doing the split first means resolving import paths in files
scheduled for deletion. Deleting first also unblocks the typecheck gate (D-005), which is the
prerequisite for safely doing _any_ of W3/W4. This is the plan's own "re-measure rather than
assume" principle applied to its own wave list.

**Consequences.** W4's effort estimate drops sharply (fewer files, and the surviving ones are
better understood). A delete-only wave is unusually high-value per unit of risk: an
unreachable file cannot affect runtime, and the build verifies the claim.

**Safety requirement.** Because reachability is computed statically, each deletion batch must
be confirmed by a successful production build — a dynamic import that the walker cannot see
would otherwise delete live code.

**Revisit when.** W4a completes and the typecheck gate turns hard.

---

## D-009 · `reinitialize_connection_pool()` remains synchronous in Phase 3

**Date:** 2026-09-16 · **Phase:** 1 (recorded, not yet acted on)

**Context.** `db::reinitialize_connection_pool()` (`db.rs:96-100`) takes a write lock on
`DB_POOL_CONNECTION` and rebuilds the pool while holding it. Every in-flight
`establish_pool_db_connection()` takes a read lock first, so a caller blocked on pool I/O
blocks the rebuild. Called from `user_settings_command.rs:210` and `:224`, i.e. immediately
after a data-directory relocation.

**Decision.** Defer the fix to W1; do not change the signature now.

**Rationale.** It is entangled with ISSUE-001 (the config lookup that decides _which_
directory the pool should point at). Fixing the locking without fixing the path resolution
would produce a pool that is correctly synchronised around the wrong file. W1 addresses them
together.

**Revisit when.** W1 starts on `db.rs`.
