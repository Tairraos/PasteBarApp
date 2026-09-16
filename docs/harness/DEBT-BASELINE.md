# Debt baseline — explicit exemptions

> Last verified: 2026-09-16 · Branch `harnessing` · Phase 3
> **Ratchet rule (GOLDEN-RULES R9): every number here may only go DOWN.**
> A PR that raises a count, or adds a file to a list below, is a change to this document and
> must be reviewed as one. Each row names the wave that removes it.

Baselines are generated from the live gates, never hand-written:

```bash
# ESLint baseline (per-file error counts)
npx eslint "packages/pastebar-app-ui/src/**/*.{ts,tsx}" --format json -o /tmp/e.json
node -e "…"   # see scripts/harness/baseline-report.mjs

# Static metric baseline
bash scripts/harness/scan.sh
```

---

## 1. Scan baseline

Full report: [`scan-baseline.txt`](scan-baseline.txt), refreshed at the end of the overhaul.
The Phase-1 snapshot is preserved at commit `fcbb60e` for comparison.

| Metric                            | Phase 1 (`fcbb60e`) | Now            | Change                                           |
| --------------------------------- | ------------------- | -------------- | ------------------------------------------------ |
| `hygiene.tracked_dotenv`          | 1                   | **0**          | ✅ fixed                                         |
| `hygiene.tracked_build_artifacts` | 1                   | **0**          | ✅ fixed                                         |
| `hygiene.tracked_safelist`        | 2                   | **0**          | ✅ fixed                                         |
| `rust.test_markers`               | 0                   | **28**         | ✅ tests exist                                   |
| `ts.test_files`                   | 5 (all vendored)    | **8** (3 real) | ✅                                               |
| `ts.any`                          | 30                  | 23             | ↓                                                |
| `todo.all`                        | 4                   | 3              | ↓                                                |
| `rust.unwrap_expect`              | 199                 | 199            | unchanged — wave W1 was scoped to P0 correctness |
| `size.files_over_1000_lines`      | 22                  | 22             | unchanged — waves W3/W4 not started              |

Every metric either improved or is unchanged. Nothing regressed.

The metrics that must not regress from here:

| Metric                            | Baseline | Target          | Owner wave              |
| --------------------------------- | -------- | --------------- | ----------------------- |
| `rust.unwrap_expect`              | 199      | ≤ 99 (−50%)     | W1                      |
| `rust.main_unwrap_expect`         | 96       | ≤ 40            | W1                      |
| `rust.println`                    | 152      | ≤ 60            | W1                      |
| `rust.test_markers`               | **0**    | > 0 per service | Phase 5                 |
| `ts.console`                      | 167      | ≤ 80            | W6                      |
| `ts.any`                          | 30       | 0               | W6                      |
| `ts.empty_catch`                  | 6        | 0               | W1                      |
| `ts.ts_suppressions`              | 76       | ≤ 30            | W4                      |
| `size.files_over_1000_lines`      | **22**   | **0**           | W3 / W4                 |
| `size.files_over_500_lines`       | 55       | ≤ 30            | W3 / W4                 |
| `ipc.backend_registered_commands` | 115      | ≤ 115           | W2 (dead ones removed)  |
| frontend unreachable sources      | **191**  | 0               | **W4a**                 |
| `hygiene.tracked_dotenv`          | 1        | **0**           | Phase 3 §5.5 — **done** |
| `hygiene.tracked_build_artifacts` | 1        | **0**           | Phase 3 §5.5 — **done** |

---

## 2. ESLint baseline — 55 files with 94 errors

`sonarjs/cognitive-complexity` is set to **40** (was 200). Installing ESLint for the first
time surfaced 123 errors. Phase 3 removed the 16 mechanically-safe dead imports; the rest are
enumerated below and **must not grow**.

**Totals:** 49 `no-unused-vars` · 29 `cognitive-complexity` · 9 `no-collapsible-if` ·
3 `no-all-duplicated-branches` · 1 each of `no-use-before-define`, `import/no-unresolved`,
`sonarjs/no-identical-conditions`, `sonarjs/no-redundant-jump`. Warnings: 22 `no-explicit-any`.

