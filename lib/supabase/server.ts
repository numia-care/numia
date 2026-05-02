import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Клиент для Server Components, Server Actions и Route Handlers.
// В Next.js 16 cookies() — async, поэтому хелпер тоже async.
//
// Записать cookie из Server Component нельзя (HTTP не позволяет менять заголовки
// после старта стриминга) — поэтому setAll обёрнут в try/catch. Реальный refresh
// сессии будет делать middleware на следующем шаге авторизации.
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
