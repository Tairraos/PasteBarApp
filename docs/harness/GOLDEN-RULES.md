# Golden rules

> Last verified: 2026-09-16 · Branch `harnessing`
> These are the taste invariants the harness _enforces mechanically_. Each rule names the
> gate that applies it, so "the rule exists" and "the rule is checked" are the same claim.
> Rationale for the numbers lives here; enforcement lives in `.eslintrc.js`,
> `scripts/harness/*`, and `.github/workflows/quality.yml`.

## Why these rules exist

An agent editing this repository has no memory of the review conversations that produced its
conventions. A rule that is not executable is therefore not a rule — it is folklore. Every
item below is either enforced by a gate that fails, or is explicitly listed in
`DEBT-BASELINE.md` as a known, bounded exception with a removal plan.

---

## R1 — A source file stays under 500 lines; 1000 is a hard stop

**Gate:** `scan.sh` metric `size.files_over_1000_lines` (tracked against the baseline),
plus the baseline list in `DEBT-BASELINE.md`.

**Why:** a 3368-line file cannot be held in context, cannot be reviewed, and produces merge
conflicts on unrelated changes. The threshold is a proxy for "can a reviewer hold this in
their head"; 500 is comfortable, 1000 is the point past which comprehension measurably drops.

**State at Phase 3:** 22 files over 1000 lines, 55 over 500. Wave W3 (backend) and W4
(frontend) reduce these. The metric may only decrease.

---

## R2 — Cognitive complexity ≤ 40 per function, ratcheting to 25

**Gate:** `sonarjs/cognitive-complexity` in `.eslintrc.js`.

**Why 40 for now:** the rule was configured at **200** (effectively disabled) for the entire
life of the project, so the real distribution was unknown. Installing ESLint at 40 revealed
29 functions above the line. Lowering it to 25 immediately would have required rewriting all
29 in one wave, which is exactly the "big-bang refactor" the plan forbids. 40 is the largest
value that still catches genuinely unruly functions; W6 lowers it to 25.

**Rule:** the number may only move _down_. Raising it is a change to this document, not a
config tweak.

---

## R3 — No unused bindings

**Gate:** `@typescript-eslint/no-unused-vars`, with `^_` opt-out.

**Why:** 94 existed. An unused import is a removed dependency that nobody noticed, and an
unused local is usually a bug where a computed value was meant to be used. Phase 3 removed
the 16 mechanically-safe dead imports; the remaining 78 live in destructuring patterns and
component props where removal requires a human judgement call, so they are baselined per file
in `DEBT-BASELINE.md`.

**Rule:** a leading underscore (`_props`) is the _only_ accepted way to keep an unused
binding, and it must be deliberate.

---

## R4 — No `any`, no `@ts-ignore`, no empty `catch {}`

**Gate:** `@typescript-eslint/no-explicit-any` (warn at Phase 3, error at W6),
`@typescript-eslint/ban-ts-comment`, `no-empty` (added in W6).

**Why:** `any` at a boundary is how a backend contract change becomes a runtime `undefined`
three call frames deep instead of a compile error at the edge. An empty `catch {}` is a
silent failure by construction — and two of the six in this codebase sit inside the
data-relocation flow that is already the subject of ISSUE-001/003.

**State:** 28 `any` (warn), 76 `ts-*` suppressions (currently off, baselined).

---

## R5 — No `unwrap()`/`expect()` on a path a user can reach

**Gate:** `scan.sh` metric `rust.unwrap_expect` tracked against the baseline; reviewed in
Phase 4 W1.

**Why:** 199 exist, and 96 of them are in `main.rs` on the startup, tray and window-event
paths. In a desktop app a panic there is not a stack trace to a developer — it is the
application disappearing from the user's screen with no explanation and, for a clipboard
manager, potentially unsaved history.

**Rule:** new code returns `Result` and converts at the command boundary. Existing sites
converge in W1; the count may only decrease.

---

## R6 — Layers point one way: `commands → services → models/db`

**Gate:** documented in `docs/architecture.md`, enforced by review until the structural
check script lands in W3.

**Why:** this is what keeps a business rule testable without spinning up Tauri. The moment a
service imports from `commands`, the logic can only be exercised through the IPC surface.

**Rule:** a command parses input and converts errors. Logic lives in a service. Nothing in
`services/` imports from `commands/`.

---

## R7 — Vendored code is out of scope, permanently

**Gate:** every ignore list — `.eslintrc.js` `ignorePatterns`, `scan.sh` `VENDOR_RE`,
`reachability.mjs` `VENDOR`, the typecheck baseline.

**Why:** `packages/pastebar-app-ui/src/components/libs/**` and `src-tauri/libs/**` are
third-party copies. Editing them creates an unmaintainable fork; linting them buries real
findings under 301 vendored errors. They are excluded everywhere, consistently.

---

## R8 — Every fix cites an ISSUE-ID and states whether behaviour changed

**Gate:** review; the commit-message format in `HARNESS_PLAN.md` §8.

**Why:** this is what makes `git log main..harnessing` a readable record rather than a pile
of `fix stuff` commits, and it is the only mechanism preventing a silent behaviour change
from hiding inside a refactor.

**Rule:** `refactor(x): … [ISSUE-012, behavior-preserving]` or
`fix(x): … [ISSUE-002, behavior change: documented]`.

---

## R9 — A gate's baseline may shrink, never grow

**Gate:** `DEBT-BASELINE.md` reviewed at each phase boundary.

**Why:** an exemption list without a ratchet is a permanent amnesty. The whole point of
recording the baseline is that the next commit has a number to beat.

---

## R10 — Documentation is part of the change

**Gate:** `docs-lint.sh` (reachability, link validity, `file:line` validity, staleness).

**Why:** the drift gates can see code and contracts; they cannot see prose. A module doc that
describes a function that no longer exists is worse than no doc, because it is confidently
wrong. `docs-lint.sh` catches the mechanical half of that (dangling paths, dead `file:line`
references, stale "last verified" dates); review catches the rest.
