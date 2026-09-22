import { randomBytes } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { GET, PUT } from '@/app/api/v1/e2e/recovery/route'
import {
  bffRequest,
  connectLocalSupabase,
  integrationEnabled,
  type LocalSupabase,
} from './test-support/local-supabase'

/**
 * GET/PUT /e2e/recovery против настоящего локального Supabase: условная запись
 * и триггер версии проверяются только на живом Postgres, подделка базы здесь
 * ничего бы не доказала. Запуск: NUMIA_INTEGRATION=1 pnpm test.
 */

const b64 = (bytes: number) => randomBytes(bytes).toString('base64')

function anchorBody(expected: number) {
  return {
    dek_wrapped_recovery: b64(60),
    recovery_salt: b64(16),
    recovery_kdf_iterations: 600_000,
    expected_anchor_version: expected,
  }
}

function call(method: 'GET' | 'PUT', token: string, body?: unknown) {
  const request = bffRequest('/e2e/recovery', method, token, body)
  return method === 'GET' ? GET(request, undefined) : PUT(request, undefined)
}

describe.skipIf(!integrationEnabled)('e2e/recovery на локальном Supabase', () => {
  let local: LocalSupabase

  beforeAll(() => {
    local = connectLocalSupabase()
  })

  afterAll(async () => {
    await local?.cleanup()
  })

  it('GET 404 → PUT(0) 200 → GET 200 → PUT(0) 409 → PUT(1) 200 → PUT(1) 409', async () => {
    const { token } = await local.signIn()

    expect((await call('GET', token)).status).toBe(404)

    const first = anchorBody(0)
    const created = await call('PUT', token, first)
    expect(created.status).toBe(200)
    expect(await created.json()).toMatchObject({ anchor_version: 1 })

    const read = await call('GET', token)
    expect(read.status).toBe(200)
    expect(await read.json()).toEqual({
      dek_wrapped_recovery: first.dek_wrapped_recovery,
      recovery_salt: first.recovery_salt,
      recovery_kdf_iterations: 600_000,
      anchor_version: 1,
    })

    const overwrite = await call('PUT', token, anchorBody(0))
    expect(overwrite.status).toBe(409)
    expect(await overwrite.json()).toMatchObject({ error: { code: 'conflict' } })

    const rotated = await call('PUT', token, anchorBody(1))
    expect(rotated.status).toBe(200)
    expect(await rotated.json()).toMatchObject({ anchor_version: 2 })

    expect((await call('PUT', token, anchorBody(1))).status).toBe(409)
  })

  it('два одновременных PUT(0): ровно один 200, второй 409, якорь — победителя', async () => {
    const { token } = await local.signIn()
    const bodies = [anchorBody(0), anchorBody(0)]

    const responses = await Promise.all(bodies.map((body) => call('PUT', token, body)))
    const statuses = responses.map((r) => r.status).sort()
    expect(statuses).toEqual([200, 409])

    const winner = bodies[responses.findIndex((r) => r.status === 200)]
    const stored = await (await call('GET', token)).json()
    expect(stored).toMatchObject({
      dek_wrapped_recovery: winner.dek_wrapped_recovery,
      anchor_version: 1,
    })
  })

  it('прямая запись в profiles, как у веба, сдвигает версию — iOS получает 409', async () => {
    const { token, client, id } = await local.signIn()
    expect((await call('PUT', token, anchorBody(0))).status).toBe(200)

    // Ровно то, что делает lib/crypto/vault.ts (writeRecoveryAnchor), плюс
    // попытка подделать версию — триггер её игнорирует.
    const { error } = await client
      .from('profiles')
      .update({
        recovery_salt: b64(16),
        dek_wrapped_recovery: b64(60),
        recovery_kdf_iterations: 600_000,
        recovery_anchor_version: 1,
      })
      .eq('id', id)
    expect(error).toBeNull()

    expect(await (await call('GET', token)).json()).toMatchObject({ anchor_version: 2 })
    expect((await call('PUT', token, anchorBody(1))).status).toBe(409)
  })

  it('повтор того же тела после потерянного ответа — снова 200 с той же версией', async () => {
    const { token } = await local.signIn()
    const body = anchorBody(0)
    expect((await call('PUT', token, body)).status).toBe(200)

    // Создание: условие «якоря нет» уже не выполняется, но якорь — наш.
    const create = await call('PUT', token, body)
    expect(create.status).toBe(200)
    expect(await create.json()).toMatchObject({ anchor_version: 1 })

    const rotation = anchorBody(1)
    expect((await call('PUT', token, rotation)).status).toBe(200)
    const retry = await call('PUT', token, rotation)
    expect(retry.status).toBe(200)
    expect(await retry.json()).toMatchObject({ anchor_version: 2 })
  })

  it('запись других полей профиля версию не трогает', async () => {
    const { token, client, id } = await local.signIn()
    expect((await call('PUT', token, anchorBody(0))).status).toBe(200)

    const { error } = await client.from('profiles').update({ timezone: 'Europe/Madrid' }).eq('id', id)
    expect(error).toBeNull()

    expect(await (await call('GET', token)).json()).toMatchObject({ anchor_version: 1 })
  })
})