**The baseline moved from 123 to 94 errors** after wave W4a deleted the 186 unreachable
files, which removed 29 lint errors along with them — a good illustration of why fixing
lint findings inside dead code is wasted effort. The authoritative per-file counts live in
`eslint-baseline.json`; the table below is the Phase 3 snapshot kept for the record.

| File                                                                                                             | Errors | Rules                                                                                       | Removal target         |
| ---------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------- | ---------------------- |
| `packages/pastebar-app-ui/src/pages/main/ClipboardHistoryPage.tsx`                                               | 10     | cognitive-complexity×5, no-unused-vars×2, no-collapsible-if×2, no-all-duplicated-branches×1 | W6 (complexity 25)     |
| `packages/pastebar-app-ui/src/components/search-modal/index.tsx`                                                 | 6      | no-unused-vars×6                                                                            | W4a (delete dead code) |
| `packages/pastebar-app-ui/src/pages/main/ClipboardHistoryQuickPastePage.tsx`                                     | 6      | no-unused-vars×3, cognitive-complexity×1, no-collapsible-if×1, no-redundant-jump×1          | W6 (complexity 25)     |
| `packages/pastebar-app-ui/src/libs/hooks/_useAuth.ts`                                                            | 5      | no-unused-vars×5                                                                            | W4a (delete dead code) |
| `packages/pastebar-app-ui/src/pages/components/ClipboardHistory/ClipboardHistoryRow.tsx`                         | 5      | no-collapsible-if×2, no-unused-vars×2, cognitive-complexity×1                               | W6 (complexity 25)     |
| `packages/pastebar-app-ui/src/pages/settings/UserPreferences.tsx`                                                | 5      | no-unused-vars×4, cognitive-complexity×1                                                    | W6 (complexity 25)     |
| `packages/pastebar-app-ui/src/pages/components/ClipboardHistory/ClipboardHistoryQuickPasteRow.tsx`               | 4      | no-unused-vars×4                                                                            | W4 (split)             |
| `packages/pastebar-app-ui/src/pages/components/Dashboard/components/ClipCard.tsx`                                | 4      | no-unused-vars×3, no-collapsible-if×1                                                       | W4 (split)             |
| `packages/pastebar-app-ui/src/quickpaste-main.tsx`                                                               | 4      | no-unused-vars×4                                                                            | W4 (split)             |
| `packages/pastebar-app-ui/src/layout/NavBar.tsx`                                                                 | 3      | no-unused-vars×2, cognitive-complexity×1                                                    | W6 (complexity 25)     |
| `packages/pastebar-app-ui/src/pages/components/ClipboardHistory/ClipboardHistoryWindowIcons.tsx`                 | 3      | no-unused-vars×2, no-all-duplicated-branches×1                                              | W4 (split)             |
| `packages/pastebar-app-ui/src/pages/components/Dashboard/Dashboard.tsx`                                          | 3      | cognitive-complexity×2, no-unused-vars×1                                                    | W6 (complexity 25)     |
| `packages/pastebar-app-ui/src/App.tsx`                                                                           | 2      | cognitive-complexity×1, no-collapsible-if×1                                                 | W6 (complexity 25)     |
| `packages/pastebar-app-ui/src/components/molecules/select/index.tsx`                                             | 2      | no-unused-vars×2                                                                            | W4a (delete dead code) |
| `packages/pastebar-app-ui/src/components/molecules/select/next-select/module-augmentation.ts`                    | 2      | no-unused-vars×2                                                                            | W4a (delete dead code) |
| `packages/pastebar-app-ui/src/components/molecules/select/select-components.tsx`                                 | 2      | no-unused-vars×2                                                                            | W4a (delete dead code) |
| `packages/pastebar-app-ui/src/components/molecules/tag-input/index.tsx`                                          | 2      | no-unused-vars×2                                                                            | W4 (split)             |
| `packages/pastebar-app-ui/src/components/organisms/modals/lock-screen-confirmation-modal.tsx`                    | 2      | cognitive-complexity×2                                                                      | W6 (complexity 25)     |
| `packages/pastebar-app-ui/src/lib/utils.ts`                                                                      | 2      | no-unused-vars×1, no-collapsible-if×1                                                       | W4 (split)             |
| `packages/pastebar-app-ui/src/pages/components/ClipboardHistory/context-menu/ClipboardHistoryRowContextMenu.tsx` | 2      | no-unused-vars×2                                                                            | W4 (split)             |
| `packages/pastebar-app-ui/src/pages/components/Dashboard/components/ClipEditContent.tsx`                         | 2      | cognitive-complexity×2                                                                      | W6 (complexity 25)     |
| `packages/pastebar-app-ui/src/pages/components/Dashboard/components/GlobalSearch.tsx`                            | 2      | no-unused-vars×1, no-identical-conditions×1                                                 | W4 (split)             |
| `packages/pastebar-app-ui/src/pages/main/PasteMenuPage.tsx`                                                      | 2      | cognitive-complexity×1, no-all-duplicated-branches×1                                        | W6 (complexity 25)     |
| `packages/pastebar-app-ui/src/components/atoms/fundamentals/icons/backspace-icon/index.tsx`                      | 1      | no-unused-vars×1                                                                            | W4 (split)             |
| `packages/pastebar-app-ui/src/components/atoms/fundamentals/icons/details-icon.tsx`                              | 1      | no-unused-vars×1                                                                            | W4 (split)             |
| `packages/pastebar-app-ui/src/components/atoms/fundamentals/icons/medusa-vice/index.tsx`                         | 1      | no-unused-vars×1                                                                            | W4 (split)             |
| `packages/pastebar-app-ui/src/components/atoms/fundamentals/icons/pointer-icon/index.tsx`                        | 1      | no-unused-vars×1                                                                            | W4 (split)             |
| `packages/pastebar-app-ui/src/components/atoms/fundamentals/icons/stop-icon.tsx`                                 | 1      | no-unused-vars×1                                                                            | W4 (split)             |
| `packages/pastebar-app-ui/src/components/atoms/link-card/link-card-track.tsx`                                    | 1      | no-unused-vars×1                                                                            | W4 (split)             |
| `packages/pastebar-app-ui/src/components/atoms/link-card/link-card.tsx`                                          | 1      | no-unused-vars×1                                                                            | W4 (split)             |
| `packages/pastebar-app-ui/src/components/audio-player/PlayerAudioContainer.tsx`                                  | 1      | no-unused-vars×1                                                                            | W4 (split)             |
| `packages/pastebar-app-ui/src/components/audio-player/PlayerMenu.tsx`                                            | 1      | no-collapsible-if×1                                                                         | W4 (split)             |
| `packages/pastebar-app-ui/src/components/code-editor/index.tsx`                                                  | 1      | cognitive-complexity×1                                                                      | W6 (complexity 25)     |
| `packages/pastebar-app-ui/src/components/icons.tsx`                                                              | 1      | no-unused-vars×1                                                                            | W4 (split)             |
| `packages/pastebar-app-ui/src/components/molecules/modal/stepped-modal.tsx`                                      | 1      | no-unused-vars×1                                                                            | W4 (split)             |
| `packages/pastebar-app-ui/src/components/molecules/select/next-select/use-select-props.tsx`                      | 1      | no-unused-vars×1                                                                            | W4a (delete dead code) |
| `packages/pastebar-app-ui/src/components/search-modal/use-keyboard-navigation-list.tsx`                          | 1      | no-unused-vars×1                                                                            | W4a (delete dead code) |
| `packages/pastebar-app-ui/src/components/theme-mode-toggle.tsx`                                                  | 1      | no-unused-vars×1                                                                            | W4 (split)             |
| `packages/pastebar-app-ui/src/components/ui/alert-dialog.tsx`                                                    | 1      | no-unused-vars×1                                                                            | W4 (split)             |
| `packages/pastebar-app-ui/src/components/ui/radio-group.tsx`                                                     | 1      | no-unused-vars×1                                                                            | W4 (split)             |
| `packages/pastebar-app-ui/src/components/ui/sheet.tsx`                                                           | 1      | no-unused-vars×1                                                                            | W4 (split)             |
| `packages/pastebar-app-ui/src/components/ui/toaster.tsx`                                                         | 1      | no-unused-vars×1                                                                            | W4 (split)             |
| `packages/pastebar-app-ui/src/components/ui/use-toast.ts`                                                        | 1      | no-unused-vars×1                                                                            | W4 (split)             |
| `packages/pastebar-app-ui/src/layout/NavBarHistoryWindow.tsx`                                                    | 1      | no-unused-vars×1                                                                            | W4 (split)             |
| `packages/pastebar-app-ui/src/layout/Tour.tsx`                                                                   | 1      | cognitive-complexity×1                                                                      | W6 (complexity 25)     |
| `packages/pastebar-app-ui/src/lib/text-transforms.ts`                                                            | 1      | no-use-before-define×1                                                                      | W4 (split)             |
| `packages/pastebar-app-ui/src/locales/locales.ts`                                                                | 1      | import/no-unresolved×1                                                                      | W4 (split)             |
| `packages/pastebar-app-ui/src/pages/components/ClipboardHistory/ClipboardHistoryIconMenu.tsx`                    | 1      | no-unused-vars×1                                                                            | W4 (split)             |
| `packages/pastebar-app-ui/src/pages/components/Dashboard/components/Board.tsx`                                   | 1      | cognitive-complexity×1                                                                      | W6 (complexity 25)     |
| `packages/pastebar-app-ui/src/pages/components/Dashboard/components/ClipEditForm.tsx`                            | 1      | cognitive-complexity×1                                                                      | W6 (complexity 25)     |
| `packages/pastebar-app-ui/src/pages/components/Dashboard/components/ClipEditTemplate.tsx`                        | 1      | no-unused-vars×1                                                                            | W4 (split)             |
| `packages/pastebar-app-ui/src/pages/components/Dashboard/components/ClipIcon.tsx`                                | 1      | no-unused-vars×1                                                                            | W4 (split)             |
| `packages/pastebar-app-ui/src/pages/components/Dashboard/components/ClipViewForm.tsx`                            | 1      | cognitive-complexity×1                                                                      | W6 (complexity 25)     |
| `packages/pastebar-app-ui/src/pages/components/Dashboard/components/context-menus/BoardContextMenu.tsx`          | 1      | no-unused-vars×1                                                                            | W4 (split)             |
| `packages/pastebar-app-ui/src/pages/components/Dashboard/components/context-menus/ClipsCardContextMenu.tsx`      | 1      | no-unused-vars×1                                                                            | W4 (split)             |
| `packages/pastebar-app-ui/src/pages/components/Dashboard/components/utils.ts`                                    | 1      | cognitive-complexity×1                                                                      | W6 (complexity 25)     |
| `packages/pastebar-app-ui/src/pages/components/Menu/MenuItem.tsx`                                                | 1      | cognitive-complexity×1                                                                      | W6 (complexity 25)     |
| `packages/pastebar-app-ui/src/pages/components/Menu/components/MenuCardViewBody.tsx`                             | 1      | cognitive-complexity×1                                                                      | W6 (complexity 25)     |
| `packages/pastebar-app-ui/src/pages/components/Menu/components/MenuClipCardViewBody.tsx`                         | 1      | no-unused-vars×1                                                                            | W4 (split)             |
| `packages/pastebar-app-ui/src/pages/settings/BackupRestoreSettings.tsx`                                          | 1      | no-unused-vars×1                                                                            | W4 (split)             |
| `packages/pastebar-app-ui/src/pages/settings/ClipboardHistorySettings.tsx`                                       | 1      | cognitive-complexity×1                                                                      | W6 (complexity 25)     |
| `packages/pastebar-app-ui/src/pages/settings/CustomDatabaseLocationSettings.tsx`                                 | 1      | no-unused-vars×1                                                                            | W4 (split)             |
| `packages/pastebar-app-ui/src/pages/settings/SecuritySettings.tsx`                                               | 1      | cognitive-complexity×1                                                                      | W6 (complexity 25)     |
| `packages/pastebar-app-ui/src/pages/settings/collections/ManageCollections.tsx`                                  | 1      | cognitive-complexity×1                                                                      | W6 (complexity 25)     |
| `packages/pastebar-app-ui/src/store/signalStore.ts`                                                              | 1      | cognitive-complexity×1                                                                      | W6 (complexity 25)     |
| `packages/pastebar-app-ui/src/types/window.d.ts`                                                                 | 1      | no-unused-vars×1                                                                            | W4 (split)             |

