import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Страница Swagger UI для BFF: /api/docs.
 *
 * Зачем на том же адресе, что и API. Кнопка «Try it out» шлёт запросы из
 * браузера. BFF не отдаёт CORS-заголовков, поэтому со страницы на другом
 * порту или домене браузер эти запросы заблокирует. Страница здесь же — и
 * проблемы нет.
 *
 * ВЫКЛЮЧЕНА ПО УМОЛЧАНИЮ. Включается переменной окружения API_DOCS=true.
 * Спецификация сама по себе публична (/api/v1/openapi.json), но страница со
 * встроенным отправителем запросов и полем для токена в проде не нужна.
 *
 * Swagger UI лежит в проекте (npm-пакет swagger-ui-dist, версия закреплена),
 * а не грузится с CDN: в проекте правило — никаких сторонних CDN. В поле
 * «Authorize» вводится настоящий токен, и чужой скрипт на этой странице мог
 * бы его унести.
 *
 * Отсюда же строгий CSP: скрипты и запросы только с нашего адреса, никаких
 * инлайн-скриптов — инициализация вынесена в отдельный файл init.js.
 */

export function apiDocsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.API_DOCS === 'true'
}

export const DOCS_BASE = '/api/docs'
export const SPEC_URL = '/api/v1/openapi.json'

export const DOCS_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  // Swagger UI расставляет style-атрибуты сам; nonce на атрибуты не вешается.
  // Инъекция CSS несравнимо слабее XSS, скрипты при этом закрыты.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

export function docsHtml(): string {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Numia BFF — API</title>
  <link rel="stylesheet" href="${DOCS_BASE}/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="${DOCS_BASE}/swagger-ui-bundle.js"></script>
  <script src="${DOCS_BASE}/init.js"></script>
</body>
</html>
`
}

export function docsInitScript(): string {
  return `window.addEventListener('load', function () {
  window.ui = SwaggerUIBundle({
    url: ${JSON.stringify(SPEC_URL)},
    dom_id: '#swagger-ui',
    deepLinking: true,
    tryItOutEnabled: true,
    // Не сохранять токен из «Authorize» в localStorage: закрыл вкладку — забыл.
    persistAuthorization: false,
    // Иначе Swagger UI отправляет спецификацию на внешний валидатор.
    validatorUrl: null
  });
});
`
}

// Какие файлы пакета отдаём. Закрытый список — никаких путей из запроса.
const DIST_FILES = {
  'swagger-ui.css': 'text/css; charset=utf-8',
  'swagger-ui-bundle.js': 'text/javascript; charset=utf-8',
} as const

export type DocsAsset = keyof typeof DIST_FILES

// Путь от корня процесса, а не через require.resolve: так его видит и
// трассировка файлов при сборке standalone (outputFileTracingIncludes в
// next.config.ts), и рантайм контейнера.
const DIST_DIR = join(process.cwd(), 'node_modules', 'swagger-ui-dist')

export async function docsAssetResponse(file: DocsAsset): Promise<Response> {
  const body = await readFile(join(DIST_DIR, file))
  return new Response(body, {
    headers: {
      'Content-Type': DIST_FILES[file],
      'Cache-Control': 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

export function docsTextResponse(body: string, contentType: string): Response {
  return new Response(body, {
    headers: {
      'Content-Type': contentType,
      'Content-Security-Policy': DOCS_CSP,
      'Cache-Control': 'no-store',
    },
  })
}
