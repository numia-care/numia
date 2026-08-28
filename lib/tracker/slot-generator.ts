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
 * Считается от ТЕКУЩЕГО момента и форматируется сразу в зоне юзера — тот же
 * приём, что в getTodayRange (lib/tracker/today.ts). Брать вместо этого
 * startOfDay(new Date()) нельзя: он даёт полночь в таймзоне РАНТАЙМА (на
 * Vercel это UTC), и в часы, когда локальная дата юзера уже разошлась с
 * UTC-датой, граница уезжает на сутки — защищает не тот день.
 *
 * Окно сверки в generateSlotsForActiveMeds считается отсюда же по этой самой
 * причине (дефект C таймзонного бага дублей).
 */
export function startOfUserDayUtc(timezone: string, now: Date = new Date()): Date {
  const ymd = formatInTimeZone(now, timezone, 'yyyy-MM-dd')
  return fromZonedTime(`${ymd}T00:00:00`, timezone)
}

/**
 * Момент ВНУТРИ i-го календарного дня юзера, считая от его локальной полуночи.
 * Нужен только чтобы получить календарную ДАТУ этого дня — время внутри
 * произвольное, важно лишь не выпасть за границы суток.
 *
 * Почему не addDays(base, i): addDays прибавляет ровно 24 часа, а в сутки
 * перехода на зимнее/летнее время их 25 или 23. От локальной полуночи «+24ч»
 * в 25-часовые сутки не дотягивает до следующей даты — день повторяется, а
 * следующий пропадает (проверено на Europe/Madrid 25.10.2026). Пока базой
 * была полночь UTC, это не всплывало: в UTC переходов нет.
 *
 * Приём тот же, что в getTodayRange (lib/tracker/today.ts:30-35): прыгнуть с
 * запасом и взять локальную дату точки приземления. Там для одного дня это
 * +36ч, здесь то же самое обобщено — i*24 + 12. Запас в 12 часов покрывает
 * сдвиг ±1ч с большим зазором, а до соседних суток (≥23ч) не достаёт.
 */
function dayInUserTz(startOfDayUtc: Date, i: number): Date {
  return new Date(startOfDayUtc.getTime() + (i * 24 + 12) * 60 * 60 * 1000)
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

  // Локальная полночь ЮЗЕРА, не сервера. Здесь был startOfDay(new Date()) —
  // полночь в зоне рантайма, а на Vercel это UTC. Для юзера восточнее UTC в
  // ранние часы его дня (Москва, UTC+3 → 00:00–03:00) UTC-дата ещё вчерашняя,
  // и всё окно ниже съезжало на сутки назад: сверка пересобирала вчера, пока
  // экран показывал сегодня. Дубли сегодняшнего дня она в таком окне просто
  // не видела. Ровно то, о чём предупреждает комментарий к startOfUserDayUtc.
  const today = startOfUserDayUtc(timezone)
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
      // Момент внутри i-го дня юзера. И dayYmd ниже, и computeSlotsForDay
      // берут отсюда только календарную дату в его зоне, так что «полдень
      // этого дня» подходит ровно так же, как полночь, но переживает DST.
      const day = dayInUserTz(today, i)
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
    `${formatInTimeZone(dayInUserTz(today, days), timezone, 'yyyy-MM-dd')}T00:00:00`,
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
