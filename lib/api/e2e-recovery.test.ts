import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GET, PUT } from '@/app/api/v1/e2e/recovery/route'

/**
 * GET/PUT /e2e/recovery без базы: Supabase подменён. Проверяем то, что должно
 * держаться при любом ответе хранилища, — прежде всего «сбой чтения ≠ 404».
 * Условная запись и триггер версии проверяются на настоящем Postgres в
 * e2e-recovery.integration.test.ts.
 */

interface DbResult {
  data: unknown
  error: { code?: string; message: string } | null
  status: number
}

let dbResults: DbResult[] = []

// Цепочка PostgREST: любой метод возвращает саму цепочку, а завершающий
// maybeSingle — очередной подготовленный ответ.
function fakeQuery() {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'update', 'eq', 'is']) chain[method] = () => chain
  chain.maybeSingle = async () => dbResults.shift()
  return chain
}

vi.mock('@/lib/supabase/bff', () => ({
  createBearerClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    from: () => fakeQuery(),
  }),
}))

const WRAPPED = Buffer.alloc(60, 1).toString('base64')
const SALT = Buffer.alloc(16, 2).toString('base64')

function request(method: 'GET' | 'PUT', body?: unknown) {
  return new NextRequest('http://bff.test/api/v1/e2e/recovery', {
    method,
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const validPut = {
  dek_wrapped_recovery: WRAPPED,
  recovery_salt: SALT,
  recovery_kdf_iterations: 600_000,
  expected_anchor_version: 0,
}

beforeEach(() => {
  dbResults = []
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('GET /e2e/recovery', () => {
  it('база недоступна — 503, а не 404', async () => {
    dbResults = [{ data: null, error: { code: '', message: 'TypeError: fetch failed' }, status: 0 }]
    const res = await GET(request('GET'), undefined)
    expect(res.status).toBe(503)
  })

  it('ошибка Postgres — 500, а не 404', async () => {
    dbResults = [{ data: null, error: { code: '42501', message: 'permission denied' }, status: 403 }]
    const res = await GET(request('GET'), undefined)
    expect(res.status).toBe(500)
  })

  it('нет строки профиля — 500, а не 404', async () => {
    dbResults = [{ data: null, error: null, status: 200 }]
    const res = await GET(request('GET'), undefined)
    expect(res.status).toBe(500)
  })

  it('профиль есть, обёртки нет — 404', async () => {
    dbResults = [
      {
        data: {
          dek_wrapped_recovery: null,
          recovery_salt: null,
          recovery_kdf_iterations: null,
          recovery_anchor_version: 0,
        },
        error: null,
        status: 200,
      },
    ]
    const res = await GET(request('GET'), undefined)
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: { code: 'not_found' } })
  })
})

describe('PUT /e2e/recovery — валидация', () => {
  it.each([
    ['dek_wrapped_recovery', Buffer.alloc(59).toString('base64')],
    ['dek_wrapped_recovery', Buffer.alloc(61).toString('base64')],
    ['recovery_salt', Buffer.alloc(15).toString('base64')],
    ['recovery_salt', Buffer.alloc(16, 0xfb).toString('base64url')],
    ['recovery_salt', SALT.replace(/=+$/, '')],
  ])('%s неверной длины или формата — 400 с field', async (field, value) => {
    const res = await PUT(request('PUT', { ...validPut, [field]: value }), undefined)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: { code: 'invalid_input', field } })
    expect(dbResults).toEqual([])
  })

  it.each([
    ['recovery_kdf_iterations', 210_000],
    ['recovery_kdf_iterations', 10_000_001],
    ['recovery_kdf_iterations', 600_000.5],
    ['expected_anchor_version', -1],
  ])('%s = %s — 400 с field', async (field, value) => {
    const res = await PUT(request('PUT', { ...validPut, [field]: value }), undefined)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: { code: 'invalid_input', field } })
  })

  it('без expected_anchor_version — 400', async () => {
    const body: Partial<typeof validPut> = { ...validPut }
    delete body.expected_anchor_version
    const res = await PUT(request('PUT', body), undefined)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: { field: 'expected_anchor_version' } })
  })

  it('незнакомое поле — 400', async () => {
    const res = await PUT(request('PUT', { ...validPut, dek: 'x' }), undefined)
    expect(res.status).toBe(400)
  })

  it('база недоступна при записи — 503', async () => {
    dbResults = [{ data: null, error: { code: '', message: 'fetch failed' }, status: 0 }]
    const res = await PUT(request('PUT', validPut), undefined)
    expect(res.status).toBe(503)
  })
})
