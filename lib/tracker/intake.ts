'use server'

import { formatInTimeZone } from 'date-fns-tz'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'

/**
 * Server actions для intake_events.
 *
 * Жизненный цикл слота:
 *   upcoming → taken | skipped (юзер тапнул)
 *   upcoming → missed (фон, когда время прошло без действий — добавим позже)
 *   any → upcoming (undo)
 *   any → taken (backfill «приём был вчера в 21:00»)
 *
 * Все мутации проходят через RLS (user_id = auth.uid()), так что попытка
 * apдейта чужого ряда тихо ничего не сделает. Дополнительные проверки
 * user_id в коде не нужны — это правильно (вся защита в БД).
 */

const ID_SCHEMA = z.string().uuid()

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string }

/**
 * Отметить слот принятым. taken_at = now() — пишем фактическое время.
 * Для backfill (приём был в прошлом) — используй backfillTaken.
 */
export async function markTaken(eventId: string): Promise<ActionResult> {
  if (!ID_SCHEMA.safeParse(eventId).success) {
    return { ok: false, error: 'invalid_id' }
  }
  const supabase = await createClient()
  const { error } = await supabase
    .from('intake_events')
    .update({ status: 'taken', taken_at: new Date().toISOString() })
    .eq('id', eventId)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/tracker')
  return { ok: true, data: undefined }
}

export async function markSkipped(eventId: string): Promise<ActionResult> {
  if (!ID_SCHEMA.safeParse(eventId).success) {
    return { ok: false, error: 'invalid_id' }
  }
  const supabase = await createClient()
  const { error } = await supabase
    .from('intake_events')
    .update({ status: 'skipped', taken_at: null })
    .eq('id', eventId)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/tracker')
  return { ok: true, data: undefined }
}

/**
 * Снять отметку с прошлого слота — «нет, не принято».
 *
 * Не то же самое, что undoIntake. Тот всегда возвращает в 'upcoming', и для
 * прошлого дня это состояние нежизнеспособно: развёртка mark_missed_intakes
 * в ближайшие 15 минут пометит слот 'missed', и юзер увидит, как отметка
 * «сама поменялась». Поэтому целевой статус зависит от того, кончился ли
 * день слота в таймзоне юзера:
 *
 *   день уже прошёл  → 'missed'   (то же, что поставила бы развёртка)
 *   день ещё идёт    → 'upcoming' (сегодня приём ещё можно отметить)
 *
 * Правило намеренно совпадает с SQL-развёрткой, чтобы UI не показывал
 * состояние, которое cron через четверть часа перепишет.
 */
export async function unmarkIntake(eventId: string): Promise<ActionResult> {
  if (!ID_SCHEMA.safeParse(eventId).success) {
    return { ok: false, error: 'invalid_id' }
  }
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  // RLS отдаст ряд только если он свой — отдельной проверки user_id не нужно.
  const { data: slot } = await supabase
    .from('intake_events')
    .select('scheduled_at')
    .eq('id', eventId)
    .maybeSingle()
  if (!slot) return { ok: false, error: 'not_found' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('timezone')
    .eq('id', user.id)
    .maybeSingle()
  const timezone = profile?.timezone ?? 'UTC'

  // Сравнение календарных дат в зоне юзера — строки YYYY-MM-DD сравниваются
  // лексикографически, что здесь то же самое, что хронологически.
  const slotDay = formatInTimeZone(
    new Date(slot.scheduled_at as string),
    timezone,
    'yyyy-MM-dd',
  )
  const today = formatInTimeZone(new Date(), timezone, 'yyyy-MM-dd')
  const nextStatus = slotDay < today ? 'missed' : 'upcoming'

  const { error } = await supabase
    .from('intake_events')
    .update({ status: nextStatus, taken_at: null })
    .eq('id', eventId)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/tracker')
  return { ok: true, data: undefined }
}

/**
 * Возврат слота в upcoming. Используется как «undo» после случайного
 * Принято/Пропустить (через Sonner toast action).
 */
export async function undoIntake(eventId: string): Promise<ActionResult> {
  if (!ID_SCHEMA.safeParse(eventId).success) {
    return { ok: false, error: 'invalid_id' }
  }
  const supabase = await createClient()
  const { error } = await supabase
    .from('intake_events')
    .update({ status: 'upcoming', taken_at: null })
    .eq('id', eventId)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/tracker')
  return { ok: true, data: undefined }
}

/**
 * Backfill — «приём был вчера в 21:00». taken_at — конкретный момент,
 * не now(). Используется для прошлых слотов через диалог.
 *
 * @param takenAtIso — ISO timestamp в UTC.
 */
export async function backfillTaken(
  eventId: string,
  takenAtIso: string,
): Promise<ActionResult> {
  if (!ID_SCHEMA.safeParse(eventId).success) {
    return { ok: false, error: 'invalid_id' }
  }
  // Валидация ISO-строки: должна парситься и быть в прошлом
  // (не разрешаем backfill в будущее — это уже не backfill).
  const d = new Date(takenAtIso)
  if (isNaN(d.getTime())) {
    return { ok: false, error: 'invalid_taken_at' }
  }
  if (d.getTime() > Date.now() + 60_000) {
    // Запас 60 сек на клок-дрифт между клиентом и сервером.
    return { ok: false, error: 'taken_at_in_future' }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('intake_events')
    .update({ status: 'taken', taken_at: d.toISOString() })
    .eq('id', eventId)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/tracker')
  return { ok: true, data: undefined }
}
