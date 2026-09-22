import { mapAuthError } from '@/lib/api/auth'
import { REFRESH_PER_IP, REFRESH_PER_TOKEN, toTokenResponse } from '@/lib/api/auth-flow'
import { apiError, apiJson, parseJsonBody, withErrorBoundary } from '@/lib/api/http'
import { clientIp, enforceRateLimits } from '@/lib/api/rate-limit'
import { RefreshRequestSchema } from '@/lib/api/schemas'
import { createAnonClient } from '@/lib/supabase/bff'

/**
 * POST /api/v1/auth/refresh — получить новую пару токенов.
 *
 * Refresh-токен одноразовый: после обмена старый перестаёт работать.
 * Клиент обязан сохранить НОВЫЙ refresh_token из ответа.
 *
 * 401 здесь означает «сессия кончилась, войти заново».
 * 503 — «до сервера не достучались», сессию НЕ сбрасывать.
 */
export const POST = withErrorBoundary(async (request: Request) => {
  const parsed = await parseJsonBody(request, RefreshRequestSchema)
  if ('response' in parsed) return parsed.response
  const { refresh_token } = parsed.data

  const limited = enforceRateLimits([
    [REFRESH_PER_TOKEN, refresh_token],
    [REFRESH_PER_IP, clientIp(request)],
  ])
  if (limited) return limited

  const { data, error } = await createAnonClient().auth.refreshSession({ refresh_token })

  if (error) {
    return mapAuthError(error, () => apiError('unauthenticated', 'refresh token rejected'))
  }
  if (!data.session) return apiError('unauthenticated', 'refresh token rejected')

  return apiJson(toTokenResponse(data.session))
})
