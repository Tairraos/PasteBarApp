/**
 * In-memory fake for the Tauri IPC boundary.
 *
 * Every frontend test that touches the backend runs against this instead of a real Tauri
 * runtime. It is hand-written from the contract in `docs/contracts/tauri-ipc.md`, and the
 * design rule that matters is this:
 *
 *   **An unhandled command throws. It never returns undefined.**
 *
 * A fake that silently resolves `undefined` produces tests that pass against a lie — the
 * component renders "empty", the assertion on emptiness passes, and the real app throws.
 * Throwing turns "you forgot a handler" into a loud, immediate failure.
 *
 * Usage:
 *
 *   import { installFakeBackend } from '~/test/fake-backend'
 *
 *   const backend = installFakeBackend({ history: [makeHistoryItem()] })
 *   render(<ClipboardHistoryPage />)
 *   expect(await screen.findByText('hello')).toBeInTheDocument()
 *   expect(backend.calls).toContain('get_clipboard_histories')
 *
 * See docs/testing.md.
 */
import { vi } from 'vitest'

import type { ClipboardHistoryItem } from '~/types/history'
import type { Collection, Item } from '~/types/menu'

/** A recorded invocation, for asserting on what the UI asked for. */
export interface RecordedCall {
  command: string
  args: unknown
}

export interface FakeBackendState {
  history: ClipboardHistoryItem[]
  items: Item[]
  collections: Collection[]
  settings: Record<string, unknown>
  /** Every command the code under test invoked, in order. */
  calls: RecordedCall[]
}

export interface FakeBackend extends FakeBackendState {
  /** Add rows without going through a command — for arranging a test. */
  seed: (partial: Partial<Omit<FakeBackendState, 'calls'>>) => void
  /** Names of the commands invoked so far. */
  calledCommands: () => string[]
  /** Reset the recorded calls but keep the data. */
  clearCalls: () => void
}

type Handler = (args: Record<string, unknown>, state: FakeBackendState) => unknown

function nowIso() {
  return new Date('2026-01-01T00:00:00.000Z').toISOString()
}

/**
 * Handlers for the commands the frontend actually calls.
 *
 * Each one is deliberately simple — the fake is not a second implementation of the
 * backend, it is a stub whose *shape* matches. Logic that the test cares about should be
 * arranged explicitly via `seed()` so the test reads as a statement of its precondition.
 */
function defaultHandlers(): Record<string, Handler> {
  return {
    // --- clipboard history -----------------------------------------------------------
    get_clipboard_histories: (_args, s) => s.history,
    get_clipboard_histories_recent: (_args, s) => s.history,
    get_recent_clipboard_histories: (_args, s) => s.history,
    get_clipboard_history_pinned: (_args, s) => s.history.filter(h => h.isPinned),
    get_clipboard_history_starred: (_args, s) => s.history.filter(h => h.isFavorite),
    delete_clipboard_history_item: (args, s) => {
      s.history = s.history.filter(h => h.historyId !== args.id)
      return 'ok'
    },
    delete_all_clipboard_history: (_args, s) => {
      s.history = []
      return 'ok'
    },
    update_clipboard_history_item_is_pinned: (args, s) => {
      const row = s.history.find(h => h.historyId === args.id)
      if (row) row.isPinned = Boolean(args.isPinned)
      return 'ok'
    },
    update_clipboard_history_item_is_favorite: (args, s) => {
      const row = s.history.find(h => h.historyId === args.id)
      if (row) row.isFavorite = Boolean(args.isFavorite)
      return 'ok'
    },

    // --- items / clips ---------------------------------------------------------------
    get_all_items: (_args, s) => s.items,
    // `Item` has no collectionId field (the Rust side links items to collections through a
    // join table), and this command is currently one of the uncalled registered commands —
    // the handler exists so a future caller fails on assertion, not on a missing handler.
    get_items_by_collection_id: (args, s) =>
      s.items.filter(
        i => (i as Item & { collectionId?: string }).collectionId === args.collectionId
      ),
    get_items_by_tab_id: (args, s) => s.items.filter(i => i.tabId === args.tabId),
    create_new_item: (args, s) => {
      const item = { ...(args as object), id: `item-${s.items.length + 1}` } as Item
      s.items.push(item)
      return item
    },
    delete_item: (args, s) => {
      s.items = s.items.filter(i => i.id !== args.itemId)
      return 'ok'
    },

    // --- collections -----------------------------------------------------------------
    get_all_collections: (_args, s) => s.collections,
    create_new_collection: (args, s) => {
      const collection = {
        ...(args as object),
        collectionId: `collection-${s.collections.length + 1}`,
      } as Collection
      s.collections.push(collection)
      return collection
    },
    delete_collection: (args, s) => {
      s.collections = s.collections.filter(c => c.collectionId !== args.collectionId)
      return 'ok'
    },

    // --- settings --------------------------------------------------------------------
    get_all_settings: (_args, s) => s.settings,
    get_setting: (args, s) => s.settings[args.key as string] ?? null,
    cmd_get_all_settings: (_args, s) => s.settings,
    cmd_get_setting: (args, s) => s.settings[args.key as string] ?? null,
    cmd_set_setting: (args, s) => {
      s.settings[args.key as string] = args.value
      return null
    },
    cmd_setting_exists: (args, s) => String(args.key) in s.settings,

    // --- clipboard transport (write-only; the assertion is on `calls`) ---------------
    write_clipboard: () => 'ok',
    write_clipboard_image: () => 'ok',
    clear_clipboard_history: () => 'ok',

    // --- windows / app ---------------------------------------------------------------
    get_current_window_label: () => 'main',
    is_window_open: () => true,
    open_history_window: () => 'ok',
    close_quick_paste_window: () => 'ok',
    show_main_window: () => 'ok',
    hide_main_window: () => 'ok',
    get_app_version: () => '0.7.0',
    get_ui_version: () => '0.7.0',
  }
}

