import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/tauri'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  invokeFetcher,
  useInvokeMutation,
  useInvokeQuery,
} from '~/hooks/queries/use-invoke'

// This is the one place the frontend builds a command name dynamically, and the IPC drift
// gate (scripts/harness/gen-ipc-contract.mjs) explicitly cannot see through it — it lists
// this file as a known blind spot rather than pretending full coverage. That makes it the
// single most valuable module to test directly: a bug here is invisible to every static
// check in the harness.

vi.mock('@tauri-apps/api/tauri', () => ({
  invoke: vi.fn(),
}))

const mockedInvoke = vi.mocked(invoke)

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

afterEach(() => {
  vi.resetAllMocks()
})

describe('invokeFetcher', () => {
  it('passes the command name and args through to invoke', async () => {
    mockedInvoke.mockResolvedValueOnce('result')

    await expect(invokeFetcher('get_all_items', { limit: 5 })).resolves.toBe('result')

    expect(mockedInvoke).toHaveBeenCalledTimes(1)
    expect(mockedInvoke).toHaveBeenCalledWith('get_all_items', { limit: 5 })
  })

  it('works without args', async () => {
    mockedInvoke.mockResolvedValueOnce('ok')

    await expect(invokeFetcher('app_ready')).resolves.toBe('ok')

    // `undefined` must be forwarded as-is; substituting `{}` would change what the Rust
    // command receives for a command whose parameter is optional.
    expect(mockedInvoke).toHaveBeenCalledWith('app_ready', undefined)
  })

  it('rethrows the backend error rather than resolving undefined', async () => {
    // The failure mode this guards: a swallowed error makes React Query treat a failed
    // command as a successful one that returned nothing, so `isError` stays false and the
    // UI shows an empty state instead of a failure.
    const boom = new Error('command failed')
    mockedInvoke.mockRejectedValueOnce(boom)

    await expect(invokeFetcher('get_all_items')).rejects.toBe(boom)
  })

  it('propagates a synchronous throw from invoke', async () => {
    // `invoke` can throw synchronously when the command name is rejected by the IPC
    // layer. The try/catch must not turn that into a resolved promise.
    mockedInvoke.mockImplementationOnce(() => {
      throw new Error('unknown command')
    })

    await expect(invokeFetcher('nope')).rejects.toThrow('unknown command')
  })
})

describe('useInvokeQuery', () => {
  it('fetches through the command and exposes the data', async () => {
    mockedInvoke.mockResolvedValueOnce([{ id: 1 }])

    const { result } = renderHook(
      () => useInvokeQuery<Record<string, unknown>, unknown[]>('get_all_items'),
      {
        wrapper,
      }
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([{ id: 1 }])
  })

  it('surfaces an error state when the command fails', async () => {
    mockedInvoke.mockRejectedValueOnce(new Error('db down'))

    const { result } = renderHook(() => useInvokeQuery('get_all_items'), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
  })
})

describe('useInvokeMutation', () => {
  it('sends the mutation variables as command args', async () => {
    mockedInvoke.mockResolvedValueOnce('ok')

    const { result } = renderHook(
      () => useInvokeMutation<{ id: string }, string>('delete_item'),
      { wrapper }
    )

    result.current.mutate({ id: 'item-1' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockedInvoke).toHaveBeenCalledWith('delete_item', { id: 'item-1' })
  })

  it('reports failure instead of a successful no-op', async () => {
    mockedInvoke.mockRejectedValueOnce(new Error('nope'))

    const { result } = renderHook(
      () => useInvokeMutation<{ id: string }, string>('delete_item'),
      { wrapper }
    )

    result.current.mutate({ id: 'item-1' })

    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
