import type { NextRequest } from 'next/server'
import type { AuthError, SupabaseClient, User } from '@supabase/supabase-js'

import { createBearerClient } from '@/lib/supabase/bff'
import { apiError, apiRateLimited } from './http'

/**
 * Аутентификация маршрутов BFF по Bearer-токену.
 *
 * Паттерн — декоратор (обёртка над обработчиком). Смысл: невозможно забыть
 * проверку. Если бы каждый route.ts звал authenticate() сам, рано или поздно
 * появился бы маршрут, где вызов забыли, и он ушёл бы в прод открытым.
 * Обёртка делает защиту обязательной по конструкции: без неё у обработчика
 * просто нет ctx, из которого он берёт клиента.
 */
export interface ApiContext {
  user: User
  /** Клиент, ходящий в Supabase от имени этого юзера — RLS работает. */
  supabase: SupabaseClient
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (!header) return null
  const [scheme, token] = header.split(' ')
  if (!token || scheme.toLowerCase() !== 'bearer') return null
  return token.trim() || null
}

/**
 * Supabase недоступен — сеть, DNS, лежит контейнер.
 *
 * Отличать это от «токен или код неверный» принципиально: на 401 клиент
 * выбрасывает сессию и гонит человека логиниться заново. Если на деле
 * просто не было сети — разлогинили на ровном месте. Для сервера, который
 * может лежать (домашняя инфраструктура), это обычный случай.
 *
 * supabase-js отдаёт здесь AuthRetryableFetchError со status 0 (проверено
 * на недоступном хосте). Класс наружу не экспортируется — смотрим на имя.
 */
export function isAuthServiceUnreachable(error: AuthError): boolean {
  return error.name === 'AuthRetryableFetchError' || error.status === 0
}

/**
 * Общий разбор ошибок Supabase Auth для всех маршрутов входа.
 * Недоступность → 503, лимит самого Supabase → 429, остальное решает маршрут.
 */
export function mapAuthError(
  error: AuthError,
  otherwise: () => Response,
): Response {
  if (isAuthServiceUnreachable(error)) {
    console.error('auth service unreachable:', error.message)
    return apiError('service_unavailable', 'auth service unreachable')
  }
  if (error.status === 429) {
    // Точного времени Supabase не сообщает — минута как безопасная оценка.
    return apiRateLimited(60)
  }
  return otherwise()
}

type RouteHandler<C> = (
  request: NextRequest,
  ctx: ApiContext,
  routeContext: C,
) => Promise<Response>

export function withAuth<C>(handler: RouteHandler<C>) {
  return async (request: NextRequest, routeContext: C): Promise<Response> => {
    const token = bearerToken(request)
    if (!token) return apiError('unauthenticated', 'missing bearer token')

    let supabase: SupabaseClient
    try {
      supabase = createBearerClient(token)
    } catch (e) {
      // Не настроено окружение контейнера — это наша ошибка, не клиента.
      console.error('bff env error:', e instanceof Error ? e.message : e)
      return apiError('internal')
    }

    // getUser(token) валидирует токен на стороне Supabase Auth — сетевой
    // вызов, +1 round-trip на запрос. Локальная проверка подписи быстрее, но
    // требует держать на сервере JWT-секрет проекта, а сервер на время
    // разработки стоит дома. Осознанный размен: платим задержкой, секрет
    // не храним. Кэш по токену — кандидат на потом.
    const { data, error } = await supabase.auth.getUser(token)
    if (error) {
      return mapAuthError(error, () => apiError('unauthenticated', 'token rejected'))
    }
    if (!data.user) return apiError('unauthenticated', 'token rejected')

    try {
      return await handler(request, { user: data.user, supabase }, routeContext)
    } catch (e) {
      // Наружу — только код. Детали в логи контейнера: сообщения ошибок
      // Postgres умеют содержать значения полей, а это данные юзера.
      console.error('bff handler error:', e instanceof Error ? e.message : e)
      return apiError('internal')
    }
  }
}
