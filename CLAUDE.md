# CLAUDE.md

> This file exists only because some tooling looks for it by name. **It is not a source of
> truth.** The maintained entry point is [`AGENTS.md`](AGENTS.md).

## Read this instead

**[`AGENTS.md`](AGENTS.md)** — the map: commands, repository layout, architecture rules,
golden rules, and an index of every deeper document.

## Why this file is a stub

It previously held a ~250-line encyclopaedia of project knowledge that duplicated, and then
drifted from, the code. Its architecture notes and command list had gone stale, and its
"no test infrastructure" line was the only part still true years later.

Per the harness plan (Phase 2, task 2.2), project knowledge now lives in exactly one place,
and `scripts/harness/docs-lint.sh` fails the build when a document becomes unreachable or a
link dangles. Keeping a second copy here would recreate the drift this overhaul removes.

## Quick pointers

| Need                           | Go to                                                        |
| ------------------------------ | ------------------------------------------------------------ |
| Build / dev / test commands    | [`AGENTS.md`](AGENTS.md) § Commands                          |
| Architecture and layering      | [`docs/architecture.md`](docs/architecture.md)               |
| IPC commands and events        | [`docs/contracts/tauri-ipc.md`](docs/contracts/tauri-ipc.md) |
| Known defects, severity-graded | [`docs/harness/ISSUES.md`](docs/harness/ISSUES.md)           |
| What the gates are             | [`docs/harness/gates.md`](docs/harness/gates.md)             |
| Documentation index            | [`docs/README.md`](docs/README.md)                           |
