import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'

/**
 * Общая обвязка интеграционных тестов BFF (*.integration.test.ts) против
 * локального Supabase.
 *
 * Запуск (нужен `supabase start` с применёнными миграциями):
 *   NUMIA_INTEGRATION=1 pnpm test
 * Без флага такие тесты пропускаются — обычный `pnpm test` не требует Docker.
 *
 * Секретный ключ локального стека используется ТОЛЬКО здесь: создать и удалить
 * тестовых пользователей и проверить результат в обход RLS. Маршруты под тестом
 * ходят с токеном пользователя, как в проде.
 */

export const integrationEnabled = process.env.NUMIA_INTEGRATION === '1'

export interface TestUser {
  id: string
  token: string
  /** Клиент с сессией пользователя — ходит в базу так же, как веб. */
  client: SupabaseClient
}

export interface LocalSupabase {
  admin: SupabaseClient
  signIn(): Promise<TestUser>
  cleanup(): Promise<void>
}

const NO_SESSION = { persistSession: false, autoRefreshToken: false } as const

export function connectLocalSupabase(): LocalSupabase {
  const out = execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8' })
  const stack = JSON.parse(out.slice(out.indexOf('{'))) as {
    API_URL: string
    PUBLISHABLE_KEY: string
    SECRET_KEY: string
  }

  // Маршруты BFF читают окружение в рантайме (lib/supabase/bff.ts).
  process.env.SUPABASE_URL = stack.API_URL
  process.env.SUPABASE_PUBLISHABLE_KEY = stack.PUBLISHABLE_KEY

  const admin = createClient(stack.API_URL, stack.SECRET_KEY, { auth: NO_SESSION })
  const created: string[] = []

  return {
    admin,

    // Пользователь с настоящей сессией, без почты: admin выдаёт одноразовый
    // код тем же механизмом, что письмо, а вход идёт обычным verifyOtp.
    async signIn() {
      const email = `bff-test-${randomUUID()}@example.com`
      const user = await admin.auth.admin.createUser({ email, email_confirm: true })
      if (user.error) throw user.error
      created.push(user.data.user.id)

      const link = await admin.auth.admin.generateLink({ type: 'magiclink', email })
      if (link.error) throw link.error

      const client = createClient(stack.API_URL, stack.PUBLISHABLE_KEY, { auth: NO_SESSION })
      const verified = await client.auth.verifyOtp({
        email,
        token: link.data.properties.email_otp,
        type: 'email',
      })
      if (verified.error || !verified.data.session) throw verified.error ?? new Error('no session')

      // Запросы в базу от имени пользователя, как у веба.
      await client.auth.setSession(verified.data.session)
      return { id: user.data.user.id, token: verified.data.session.access_token, client }
    },

    // Пользователь мог быть уже удалён самим тестом — ошибку «не найден»
    // игнорируем.
    async cleanup() {
      for (const id of created) await admin.auth.admin.deleteUser(id)
    },
  }
}

export function bffRequest(path: string, method: string, token: string, body?: unknown) {
  return new NextRequest(`http://bff.test/api/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}
