import { beforeEach, describe, expect, it, vi } from 'vitest'

import { deleteAccount } from './account'

/**
 * deleteAccount без Supabase: порядок шагов и разбор сбоев. Настоящее удаление
 * (файлы, каскад, сессии) проверяет account.integration.test.ts.
 */

interface Calls {
  list: string[]
  remove: string[][]
  rpc: number
}

function fakeSupabase(options: {
  pages?: { id: string | null; name: string }[][]
  listError?: { status?: number }
  removeLimit?: number
  rpcResult?: { error: { code: string } | null; status: number }
}) {
  const calls: Calls = { list: [], remove: [], rpc: 0 }
  const pages = [...(options.pages ?? [])]
  const client = {
    storage: {
      from: () => ({
        list: async (folder: string) => {
          calls.list.push(folder)
          if (options.listError) return { data: null, error: options.listError }
          return { data: pages.shift() ?? [], error: null }
        },
        remove: async (paths: string[]) => {
          calls.remove.push(paths)
          const removed = paths.slice(0, options.removeLimit ?? paths.length)
          return { data: removed.map((name) => ({ name })), error: null }
        },
      }),
    },
    rpc: async () => {
      calls.rpc += 1
      return { data: null, ...(options.rpcResult ?? { error: null, status: 204 }) }
    },
  }
  return { client: client as never, calls }
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('deleteAccount', () => {
  it('сначала удаляет файлы пользователя, потом аккаунт', async () => {
    const { client, calls } = fakeSupabase({
      pages: [[{ id: 'f1', name: 'entry-1' }, { id: 'f2', name: 'session-1' }], []],
    })
    expect(await deleteAccount(client, 'user-1')).toBeNull()
    expect(calls.remove).toEqual([['user-1/entry-1', 'user-1/session-1']])
    expect(calls.rpc).toBe(1)
  })

  it('Storage недоступен — unreachable, аккаунт не трогаем', async () => {
    const { client, calls } = fakeSupabase({ listError: {} })
    expect(await deleteAccount(client, 'user-1')).toBe('unreachable')
    expect(calls.rpc).toBe(0)
  })

  it('Storage отказал с 403 — internal, аккаунт не трогаем', async () => {
    const { client, calls } = fakeSupabase({ listError: { status: 403 } })
    expect(await deleteAccount(client, 'user-1')).toBe('internal')
    expect(calls.rpc).toBe(0)
  })

  it('политика молча не дала удалить файл — internal, без вечного цикла', async () => {
    const { client, calls } = fakeSupabase({
      pages: [[{ id: 'f1', name: 'a' }, { id: 'f2', name: 'b' }]],
      removeLimit: 1,
    })
    expect(await deleteAccount(client, 'user-1')).toBe('internal')
    expect(calls.rpc).toBe(0)
  })

  it('база недоступна на удалении аккаунта — unreachable', async () => {
    const { client } = fakeSupabase({ rpcResult: { error: { code: '' }, status: 0 } })
    expect(await deleteAccount(client, 'user-1')).toBe('unreachable')
  })
})
