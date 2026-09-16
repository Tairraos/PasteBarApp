import { beforeEach, describe, expect, it, vi } from 'vitest'

import { settingsStore } from '~/store/settingsStore'

// `settingsStore` is a vanilla zustand store (`createStore`), not a React hook, so its
// state is read with getState()/setState() and no renderer is needed.
//
// These tests target the custom-data-location actions, which are the frontend half of the
// P0 issues fixed in wave W1 (ISSUE-001/003). The Rust side is tested in
// src-tauri/src/db.rs; what matters here is that the store surfaces failures instead of
// reporting a relocation that did not happen — the UI's whole job in this flow is to not
// claim success it cannot verify.

const invoke = vi.fn()
vi.mock('@tauri-apps/api', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}))
vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn(() => Promise.resolve()),
  listen: vi.fn(() => Promise.resolve(() => {})),
}))
vi.mock('@tauri-apps/api/process', () => ({ relaunch: vi.fn() }))
vi.mock('@tauri-apps/api/updater', () => ({
  checkUpdate: vi.fn(),
  installUpdate: vi.fn(),
}))

beforeEach(() => {
  invoke.mockReset()
  settingsStore.setState({
    dbRelocationInProgress: false,
    customDbPathError: null,
    isCustomDbPathValid: null,
    customDbPath: null,
  })
})

describe('validateCustomDbPath', () => {
  it('marks the path valid when the backend accepts it', async () => {
    invoke.mockResolvedValueOnce(true)

    await settingsStore.getState().validateCustomDbPath('/Volumes/Data/PasteBar')

    expect(invoke).toHaveBeenCalledWith('cmd_validate_custom_db_path', {
      pathStr: '/Volumes/Data/PasteBar',
    })
    const s = settingsStore.getState()
    expect(s.isCustomDbPathValid).toBe(true)
    expect(s.customDbPathError).toBeNull()
  })

  it('marks the path invalid and keeps the backend message when rejected', async () => {
    invoke.mockRejectedValueOnce('Path traversal not allowed')

    await settingsStore.getState().validateCustomDbPath('../etc')

    const s = settingsStore.getState()
    expect(s.isCustomDbPathValid).toBe(false)
    expect(s.customDbPathError).toBe('Path traversal not allowed')
  })

  it('clears dbRelocationInProgress even when validation throws', async () => {
    // A stuck progress flag disables the settings form permanently, which is worse than
    // the validation error itself.
    invoke.mockRejectedValueOnce('boom')

    await settingsStore.getState().validateCustomDbPath('/nope')

    expect(settingsStore.getState().dbRelocationInProgress).toBe(false)
  })

  it('clears a previous error before revalidating', async () => {
    settingsStore.setState({ customDbPathError: 'stale error' })
    invoke.mockResolvedValueOnce(true)

    await settingsStore.getState().validateCustomDbPath('/Volumes/Data/PasteBar')

    expect(settingsStore.getState().customDbPathError).toBeNull()
  })
})

describe('applyCustomDbPath', () => {
  it('records the new path and returns the backend message on success', async () => {
    invoke.mockResolvedValueOnce('Data successfully copied to /Volumes/Data/PasteBar.')

    const message = await settingsStore
      .getState()
      .applyCustomDbPath('/Volumes/Data/PasteBar', 'copy')

    expect(invoke).toHaveBeenCalledWith('cmd_set_and_relocate_data', {
      newParentDirPath: '/Volumes/Data/PasteBar',
      operation: 'copy',
    })
    expect(message).toBe('Data successfully copied to /Volumes/Data/PasteBar.')

    const s = settingsStore.getState()
    expect(s.customDbPath).toBe('/Volumes/Data/PasteBar')
    expect(s.isCustomDbPathValid).toBe(true)
  })

  it('does not record the new path when the relocation fails', async () => {
    // The critical assertion: a failed move must not leave the UI believing the data is
    // now at the new location, because the user would then close the app and look for
    // their history in the wrong place.
    settingsStore.setState({ customDbPath: '/old/path' })
    invoke.mockRejectedValueOnce('Directory /ro is not writable')

    await expect(settingsStore.getState().applyCustomDbPath('/ro', 'copy')).rejects.toBe(
      'Directory /ro is not writable'
    )

    const s = settingsStore.getState()
    expect(s.customDbPath).toBe('/old/path')
    expect(s.customDbPathError).toBe('Directory /ro is not writable')
    expect(s.dbRelocationInProgress).toBe(false)
  })

  it('propagates the failure so the caller can stop its flow', async () => {
    invoke.mockRejectedValueOnce('failed')
    await expect(
      settingsStore.getState().applyCustomDbPath('/x', 'copy')
    ).rejects.toBeDefined()
  })
})

describe('revertToDefaultDbPath', () => {
  it('clears the custom path on success', async () => {
    settingsStore.setState({ customDbPath: '/Volumes/Data/PasteBar' })
    invoke.mockResolvedValueOnce('removed')

    await settingsStore.getState().revertToDefaultDbPath()

    const s = settingsStore.getState()
    expect(s.customDbPath).toBeNull()
    expect(s.isCustomDbPathValid).toBeNull()
  })

  it('keeps the custom path and reports the error on failure', async () => {
    settingsStore.setState({ customDbPath: '/Volumes/Data/PasteBar' })
    invoke.mockRejectedValueOnce('could not write config')

    await expect(settingsStore.getState().revertToDefaultDbPath()).rejects.toBeDefined()

    const s = settingsStore.getState()
    expect(s.customDbPath).toBe('/Volumes/Data/PasteBar')
    expect(s.customDbPathError).toBe('could not write config')
    expect(s.dbRelocationInProgress).toBe(false)
  })
})
