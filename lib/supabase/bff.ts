import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Supabase-клиенты для BFF (/api/v1). Веб сюда не ходит — у него свои
 * фабрики в client.ts и server.ts, сессия там живёт в cookies.
 *
 * Два клиента:
 *   - createAnonClient()          — без юзера. Только для входа: отправить код,
 *                                   проверить код, обновить токены.
 *   - createBearerClient(token)   — от имени юзера. Все запросы к данным.
 *
 * КЛЮЧЕВОЕ РЕШЕНИЕ: оба на publishable (anon) ключе, НЕ на service_role.
 * service_role обходит RLS целиком — с ним видна база всех юзеров, и
 * единственной границей безопасности становится код этого прокси. Пока мы
 * ходим с токеном юзера, политики Postgres режут строки по
 * user_id = auth.uid(), и баг здесь стоит одному человеку, а не всем.
 * Не менять без отдельного обсуждения (docs/api-v1.md, §3).
 *
 * Переменные окружения читаются в РАНТАЙМЕ (без префикса NEXT_PUBLIC_):
 * они не впекаются в бандл при сборке, поэтому один образ гоняется против
 * локального, dev- и prod-проекта Supabase сменой env контейнера.
 * NEXT_PUBLIC_-версии — запасной вариант для `pnpm dev` со старым .env.local.
 */
function supabaseEnv(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

  if (!url || !key) {
    // Падаем громко и на старте запроса, а не молча отдаём 500 из глубины.
    throw new Error('supabase_env_missing: нужны SUPABASE_URL и SUPABASE_PUBLISHABLE_KEY')
  }
  return { url, key }
}

// Сессию на сервере хранить негде, а обновлять токены — забота клиента
// (он зовёт POST /auth/refresh). Поэтому всё автоматическое выключено.
const SERVER_AUTH_OPTIONS = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
} as const

export function createAnonClient(): SupabaseClient {
  const { url, key } = supabaseEnv()
  return createSupabaseClient(url, key, { auth: SERVER_AUTH_OPTIONS })
}

export function createBearerClient(accessToken: string): SupabaseClient {
  const { url, key } = supabaseEnv()
  return createSupabaseClient(url, key, {
    auth: SERVER_AUTH_OPTIONS,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })
}
