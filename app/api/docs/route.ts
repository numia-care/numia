import { apiDocsEnabled, docsHtml, docsTextResponse } from '@/lib/api/docs'
import { apiError } from '@/lib/api/http'

// GET /api/docs — Swagger UI. Включается API_DOCS=true, см. lib/api/docs.ts.
// force-dynamic: флаг читается в рантайме, а не впекается при сборке.
export const dynamic = 'force-dynamic'

export async function GET() {
  if (!apiDocsEnabled()) return apiError('not_found')
  return docsTextResponse(docsHtml(), 'text/html; charset=utf-8')
}
