import { addDays, startOfDay } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import type { SupabaseClient } from '@supabase/supabase-js'

import { computeSlotsForDay, parseSchedule } from './schedule'

/**
 * Чистая (без 'use server') функция генерации слотов.
 *
 * Зачем отдельный файл: server action из intake.ts можно дёрнуть с
 * клиента, но дёргать его из Server Component — антипаттерн (лишняя
 * сериализация). Здесь — обычный async helper, который и action,
 * и серверный код могут вызвать напрямую.
 */
export async function generateSlotsForActiveMeds(
  supabase: SupabaseClient,
  userId: string,
  timezone: string,
  days: number,
): Promise<number> {
  const { data: meds } = await supabase
    .from('medications')
    .select('id, schedule, start_date, end_date, deleted_at')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .is('end_date', null)

  if (!meds || meds.length === 0) return 0

  const today = startOfDay(new Date())
  const slots: {
    medication_id: string
    user_id: string
    scheduled_at: string
    status: 'upcoming'
  }[] = []

  for (const med of meds) {
    const schedule = parseSchedule(med.schedule)

    for (let i = 0; i < days; i += 1) {
      const day = addDays(today, i)
      // Сравниваем КАЛЕНДАРНУЮ дату дня в tz юзера со start_date (строкой
      // YYYY-MM-DD) — лексикографическое сравнение строк = хронологическое.
      // Раньше тут было `new Date(day) < new Date(med.start_date)`: первое —
      // локальная полночь сервера, второе — UTC-полночь, и на сервере в UTC+N
      // препарат со start_date=сегодня терял сегодняшний слот (день уходил
      // в «ещё не начался»). Та же логика, что в edge-функции generate-upcoming.
      const dayYmd = formatInTimeZone(day, timezone, 'yyyy-MM-dd')
      if (dayYmd < (med.start_date as string)) continue
      const dayUtcSlots = computeSlotsForDay(schedule, day, timezone)
      for (const utc of dayUtcSlots) {
        slots.push({
          medication_id: med.id as string,
          user_id: userId,
          scheduled_at: utc.toISOString(),
          status: 'upcoming',
        })
      }
    }
  }

  if (slots.length === 0) return 0

  // ignoreDuplicates: идемпотентность через unique-индекс
  // (medication_id, scheduled_at). Повторный вызов не плодит ряды.
  const { data: inserted } = await supabase
    .from('intake_events')
    .upsert(slots, {
      onConflict: 'medication_id,scheduled_at',
      ignoreDuplicates: true,
    })
    .select('id')

  return inserted?.length ?? 0
}