### Why these are baselined rather than fixed now

| Rule                         | Count | Why not fixed in Phase 3                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `no-unused-vars`             | 78    | The 16 removable dead _imports_ were removed automatically and verified by a production build. The remaining 78 are destructured props/params (`{ a, ...rest }`) and component-prop bindings where deletion changes a public component signature — that is component surgery, which belongs to W4 where the files are split anyway. Files under `search-modal/`, `molecules/select/`, `libs/hooks/_useAuth.ts` are **unreachable dead code** (ISSUE-030) and are deleted in W4a rather than cleaned. |
| `cognitive-complexity`       | 29    | These are the functions W4 splits. Rewriting them in place, in the same wave as the lint gate's introduction, would violate the "no big-bang refactor" constraint and would have no test coverage (Phase 5 has not landed). W6 lowers the threshold to 25 with these functions already split.                                                                                                                                                                                                        |
| `no-collapsible-if`          | 9     | Mergeable nested `if`s — behaviour-preserving but each needs a read of the surrounding branch to confirm the merge is equivalent. Batch them in W5 alongside the other mechanical cleanups.                                                                                                                                                                                                                                                                                                          |
| `no-all-duplicated-branches` | 3     | Two `if` branches with identical bodies usually indicate a real copy-paste bug (e.g. `ClipboardHistoryWindowIcons.tsx:261`, `PasteMenuPage.tsx:404`). Worth individual investigation in W5, not mechanical deletion.                                                                                                                                                                                                                                                                                 |
| single-site rules            | 4     | `import/no-unresolved` at `locales/locales.ts:16` needs a resolver config decision; the other three are one-line cleanups for W5.                                                                                                                                                                                                                                                                                                                                                                    |

