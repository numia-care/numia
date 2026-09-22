import { mapAuthError } from '@/lib/api/auth'
import { VERIFY_PER_EMAIL, VERIFY_PER_IP, toTokenResponse } from '@/lib/api/auth-flow'
import { apiError, apiJson, parseJsonBody, withErrorBoundary } from '@/lib/api/http'
import { clientIp, enforceRateLimits } from '@/lib/api/rate-limit'
import { VerifyRequestSchema } from '@/lib/api/schemas'
import { createAnonClient } from '@/lib/supabase/bff'

/**
 * POST /api/v1/auth/verify — обменять код из письма на токены.
 *
 * Код проверяется без PKCE, поэтому BFF не хранит ничего между запросами
 * «отправить код» и «проверить код». Любой экземпляр BFF может обработать
 * любой из них.
 */
export const POST = withErrorBoundary(async (request: Request) => {
  const parsed = await parseJsonBody(request, VerifyRequestSchema)
  if ('response' in parsed) return parsed.response
  const { email, code } = parsed.data

  const limited = enforceRateLimits([
    [VERIFY_PER_EMAIL, email],
    [VERIFY_PER_IP, clientIp(request)],
  ])
  if (limited) return limited

  const { data, error } = await createAnonClient().auth.verifyOtp({
    email,
    token: code,
    type: 'email',
  })

  // Неверный и просроченный код не различаем: разница ничего не даёт
  // пользователю, а атакующему подсказывает.
  if (error) {
    return mapAuthError(error, () => apiError('invalid_code', 'invalid or expired code'))
  }
  if (!data.session) return apiError('invalid_code', 'invalid or expired code')

  return apiJson(toTokenResponse(data.session))
})
