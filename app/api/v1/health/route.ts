import { apiJson } from '@/lib/api/http'
import type { HealthResponse } from '@/lib/api/schemas'

// Проверка живости. Без авторизации — её дёргает docker healthcheck и
// мониторинг, у них токена нет. Никаких данных не отдаёт.
//
// force-dynamic: иначе Next может попробовать посчитать GET на этапе сборки,
// а нам нужно значение переменной окружения в рантайме.
export const dynamic = 'force-dynamic'

export async function GET() {
  return apiJson<HealthResponse>({
    status: 'ok',
    api: 'v1',
    // Проставляется при сборке образа (--build-arg APP_VERSION=...),
    // чтобы понимать, какая ревизия крутится на сервере.
    version: process.env.APP_VERSION ?? 'dev',
  })
}