**Vendored code is not in this list.** `components/libs/**` is excluded from ESLint entirely
(GOLDEN-RULES R7). Its 301 type errors and its lint findings are out of scope permanently.

---

## 3. TypeScript typecheck baseline

`npx tsc --noEmit -p tsconfig.json` reports **408 errors**, of which:

| Group                                                           | Count | Disposition                                      |
| --------------------------------------------------------------- | ----- | ------------------------------------------------ |
| Vendored `components/libs/react-twitter-embed/tests/cypress/**` | 301   | excluded permanently — vendored                  |
| Project files                                                   | 107   | almost entirely inside the 191 unreachable files |
| `packages/pastebar-app-ui/src/components/molecules/select/**`   | 45    | dead code → deleted in W4a                       |
| `components/search-modal/**`, `atoms/date-picker/**`            | 30    | dead code → deleted in W4a                       |
| reachable project files                                         | < 10  | fixed as part of enabling the gate               |

**The typecheck gate is therefore blocked on W4a (deleting the dead code), not on fixing type
errors.** Until then `check-all.sh` runs the typecheck gate in _advisory_ mode: it reports
but does not fail, and this document is the record of why. Enabling it as a hard gate is the
acceptance criterion for W4a.

---

## 4. Rust clippy baseline

Not yet measured at Phase 3 — `cargo clippy --all-targets` requires a full Tauri build and is
run in the `--fast`-excluded portion of `check-all.sh` and in CI's `macos-latest` job. The
first CI run populates this section; until then no `#[allow]` list has been added, which is
the conservative default (no amnesty granted before the count is known).

---

## 5. Deliberate non-targets

Recorded so they are not re-investigated every phase:

| Item                                                  | Why it is not a target                                                              |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `sonarjs/no-duplicate-string`                         | 61 hits, almost all i18n keys and CSS class strings. High noise, low defect signal. |
| `sonarjs/no-identical-functions`                      | Small callback bodies that are clearer duplicated than abstracted.                  |
| `sonarjs/no-nested-template-literals`                 | Pure style.                                                                         |
| `sonarjs/no-duplicated-branches`                      | Overlaps the `no-all-duplicated-branches` check, which _is_ enabled.                |
| Vendored `components/libs/**`, `src-tauri/libs/**`    | GOLDEN-RULES R7 — permanent.                                                        |
| `packages/pastebar-app-ui/src/components/ui/**` `any` | shadcn-style prop forwarding; `any` is idiomatic there.                             |
| eslintrc → flat config migration                      | DECISIONS D-002 — deferred past this overhaul.                                      |
| Tauri 1.x → 2.x                                       | Out of scope entirely.                                                              |
