import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

import { createClient } from '@/lib/supabase/server'

import type { IntakeEventRow, MedicationRow } from './queries'
import { parseSchedule } from './schedule'

/**
 * Утилиты для "Сегодня" — рассчёт UTC-границ сегодняшнего дня в tz юзера
 * и чтение событий в этом диапазоне.
 */

/**
 * Границы сегодняшнего дня в tz юзера → UTC.
 * Пример: tz='Europe/Madrid', сейчас 28.05 23:30 UTC → в Мадриде 01:30 29.05
 *   start = 28.05 22:00 UTC (= 29.05 00:00 Madrid)
 *   end   = 29.05 22:00 UTC (= 30.05 00:00 Madrid)
 *
 * Используется для запроса intake_events.scheduled_at в [start, end).
 */
export function getTodayRange(timezone: string): { start: Date; end: Date } {
  const ymd = formatInTimeZone(new Date(), timezone, 'yyyy-MM-dd')
  const start = fromZonedTime(`${ymd}T00:00:00`, timezone)
  // Конец дня = начало следующего, чтобы избежать DST-сюрпризов.
  const startNext = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  // Но в DST-переходе сутки бывают 23 или 25 часов. Безопаснее через YMD+1.
  const tomorrow = new Date(start.getTime() + 36 * 60 * 60 * 1000) // +36ч точно следующий день
  const tomorrowYmd = formatInTimeZone(tomorrow, timezone, 'yyyy-MM-dd')
  const end = fromZonedTime(`${tomorrowYmd}T00:00:00`, timezone)
  // startNext — резервная оценка, end — точная (учитывает DST)
  void startNext
  return { start, end }
}

/**
 * Событие + название препарата + dose/form/unit — то, что нужно карточке слота.
 * intake_events ссылается на medication_id, мы джойним через select.
 */
export interface TodaySlot extends IntakeEventRow {
  medication: Pick<
    MedicationRow,
    'name' | 'kind' | 'form' | 'dose_amount' | 'dose_unit'
  > | null // null если препарат hard-deleted (orphan)
}

/**
 * Слоты на сегодня в tz юзера, отсортированные по scheduled_at ASC.
 */
export async function getTodaySlots(timezone: string): Promise<TodaySlot[]> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const { start, end } = getTodayRange(timezone)

  // Supabase select с join через FK: medication:medications(...)
  const { data, error } = await supabase
    .from('intake_events')
    .select(
      `
      id, user_id, medication_id, scheduled_at, taken_at, status,
      dose_actual, notes, created_at,
      medication:medications(name, kind, form, dose_amount, dose_unit)
    `,
    )
    .eq('user_id', user.id)
    .gte('scheduled_at', start.toISOString())
    .lt('scheduled_at', end.toISOString())
    .order('scheduled_at', { ascending: true })

  if (error || !data) return []

  // Supabase возвращает join как объект (single) — здесь то же. Тип
  // приводим вручную потому что без сгенерённых Database-типов.
  return data.map((row) => ({
    ...row,
    medication: (row.medication as unknown as TodaySlot['medication']) ?? null,
  })) as TodaySlot[]
}

/**
 * Стрингифицировать scheduled_at как HH:mm в tz юзера для отображения.
 */
export function formatSlotTime(scheduledAtIso: string, timezone: string): string {
  return formatInTimeZone(new Date(scheduledAtIso), timezone, 'HH:mm')
}

// Намеренно используем parseSchedule отсюда чтобы зависимость интейка от
// schedule.ts была видна — при изменении JSON-формата schedule сюда
// прилетит TS-ошибка.
void parseSchedule
