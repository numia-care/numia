import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Куда возвращается юзер после клика по magic link.
// Supabase передаёт ?code=..., мы меняем его на сессию и редиректим домой.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'

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
