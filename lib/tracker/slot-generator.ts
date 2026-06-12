import { addDays, startOfDay } from 'date-fns'
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
    const startDate = new Date(med.start_date as string)

    for (let i = 0; i < days; i += 1) {
      const day = addDays(today, i)
      if (day < startDate) continue
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
