import type { Schedule } from './schedule'
import { daysBetweenCalendarDates } from './schedule'

/**
 * «Когда следующий приём?» — для карточки препарата. Особенно нужно
 * интервальным расписаниям («каждые 2 дня»): без этого юзер считает в уме,
 * какой день на цикле (фидбек беты, 2026-07-19).
 *
 * Считаем в ЛОКАЛЬНОМ времени устройства, без profiles.timezone:
 * времена расписания — wall-clock строки («23:00 по моим часам»), а tz
 * профиля на устройстве юзера совпадает с локальной (её и пишет
 * TimezoneSync с этого же устройства). Для ОТОБРАЖЕНИЯ этого достаточно;
 * генерация слотов на сервере — по-прежнему в profiles.timezone.
 * Только клиент ('use client' вызывающие) — на сервере локальная tz чужая.
 */

// Дальше этого не ищем (интервалы ≤180 дней, страховка от вечного цикла).
const MAX_LOOKAHEAD_DAYS = 400

/**
 * Ближайший будущий приём строго после `now`, с учётом границ жизни
 * препарата (start_date/end_date). null — приёмов больше не будет
 * (end_date прошёл) или не нашли в разумном горизонте.
 */
export function nextIntakeLocal(
  schedule: Schedule,
  bounds: { startDate: string; endDate: string | null },
  now: Date = new Date(),
): Date | null {
  for (let i = 0; i <= MAX_LOOKAHEAD_DAYS; i++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i)
    const ymd = toLocalYmd(day)
    // ISO-строки сравниваются лексикографически корректно.
    if (ymd < bounds.startDate) continue
    if (bounds.endDate && ymd > bounds.endDate) return null

    for (const time of slotTimesForYmd(schedule, ymd)) {
      const [h, m] = time.split(':').map(Number)
      const slot = new Date(
        day.getFullYear(),
        day.getMonth(),
        day.getDate(),
        h,
        m,
      )
      if (slot.getTime() > now.getTime()) return slot
    }
  }
  return null
}

/** YYYY-MM-DD локального календарного дня (не UTC — toISOString не годится). */
function toLocalYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Времена приёмов (HH:mm) в конкретный локальный календарный день. */
function slotTimesForYmd(schedule: Schedule, ymd: string): string[] {
  if (schedule.kind === 'daily') return [...schedule.times].sort()
  const diff = daysBetweenCalendarDates(schedule.anchor_date, ymd)
  if (diff < 0 || diff % schedule.every_days !== 0) return []
  return [schedule.time]
}

const weekdayFmt = new Intl.DateTimeFormat('ru-RU', { weekday: 'short' })
const dayMonthFmt = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
})

/**
 * «сегодня, 23:00» / «завтра, 09:00» / «чт, 23:00» (ближайшая неделя) /
 * «31 июля, 23:00» (дальше). Слова «сегодня»/«завтра» приходят от вызывающего
 * (из словаря переводов) — здесь только календарная логика.
 */
export function formatNextIntake(
  slot: Date,
  labels: { today: string; tomorrow: string },
  now: Date = new Date(),
): string {
  const time = `${String(slot.getHours()).padStart(2, '0')}:${String(slot.getMinutes()).padStart(2, '0')}`
  const startOfNow = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfSlot = new Date(slot.getFullYear(), slot.getMonth(), slot.getDate())
  // Разница в локальных календарных днях. DST-сдвиг (23/25-часовые сутки)
  // гасим округлением — на границе недели он двигает результат максимум
  // между «чт» и датой, это не критично.
  const dayDiff = Math.round(
    (startOfSlot.getTime() - startOfNow.getTime()) / 86_400_000,
  )

  if (dayDiff === 0) return `${labels.today}, ${time}`
  if (dayDiff === 1) return `${labels.tomorrow}, ${time}`
  if (dayDiff < 7) return `${weekdayFmt.format(slot)}, ${time}`
  return `${dayMonthFmt.format(slot)}, ${time}`
}
