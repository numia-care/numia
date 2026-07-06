import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Куда возвращается юзер после клика по magic link.
// Supabase передаёт ?code=..., мы меняем его на сессию и редиректим домой.

// Валидация ?next= против open redirect: принимаем ТОЛЬКО внутренний путь.
// Должен начинаться с одиночного '/': `//evil.com` браузер трактует как
// protocol-relative URL, а `@evil.com` после origin — как userinfo@host
// (https://app.com@evil.com уводит на evil.com). Всё подозрительное → '/'.
function safeNextPath(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/'
  return next
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = safeNextPath(searchParams.get('next'))

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent('Не удалось войти по ссылке')}`,
  )
}
