import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { DELETE, GET } from '@/app/api/v1/me/route'
import {
  bffRequest,
  connectLocalSupabase,
  integrationEnabled,
  type LocalSupabase,
  type TestUser,
} from './test-support/local-supabase'

/**
 * DELETE /me против локального Supabase: файлы, каскад по таблицам, отзыв
 * сессий и то, что соседний пользователь не задет. Запуск:
 * NUMIA_INTEGRATION=1 pnpm test.
 */

const BUCKET = 'path-media'

async function seed(user: TestUser) {
  // Файл — токеном пользователя, по той же схеме пути, что у веба.
  const upload = await user.client.storage
    .from(BUCKET)
    .upload(`${user.id}/entry-1`, new Blob([new Uint8Array(32)]))
  expect(upload.error).toBeNull()

  const range = await user.client
    .from('lab_ranges')
    .insert({ user_id: user.id, analyte: 'estradiol', min_value: 100, max_value: 500, unit: 'pmol_l' })
  expect(range.error).toBeNull()
}

describe.skipIf(!integrationEnabled)('DELETE /me на локальном Supabase', () => {
  let local: LocalSupabase

  beforeAll(() => {
    local = connectLocalSupabase()
  })

  afterAll(async () => {
    await local?.cleanup()
  })

  it('удаляет файлы, данные и сессии, не трогая другого пользователя', async () => {
    const [victim, neighbour] = [await local.signIn(), await local.signIn()]
    await seed(victim)
    await seed(neighbour)

    const res = await DELETE(bffRequest('/me', 'DELETE', victim.token), undefined)
    expect(res.status).toBe(204)

    const { admin } = local
    expect((await admin.auth.admin.getUserById(victim.id)).data.user).toBeNull()

    const files = await admin.storage.from(BUCKET).list(victim.id)
    expect(files.data).toEqual([])

    const profiles = await admin.from('profiles').select('id').eq('id', victim.id)
    expect(profiles.data).toEqual([])
    const ranges = await admin.from('lab_ranges').select('id').eq('user_id', victim.id)
    expect(ranges.data).toEqual([])

    // Старый токен больше не принимается: сессии удалены вместе с аккаунтом.
    expect((await GET(bffRequest('/me', 'GET', victim.token), undefined)).status).toBe(401)
    // Повтор после потерянного 204 — 401, а не 500.
    expect((await DELETE(bffRequest('/me', 'DELETE', victim.token), undefined)).status).toBe(401)

    // Соседа не задело.
    expect((await admin.storage.from(BUCKET).list(neighbour.id)).data).toHaveLength(1)
    expect((await admin.from('lab_ranges').select('id').eq('user_id', neighbour.id)).data).toHaveLength(1)
    expect((await GET(bffRequest('/me', 'GET', neighbour.token), undefined)).status).toBe(200)
  })

  it('аккаунт без файлов удаляется так же', async () => {
    const user = await local.signIn()
    expect((await DELETE(bffRequest('/me', 'DELETE', user.token), undefined)).status).toBe(204)
    expect((await local.admin.auth.admin.getUserById(user.id)).data.user).toBeNull()
  })
})