/**
 * Install the fake and return the mutable state it holds.
 *
 * `vi.mock` is hoisted by Vitest and cannot close over per-test values, so the state
 * object is created here and captured by the factory's closure. Each test gets a fresh
 * install because `vi.resetModules()` + a new call replaces the mock.
 */
export function installFakeBackend(
  initial: Partial<Omit<FakeBackendState, 'calls'>> = {}
): FakeBackend {
  const state: FakeBackendState = {
    history: initial.history ?? [],
    items: initial.items ?? [],
    collections: initial.collections ?? [],
    settings: initial.settings ?? {},
    calls: [],
  }

  const handlers = defaultHandlers()

  vi.mock('@tauri-apps/api/tauri', () => ({
    invoke: (command: string, args: Record<string, unknown> = {}) => {
      state.calls.push({ command, args })
      const handler = handlers[command]
      if (!handler) {
        // Fail loudly. See the file header: a silent `undefined` is how a test starts
        // passing against behaviour the real backend does not have.
        throw new Error(
          `fake-backend: no handler for '${command}'. Add one to defaultHandlers() or, ` +
            `if the UI should not be calling it, fix the caller. ` +
            `See docs/contracts/tauri-ipc.md for the registered command list.`
        )
      }
      return Promise.resolve(handler(args, state))
    },
  }))

  vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(() => Promise.resolve(() => {})),
    once: vi.fn(() => Promise.resolve(() => {})),
    emit: vi.fn(() => Promise.resolve()),
  }))

  const backend: FakeBackend = Object.assign(state, {
    seed(partial: Partial<Omit<FakeBackendState, 'calls'>>) {
      Object.assign(state, partial)
    },
    calledCommands: () => state.calls.map(c => c.command),
    clearCalls: () => {
      state.calls.length = 0
    },
  })

  return backend
}

// --- fixtures --------------------------------------------------------------------------
// Typed builders so a contract change breaks the fixture at compile time rather than
// silently producing a test that no longer models real data.

/**
 * A complete `ClipboardHistoryItem`. Every field is spelled out rather than cast, so that
 * adding a required field to the real type breaks this fixture at compile time instead of
 * producing a test that silently models data the app never sees.
 */
export function makeHistoryItem(
  overrides: Partial<ClipboardHistoryItem> = {}
): ClipboardHistoryItem {
  const ts = Date.parse(nowIso())
  return {
    historyId: 'history-1',
    options: null,
    historyOptions: null,
    copiedFromApp: null,

    title: null,
    value: 'hello world',
    valuePreview: 'hello world',
    _type: 'text',

    isImage: false,
    imageDataUrl: null,
    imagePathFullRes: null,
    imageHeight: 0,
    imageWidth: 0,
    imagePreviewHeight: 0,
    isLink: false,
    links: null,
    arrLinks: [],
    linkTitle: null,
    linkDescription: null,
    linkImage: null,
    linkFavicon: null,
    linkDomain: null,
    linkMetadata: null,
    isImageData: false,
    isMasked: false,
    isPassword: false,
    isPinned: false,
    isFavorite: false,
    isVideo: false,
    isCode: false,
    isText: true,
    isIgnored: false,
    hasEmoji: false,
    hasMaskedWords: false,
    valueTypeId: null,
    itemId: null,
    createdAt: ts,
    valueMorePreviewLines: null,
    valueMorePreviewChars: null,
    detectedLanguage: null,
    pinnedOrderNumber: 0,
    timeAgo: 'now',
    timeAgoShort: 'now',
    updatedAt: ts,
    createdDate: new Date(ts),
    updatedDate: new Date(ts),
    ...overrides,
  }
}

export function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: 'item-1',
    value: 'a saved clip',
    ...overrides,
  } as Item
}

export function makeCollection(overrides: Partial<Collection> = {}): Collection {
  const ts = Date.parse(nowIso())
  return {
    collectionId: 'collection-1',
    title: 'My collection',
    description: null,
    isDefault: false,
    isEnabled: true,
    isSelected: false,
    createdAt: ts,
    updatedAt: ts,
    createdDate: nowIso(),
    updatedDate: nowIso(),
    ...overrides,
  }
}
