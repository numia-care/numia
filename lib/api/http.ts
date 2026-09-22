import { NextResponse } from 'next/server'
import type { z } from 'zod'

import type { ApiErrorCode } from './schemas'

/**
 * Единый конверт ответов BFF. Контракт: docs/api-v1.md, §4.
 *
 * Формат ошибки фиксирован и версионирован вместе с API:
 *   { "error": { "code": "...", "message": "...", "field": "..." } }
 *
 * code — стабильная строка, клиент ветвится по ней.
 * message — для логов и отладки. Пользователю НЕ показывать: тексты
 *   интерфейса локализуются на устройстве, а не приходят с сервера.
 *
 * Сами коды объявлены в lib/api/schemas.ts — оттуда же они попадают в
 * OpenAPI. Record ниже не даст добавить код без HTTP-статуса.
 */

export type { ApiErrorCode }

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  invalid_input: 400,
  invalid_code: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  unprocessable: 422,
  rate_limited: 429,
  internal: 500,
  service_unavailable: 503,
}

export function apiError(
  code: ApiErrorCode,
  message?: string,
  field?: string,
): NextResponse {
  return NextResponse.json(
    { error: { code, ...(message ? { message } : {}), ...(field ? { field } : {}) } },
    { status: STATUS_BY_CODE[code] },
  )
}

/** 429 с заголовком Retry-After — клиент знает, сколько ждать. */
export function apiRateLimited(retryAfterSec: number): NextResponse {
  const res = apiError('rate_limited', 'too many requests')
  res.headers.set('Retry-After', String(retryAfterSec))
  return res
}

export function apiJson<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status })
}

export function apiNoContent(): NextResponse {
  return new NextResponse(null, { status: 204 })
}

/**
 * Сбой запроса к базе (PostgREST). Никогда не превращается в 404: «не смогли
 * прочитать» и «записи нет» для клиента означают разное, а для якоря
 * восстановления ложное «нет» приводит к генерации нового DEK и потере данных.
 *
 * status 0 — supabase-js не достучался (он не бросает, а возвращает status 0),
 * 502–504 — шлюз перед базой. Это 503: клиент повторит позже. Остальное — 500.
 *
 * В лог — только код Postgres и HTTP-статус: текст ошибки и details умеют
 * содержать значения полей, а это данные юзера.
 */
export function apiDbFailure(
  context: string,
  result: { status: number; error: { code?: string } | null },
): NextResponse {
  console.error(`${context} failed: status=${result.status} code=${result.error?.code || '-'}`)
  const unreachable = result.status === 0 || (result.status >= 502 && result.status <= 504)
  return unreachable
    ? apiError('service_unavailable', 'database unreachable')
    : apiError('internal')
}

/**
 * Списки отдаём конвертом, а не голым массивом: так можно добавить
 * пагинацию, не ломая v1 (правило 1 из docs/api-v1.md).
 */
export function apiList<T>(items: T[], nextCursor: string | null = null): NextResponse {
  return NextResponse.json({ items, next_cursor: nextCursor })
}

/**
 * Прочитать JSON-тело и провалидировать схемой. Одна реализация на все
 * маршруты: невалидный JSON и ошибка схемы превращаются в одинаковые 400.
 *
 * Возвращает либо { data }, либо готовый ответ-ошибку — маршрут просто
 * отдаёт его наружу.
 */
export async function parseJsonBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<{ data: z.infer<S> } | { response: NextResponse }> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return { response: apiError('invalid_input', 'body is not valid json') }
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { response: apiError('invalid_input', first?.message, first?.path.join('.')) }
  }
  return { data: parsed.data }
}

/**
 * Страховка для маршрутов без withAuth: любое необработанное исключение
 * (включая ненастроенное окружение) превращается в 500 с кодом, а детали
 * уходят в лог контейнера, не клиенту.
 */
export function withErrorBoundary<A extends unknown[]>(
  handler: (...args: A) => Promise<Response>,
) {
  return async (...args: A): Promise<Response> => {
    try {
      return await handler(...args)
    } catch (e) {
      console.error('bff handler error:', e instanceof Error ? e.message : e)
      return apiError('internal')
    }
  }
}
