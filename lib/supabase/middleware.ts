import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Хелпер обновления auth-сессии. Вызывается из proxy.ts на каждый запрос.
// Без этого Supabase access-токен истечёт и юзер вылетит из сессии.
//
// В Next.js 16 файл-конвенция middleware переименована в proxy, но Supabase
// docs всё ещё используют слово "middleware" — поэтому хелпер так и назван,
// чтобы при чтении доков Supabase не путаться.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          // Сначала обновляем cookies на request (чтобы Server Components
          // в этом же цикле видели свежие токены), потом пересоздаём response
          // и копируем cookies туда (чтобы браузер их получил в Set-Cookie).
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          )
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // ВАЖНО: getUser(), а не getSession() — getUser обращается на сервер
  // Supabase и реально верифицирует токен, getSession просто читает cookie.
  // Между createServerClient и getUser не должно быть никакой логики, иначе
  // можно создать гонку и сессия не обновится корректно.
  await supabase.auth.getUser()

  return response
}
