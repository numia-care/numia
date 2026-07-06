import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

// Next.js 16: файл-конвенция middleware переименована в proxy.
// Запускается на каждый матчящийся запрос ДО рендера роута. Здесь:
//   1. Строим строгий CSP с per-request nonce (см. buildCsp ниже).
//   2. Продлеваем Supabase-сессию (updateSession).
//   3. Вешаем CSP на ответ.
//
// Зачем строгий CSP именно нам: DEK (ключ E2E-шифрования) живёт в памяти JS
// (lib/crypto/session.ts). Любой XSS = кража расшифрованного контента. CSP с
// nonce — главный defense-in-depth: чужой <script> без правильного nonce
// браузер не выполнит, даже если разметку удалось инжектнуть.
//
// Как работает nonce в Next (docs: 01-app/02-guides/content-security-policy):
// proxy кладёт CSP в ЗАГОЛОВКИ ЗАПРОСА → Next при SSR сам вытаскивает nonce
// по паттерну 'nonce-…' и вешает его на все свои скрипты (framework, бандлы,
// инлайн). Требование: страницы рендерятся динамически (у нас так и есть;
// единственная статическая /offline переведена на connection()).

function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === 'development'

  // Точный origin Supabase-проекта (не wildcard *.supabase.co): REST, Auth,
  // Storage (загрузка/скачивание шифроблобов «Пути») ходят только туда.
  const supabaseOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin

  const directives = [
    `default-src 'self'`,
    // strict-dynamic: скрипты с nonce могут подгружать чанки (code-splitting
    // Next), при этом host-allowlist игнорируется — самая строгая схема.
    // В dev нужен unsafe-eval (React восстанавливает серверные стеки ошибок).
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    // unsafe-inline для стилей — осознанный компромисс: у нас много style-
    // АТРИБУТОВ из React (цвета шкалы настроения, задержки анимаций, вспышка ✦),
    // а на атрибуты nonce не вешается. Инъекция CSS несравнимо слабее XSS.
    `style-src 'self' 'unsafe-inline'`,
    // blob: — object URLs расшифрованных на устройстве фото «Пути».
    `img-src 'self' blob: data:`,
    // blob: — object URLs расшифрованных голосовых записей (<audio>).
    `media-src 'self' blob:`,
    // Сеть: свой origin (server actions, RSC) + Supabase (+ ws HMR в dev).
    `connect-src 'self' ${supabaseOrigin}${isDev ? ' ws:' : ''}`,
    `font-src 'self'`, // шрифты только самохостинг (next/font), без CDN
    `worker-src 'self'`, // service worker PWA
    `manifest-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`, // дублирует X-Frame-Options: DENY из next.config
  ]
  if (!isDev) directives.push('upgrade-insecure-requests')

  return directives.join('; ')
}

export async function proxy(request: NextRequest) {
  // Web Crypto (не Buffer) — работает и в Node, и в Edge runtime.
  const nonce = btoa(crypto.randomUUID())
  const csp = buildCsp(nonce)

  // Мутируем заголовки ЗАПРОСА до updateSession: внутри него
  // NextResponse.next({ request }) пронесёт их в рендер, где Next вытащит
  // nonce. x-nonce — на случай ручного <Script nonce={…}> в будущем.
  request.headers.set('x-nonce', nonce)
  request.headers.set('content-security-policy', csp)

  const response = await updateSession(request)

  // И на ОТВЕТ — этот заголовок читает браузер.
  response.headers.set('content-security-policy', csp)
  return response
}

export const config = {
  matcher: [
    // Не запускаем proxy на статике, иконках и манифестах — auth-cookies им не нужны.
    '/((?!_next/static|_next/image|favicon\\.ico|manifest\\.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
