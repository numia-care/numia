import { createHash } from 'node:crypto'

import { apiRateLimited } from './http'

/**
 * Ограничение частоты запросов в памяти процесса.
 *
 * Зачем свой лимит, если у Supabase он есть. Supabase считает попытки входа
 * по IP. Когда вход идёт через BFF, все запросы приходят к Supabase с ОДНОГО
 * адреса — адреса BFF. Итог без своего лимита: десяток людей входят
 * одновременно и упираются в общий потолок, а тот, кто перебирает коды,
 * неотличим от обычных пользователей. Поэтому считаем сами — по email и по
 * IP клиента.
 *
 * Алгоритм — фиксированное окно: счётчик на ключ, сбрасывается по истечении
 * окна. Проще скользящего окна и для защиты входа достаточно.
 *
 * Ограничения, которые надо помнить:
 *   - Живёт в памяти ОДНОГО процесса. Два контейнера — два независимых
 *     счётчика. Для одного контейнера этого хватает; при масштабировании
 *     переносить в Redis или в Postgres.
 *   - Перезапуск контейнера обнуляет счётчики.
 *
 * Приватность: ключи хэшируются (SHA-256), в памяти не лежат ни email, ни
 * IP в открытом виде. В логи ничего из этого не пишется — правило проекта
 * «не храним IP» соблюдается.
 */

export interface RateLimitRule {
  /** Имя правила — часть ключа, чтобы разные правила не делили счётчик. */
  name: string
  limit: number
  windowMs: number
}

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()
let lastSweepAt = 0

// Раз в минуту выметаем истёкшие окна, чтобы Map не рос бесконечно.
function sweep(now: number) {
  if (now - lastSweepAt < 60_000) return
  lastSweepAt = now
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}

function hashSubject(subject: string): string {
  return createHash('sha256').update(subject).digest('hex')
}

/** Засчитать попытку. null — можно; число — сколько секунд ждать. */
function consume(rule: RateLimitRule, subject: string, now: number): number | null {
  const key = `${rule.name}:${hashSubject(subject)}`
  const bucket = buckets.get(key)

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + rule.windowMs })
    return null
  }
  bucket.count += 1
  if (bucket.count > rule.limit) {
    return Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
  }
  return null
}

/**
 * Проверить набор правил сразу. Субъект null — правило пропускается
 * (например, IP неизвестен). Возвращает готовый 429 или null.
 */
export function enforceRateLimits(
  checks: ReadonlyArray<readonly [RateLimitRule, string | null]>,
): ReturnType<typeof apiRateLimited> | null {
  const now = Date.now()
  sweep(now)

  let retryAfter = 0
  for (const [rule, subject] of checks) {
    if (subject === null) continue
    const wait = consume(rule, subject, now)
    if (wait !== null) retryAfter = Math.max(retryAfter, wait)
  }
  return retryAfter > 0 ? apiRateLimited(retryAfter) : null
}

/**
 * IP клиента из заголовков прокси.
 *
 * ВАЖНО: без reverse proxy перед BFF заголовок X-Forwarded-For подделывается
 * клиентом, и лимит по IP обходится. Лимит по email при этом держит — он и
 * есть основная защита от перебора кода. В проде reverse proxy (Caddy, nginx)
 * обязан ПЕРЕЗАПИСЫВАТЬ этот заголовок, а не дописывать к нему.
 */
export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]?.trim() || null
  return request.headers.get('x-real-ip')
}
