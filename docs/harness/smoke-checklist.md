# Smoke checklist

> Last verified: 2026-09-16 · Branch `harnessing` · Phase 3
> **Use this until Phase 5's automated tests land, and for any change that touches the
> capture path, the IPC boundary, window lifecycle, or the data directory.** There is no
> automated coverage of these flows yet (ISSUE-006), so a green `check-all.sh` does NOT mean
> the app still works.

## How to run it

```bash
# 1. static gates first — they catch the cheap mistakes
bash scripts/harness/check-all.sh --fast

# 2. build and launch the dev app
npm start          # Vite on :4422 + tauri dev

# 3. walk the checklist below, in order
```

Record the result in the commit message or PR description as
`smoke: 12/12` plus the name of any item you skipped and why. **An item you could not verify
is reported as unverified, not as passing.**

---

## The eight core flows (HARNESS_PLAN §6.1)

| #   | Flow                     | Steps                                                                                | Pass condition                                                              |
| --- | ------------------------ | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| 1   | **Startup**              | Launch `npm start` on a cold start                                                   | Main window appears; no panic in the terminal; tray icon present            |
| 2   | **Copy → history**       | Copy a distinctive string in another app; open the history window                    | The new row appears at the top within ~1 s                                  |
| 3   | **Paste**                | Click that row in the history window                                                 | The string lands in the previously focused app's caret                      |
| 4   | **QuickPaste**           | Trigger the QuickPaste hotkey, type to search, press Enter                           | Popup opens, filters, pastes, and closes                                    |
| 5   | **Tray menu**            | Open the tray menu; click a saved clip; click "Open PasteBar"                        | Menu lists collections/clips; clicking copies; the window opens             |
| 6   | **Collections CRUD**     | Create a collection → rename it → add a tab → delete the tab → delete the collection | Every step reflected in the UI and after a restart                          |
| 7   | **Backup / restore**     | Settings → create a backup, then restore it                                          | Backup file produced; restore reports success; history intact afterwards    |
| 8   | **Image path transform** | Copy an image; restart; reopen the history window                                    | The image thumbnail still renders (proves the `{{base_folder}}` round-trip) |

---

## Additional checks for the P0/P1 areas

These are the flows the Phase 4 waves touch. Run the relevant block for the wave you change.

### Data relocation (ISSUE-001, ISSUE-003 — wave W1)

| Check                                                                | Expected                                                                           |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Settings → custom data location → point at a **new empty** directory | Relocation reports success; app usable after restart                               |
| After relocating, restart                                            | History and images are still present (the config lookup must find the custom path) |
| Point at a path containing `..`                                      | Rejected with a validation error, nothing moved                                    |
| Point at an existing **file** rather than a directory                | Rejected; nothing moved                                                            |
| Point at a read-only directory                                       | Rejected **before** any file is moved                                              |

### Retention / auto-clear (ISSUE-014 — wave W1)

| Check                                                                      | Expected                                                  |
| -------------------------------------------------------------------------- | --------------------------------------------------------- |
| Enable auto-clear with the shortest duration; wait past one scheduler tick | Old rows disappear without needing 200 clipboard captures |
| Pin a row, then run auto-clear                                             | Pinned row survives                                       |
| Star a row, then run auto-clear                                            | Starred row survives                                      |

### Clipboard capture (ISSUE-002, ISSUE-023 — wave W1/W2)

| Check                                       | Expected                                                             |
| ------------------------------------------- | -------------------------------------------------------------------- |
| Copy immediately while the app is starting  | No crash; the copy is either captured or cleanly skipped             |
| Copy a very large text blob                 | App stays responsive; the history list still scrolls                 |
| Disable history capture, then copy          | Nothing added to history                                             |
| Add an excluded app, copy from it           | Nothing added                                                        |
| Auto-mask list enabled with a matching word | The word is masked in the list **and** unchanged in the stored value |

### Multi-window sync (ISSUE-011 — wave W2)

| Check                                                                | Expected                                       |
| -------------------------------------------------------------------- | ---------------------------------------------- |
| Change a setting in the main window while the history window is open | The change is reflected there without a reload |
| Delete a history row in the history window                           | It disappears from the main window's list too  |

---

## Platform matrix

| Platform              | Required    | Notes                                                |
| --------------------- | ----------- | ---------------------------------------------------- |
| macOS (Apple Silicon) | yes         | primary development target                           |
| macOS (Intel)         | best effort | if hardware available                                |
| Windows               | best effort | tray/theme code paths differ; CI does not cover them |

State which platform you ran on. **A macOS-only smoke run does not validate the Windows
tray and auto-start paths**, and those are the ones with the most `#[cfg(target_os)]` code.

---

## When something fails

1. Do not "fix it in passing". Record it in [`ISSUES.md`](ISSUES.md) with a new ISSUE-ID.
2. If it blocks the current wave, say so explicitly rather than shipping the wave.
3. If it is a regression from the current wave's commit, revert that commit — each wave is
   designed to be independently revertable for exactly this reason.
