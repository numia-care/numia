import { addDays, startOfDay } from 'date-fns'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import type { SupabaseClient } from '@supabase/supabase-js'

import { computeSlotsForDay, parseSchedule } from './schedule'

// Сколько дней вперёд генерим слоты при создании/редактировании препарата
// и при смене таймзоны. 3 календарных дня гарантируют покрытие ≥48ч
// независимо от tz юзера. То же значение у суточного cron generate-upcoming.
export const SLOT_GEN_DAYS = 3

/**
 * Начало сегодняшнего дня юзера (его локальная полночь) в UTC.
 *
 * Нижняя граница для всех удалений upcoming-слотов: сегодняшние слоты
 * пересобирать можно, вчерашние и старше — это уже история, даже если юзер
 * их не отметил. Раньше границы не было вообще, и один флип таймзоны или
 * правка расписания сметали неотмеченное прошлое насовсем.
 *
 * Считается от ТЕКУЩЕГО момента, а не от startOfDay(new Date()) как в окне
 * сверки ниже. Разница принципиальная: startOfDay даёт полночь в таймзоне
 * СЕРВЕРА (на Vercel это UTC), и для юзера западнее UTC формат в его зоне
 * отдаёт вчерашнюю дату — граница уехала бы на сутки назад и перестала
 * защищать ровно то, ради чего она нужна. Здесь берём now(), форматируем
 * сразу в зоне юзера — тот же приём, что в getTodayRange (lib/tracker/today.ts).
 */
export function startOfUserDayUtc(timezone: string, now: Date = new Date()): Date {
  const ymd = formatInTimeZone(now, timezone, 'yyyy-MM-dd')
  return fromZonedTime(`${ymd}T00:00:00`, timezone)
}

/**
 * Чистая (без 'use server') функция генерации слотов.
 *
 * Зачем отдельный файл: server action из intake.ts можно дёрнуть с
 * клиента, но дёргать его из Server Component — антипаттерн (лишняя
 * сериализация). Здесь — обычный async helper, который и action,
 * и серверный код могут вызвать напрямую.
 *
 * Генерация СВЕРЯЮЩАЯ (reconcile), не только доливающая: внутри окна
 * генерации upcoming-слоты, не совпадающие с текущим расписанием+tz,
 * удаляются. Иначе сирота живёт вечно: unique-индекс (medication_id,
 * scheduled_at) не склеивает один и тот же wall-clock, посчитанный в
 * разных tz (баг 22:00/23:00 — profiles.timezone
 * флипался между таймзонами разных устройств, каждый флип рождал пару).
 * История (taken/skipped/missed) не трогается никогда.
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

  const today = startOfDay(new Date())
  const slots: {
    medication_id: string
    user_id: string
    scheduled_at: string
    status: 'upcoming'
  }[] = []

  // Даже без активных препаратов идём дальше: сверка ниже подчистит
  // осиротевшие upcoming (например, слоты hard-deleted препарата).
  for (const med of meds ?? []) {
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

  // --- Сверка: снести upcoming-слоты окна, которых нет в ожидаемом наборе ---
  // Границы окна в UTC — те же календарные дни в tz юзера, по которым шёл
  // цикл выше: [сегодня 00:00 tz, сегодня+days 00:00 tz).
  const windowStart = fromZonedTime(
    `${formatInTimeZone(today, timezone, 'yyyy-MM-dd')}T00:00:00`,
    timezone,
  )
  const windowEnd = fromZonedTime(
    `${formatInTimeZone(addDays(today, days), timezone, 'yyyy-MM-dd')}T00:00:00`,
    timezone,
  )

  const expected = new Set(slots.map((s) => `${s.medication_id}|${s.scheduled_at}`))
  const { data: existing } = await supabase
    .from('intake_events')
    .select('id, medication_id, scheduled_at')
    .eq('user_id', userId)
    .eq('status', 'upcoming')
    .gte('scheduled_at', windowStart.toISOString())
    .lt('scheduled_at', windowEnd.toISOString())

  // PostgREST отдаёт timestamptz в своём формате — нормализуем через Date,
  // чтобы строковое сравнение с нашим toISOString() было честным.
  const staleIds = (existing ?? [])
    .filter(
      (e) =>
        !expected.has(
          `${e.medication_id}|${new Date(e.scheduled_at as string).toISOString()}`,
        ),
    )
    .map((e) => e.id as string)

  if (staleIds.length > 0) {
    await supabase.from('intake_events').delete().in('id', staleIds)
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
