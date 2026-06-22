'use server'

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
