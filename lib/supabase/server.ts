import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { cache } from 'react'

// Клиент для Server Components, Server Actions и Route Handlers.
// В Next.js 16 cookies() — async, поэтому хелпер тоже async.
//
// Записать cookie из Server Component нельзя (HTTP не позволяет менять заголовки
// после старта стриминга) — поэтому setAll обёрнут в try/catch. Реальный refresh
// сессии будет делать middleware на следующем шаге авторизации.
// Юзер текущего запроса — ОДИН auth.getUser() на HTTP-запрос, сколько бы
// серверных компонентов/функций его ни спросили. Каждый вызов getUser — это
// сетевой поход в Supabase Auth (~50-150мс): до этого кэша рендер /tracker
// делал их четыре подряд (перф-репорт беты, 2026-07-22). React cache()
// мемоизирует в пределах одного серверного рендера, между запросами не течёт.
export const getAuthUser = cache(async () => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
})

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // Вызвано из Server Component — игнорируем, middleware обновит сессию.
          }
        },
      },
    },
  )
}
