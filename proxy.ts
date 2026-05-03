import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

// Next.js 16: файл-конвенция middleware переименована в proxy.
// Запускается на каждый матчящийся запрос ДО рендера роута.
// Здесь только продлеваем Supabase-сессию; защиту роутов через redirect
// добавим отдельно когда появятся /(app) страницы.
export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    // Не запускаем proxy на статике, иконках и манифестах — auth-cookies им не нужны.
    '/((?!_next/static|_next/image|favicon\\.ico|manifest\\.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
