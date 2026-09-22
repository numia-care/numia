import { apiDocsEnabled, docsInitScript, docsTextResponse } from '@/lib/api/docs'
import { apiError } from '@/lib/api/http'

// Инициализация Swagger UI отдельным файлом, а не инлайн-скриптом в HTML:
// так CSP страницы обходится без 'unsafe-inline' для скриптов.
export const dynamic = 'force-dynamic'

export async function GET() {
  if (!apiDocsEnabled()) return apiError('not_found')
  return docsTextResponse(docsInitScript(), 'text/javascript; charset=utf-8')
}
