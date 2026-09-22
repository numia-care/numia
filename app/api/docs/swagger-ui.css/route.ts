import { apiDocsEnabled, docsAssetResponse } from '@/lib/api/docs'
import { apiError } from '@/lib/api/http'

// Файл Swagger UI из пакета swagger-ui-dist. Отдаётся только при API_DOCS=true.
export const dynamic = 'force-dynamic'

export async function GET() {
  if (!apiDocsEnabled()) return apiError('not_found')
  return docsAssetResponse('swagger-ui.css')
}
