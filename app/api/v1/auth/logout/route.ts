import { bearerToken, isAuthServiceUnreachable } from '@/lib/api/auth'
import { apiError, apiNoContent, withErrorBoundary } from '@/lib/api/http'
import { createAnonClient } from '@/lib/supabase/bff'

/**
 * POST /api/v1/auth/logout — выйти на этом устройстве.
 *
 * Отзывает refresh-токен текущей сессии (scope 'local'): другие устройства
 * пользователя остаются залогиненными. Access-токен при этом доживает до
 * своего срока — это свойство JWT, отозвать его мгновенно нельзя. Поэтому
 * клиент удаляет оба токена у себя сразу, не дожидаясь ответа.
 *
 * Идемпотентно: уже недействительный токен — тоже 204. Выход, который
 * может «не получиться», только сбивает с толку.
 *
 * admin.signOut несмотря на имя не требует сервисного ключа: он шлёт токен
 * самого пользователя на /logout (проверено по исходнику auth-js).
 */
export const POST = withErrorBoundary(async (request: Request) => {
  const token = bearerToken(request)
  if (!token) return apiError('unauthenticated', 'missing bearer token')

  const { error } = await createAnonClient().auth.admin.signOut(token, 'local')

  if (error && isAuthServiceUnreachable(error)) {
    console.error('auth service unreachable:', error.message)
    return apiError('service_unavailable', 'auth service unreachable')
  }
  return apiNoContent()
})
