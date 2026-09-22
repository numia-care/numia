import { apiJson } from '@/lib/api/http'
import { buildOpenApiDocument } from '@/lib/api/openapi'

// GET /api/v1/openapi.json — спецификация, собранная из zod-схем.
// Её импортируют Hoppscotch, Postman, Swagger UI и генератор Swift-клиента.
//
// force-static: документ зависит только от кода, а не от запроса, — Next
// соберёт его один раз при сборке.
export const dynamic = 'force-static'

export async function GET() {
  return apiJson(buildOpenApiDocument())
}
