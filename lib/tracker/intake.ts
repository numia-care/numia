'use server'

import { revalidatePath } from 'next/cache'
import { addDays, startOfDay } from 'date-fns'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { getUserTimezone } from '@/lib/timezone-actions'

import { computeSlotsForDay, parseSchedule } from './schedule'

/**
 * Server actions для intake_events.
 *
 * Жизненный цикл слота:
 *   upcoming → taken | skipped (юзер тапнул)
 *   upcoming → missed (фон, когда время прошло без действий — добавим позже)
 *   any → upcoming (undo)
 *   any → taken (backfill «приняла вчера в 21:00»)
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
 * Генерирует слоты на ближайшие N дней для одного препарата.
 * Идемпотентна: повторный вызов на тот же день не создаст дублей (unique
 * index на (medication_id, scheduled_at), upsert с ignoreDuplicates).
 *
 * Слоты создаются ОТ СЕГОДНЯ ВКЛЮЧИТЕЛЬНО. Если start_date препарата в
 * будущем — пропускаем дни до start_date. Если end_date в прошлом —
 * не создаём ничего (препарат остановлен).
 */
export async function generateUpcomingSlots(
  medicationId: string,
  days: number,
): Promise<ActionResult<{ created: number }>> {
  if (!ID_SCHEMA.safeParse(medicationId).success) {
    return { ok: false, error: 'invalid_id' }
  }
  if (!Number.isInteger(days) || days < 1 || days > 30) {
    return { ok: false, error: 'invalid_days' }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const { data: med, error: medError } = await supabase
    .from('medications')
    .select('id, user_id, schedule, start_date, end_date, deleted_at')
    .eq('id', medicationId)
    .maybeSingle()

  if (medError || !med) return { ok: false, error: 'medication_not_found' }
  if (med.deleted_at) return { ok: true, data: { created: 0 } }
  if (med.end_date) return { ok: true, data: { created: 0 } }

  const schedule = parseSchedule(med.schedule)
  const tz = await getUserTimezone()

  // Считаем слоты для каждого из ближайших N дней.
  const today = startOfDay(new Date())
  const startDate = new Date(med.start_date) // calendar date, parsed as local midnight

  const slots: { medication_id: string; user_id: string; scheduled_at: string; status: 'upcoming' }[] = []
  for (let i = 0; i < days; i += 1) {
    const day = addDays(today, i)
    // Не генерим слоты до start_date препарата
    if (day < startDate) continue
    const dayUtcSlots = computeSlotsForDay(schedule, day, tz)
    for (const utc of dayUtcSlots) {
      slots.push({
        medication_id: medicationId,
        user_id: user.id,
        scheduled_at: utc.toISOString(),
        status: 'upcoming',
      })
    }
  }

  if (slots.length === 0) return { ok: true, data: { created: 0 } }

  // upsert с ignoreDuplicates пропускает уже существующие (medication_id, scheduled_at)
  // — это то, что делает функцию идемпотентной.
  const { data: inserted, error } = await supabase
    .from('intake_events')
    .upsert(slots, {
      onConflict: 'medication_id,scheduled_at',
      ignoreDuplicates: true,
    })
    .select('id')

  if (error) return { ok: false, error: error.message }

  revalidatePath('/tracker')
  return { ok: true, data: { created: inserted?.length ?? 0 } }
}

/**
 * Отметить слот принятым. taken_at = now() — пишем фактическое время.
 * Для backfill (приняла в прошлом) — используй backfillTaken.
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
 * Backfill — «приняла вчера в 21:00». taken_at — конкретный момент,
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
