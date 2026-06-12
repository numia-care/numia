import { z } from 'zod'
import { fromZonedTime, formatInTimeZone } from 'date-fns-tz'

/**
 * Расписание препарата — типы, валидация, расчёт слотов.
 *
 * Хранится как JSON в medications.schedule. На v1 поддерживаем два формата:
 *
 *   1. daily — «каждый день в 09:00» или «каждый день в 09:00 и 21:00»
 *      { kind: 'daily', times: ['09:00', '21:00'] }
 *
 *   2. interval — «каждые 5 дней в 10:00, начиная с такой-то даты»
 *      Типично для длительных инъекций (эстрадиол валерат раз в 5/7/14 дней).
 *      { kind: 'interval', every_days: 5, time: '10:00', anchor_date: '2026-05-19' }
 *
 * Времена везде — wall-clock в profiles.timezone юзера. Преобразование в
 * UTC happens только при генерации слотов (computeSlotsForDay), хранятся
 * времена строками — это переживает переезд юзера в другой часовой пояс
 * без сюрпризов («поменялась tz → таблетка сдвинулась» = по дизайну).
 *
 * Намеренно НЕ поддерживаем на v1:
 *   - конкретные дни недели («только пн/чт») — добавим если попросят
 *   - меняющиеся дозы (понедельник 2мг, среда 4мг) — это уже два препарата
 *   - окна приёма («между 8 и 10 утра») — слот должен быть конкретный
 */

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

export const DailyScheduleSchema = z.object({
  kind: z.literal('daily'),
  times: z
    .array(z.string().regex(TIME_REGEX, 'формат HH:mm'))
    .min(1, 'хотя бы одно время')
    .max(12, 'не больше 12 приёмов в сутки')
    // дубли поломают unique-индекс на intake_events при инсерте слотов
    .refine((arr) => new Set(arr).size === arr.length, {
      message: 'времена не должны повторяться',
    }),
})

export const IntervalScheduleSchema = z.object({
  kind: z.literal('interval'),
  // 1 = ежедневно (но это уже daily — UI пусть направляет правильно).
  // 180 дней верхняя граница — депо-инъекции редко реже полугода.
  every_days: z.number().int().min(1).max(180),
  time: z.string().regex(TIME_REGEX, 'формат HH:mm'),
  // anchor_date — точка отсчёта цикла. Все будущие слоты считаются как
  // anchor + N * every_days. UI ставит anchor_date = дата старта препарата.
  anchor_date: z.string().regex(DATE_REGEX, 'формат YYYY-MM-DD'),
})

export const ScheduleSchema = z.discriminatedUnion('kind', [
  DailyScheduleSchema,
  IntervalScheduleSchema,
])

export type DailySchedule = z.infer<typeof DailyScheduleSchema>
export type IntervalSchedule = z.infer<typeof IntervalScheduleSchema>
export type Schedule = z.infer<typeof ScheduleSchema>

/**
 * Парсинг непроверенного JSON (например, прочитанного из БД или присланного
 * с формы) в типизированную Schedule. Бросает ZodError при невалидном вводе.
 *
 * Используем при чтении medications.schedule из supabase — Postgres возвращает
 * jsonb как unknown, и без runtime-валидации TypeScript-типу доверять нельзя
 * (в БД мог попасть мусор от старой версии клиента).
 */
export function parseSchedule(input: unknown): Schedule {
  return ScheduleSchema.parse(input)
}

/**
 * Посчитать UTC-времена приёмов на конкретный календарный день в tz юзера.
 *
 * @param schedule  правило расписания (daily | interval)
 * @param date      любой момент в нужном дне — берём только календарную
 *                  дату (YYYY-MM-DD) этого Date в tz юзера. Передавать
 *                  можно `new Date()` для «сегодня» — функция сама разберётся.
 * @param timezone  IANA-имя tz из profiles.timezone ('Europe/Madrid' и т.п.)
 * @returns         массив UTC Date — времена когда должен сработать слот.
 *                  Пустой массив = в этот день препарата не принимают
 *                  (для interval, когда день не на цикле).
 *
 * Логика:
 *   - daily: для каждого HH:mm строим wall-clock '{ymd}T{HH:mm}:00' в tz,
 *     конвертим в UTC через fromZonedTime. На день DST-перехода (например,
 *     27 окт в Европе, когда 03:00 случается дважды) date-fns-tz выбирает
 *     «первое» вхождение — это поведение по умолчанию, нас устраивает.
 *
 *   - interval: считаем разницу в календарных днях между anchor_date и
 *     текущей датой (в tz юзера). Если diff делится на every_days без
 *     остатка и diff >= 0 — это «день приёма», возвращаем один слот.
 *     Иначе пусто.
 *
 * Что НЕ делает:
 *   - не учитывает medications.start_date / end_date — это ответственность
 *     вызывающего (queries.ts фильтрует активные препараты до того как
 *     дёрнуть эту функцию).
 *   - не дедуплицирует с уже существующими intake_events — это делает
 *     unique-индекс в БД (попытка инсерта дубля → constraint violation).
 */
export function computeSlotsForDay(
  schedule: Schedule,
  date: Date,
  timezone: string,
): Date[] {
  // Календарная дата (YYYY-MM-DD) в tz юзера для переданного момента.
  // Пример: date = 2026-05-24T23:30:00Z, tz = 'Europe/Madrid' → '2026-05-25'
  // (потому что в Мадриде это уже 01:30 следующего дня).
  const ymd = formatInTimeZone(date, timezone, 'yyyy-MM-dd')

  if (schedule.kind === 'daily') {
    return schedule.times
      .slice()
      .sort() // стабильный порядок слотов — удобно при отображении и тестах
      .map((time) => fromZonedTime(`${ymd}T${time}:00`, timezone))
  }

  // interval
  const diff = daysBetweenCalendarDates(schedule.anchor_date, ymd)
  if (diff < 0 || diff % schedule.every_days !== 0) return []
  return [fromZonedTime(`${ymd}T${schedule.time}:00`, timezone)]
}

/**
 * Разница в календарных днях между двумя YYYY-MM-DD строками.
 * Целое число (toYmd - fromYmd) дней. Может быть отрицательным.
 *
 * Реализация через Date.UTC намеренно: считаем «голые» календарные дни
 * без локальной tz и без DST — anchor_date в БД именно такой.
 * date-fns differenceInCalendarDays использует tz рантайма (UTC на Vercel),
 * что в общем случае работает, но через Date.UTC оно явно и не зависит
 * от того где запустилось.
 */
function daysBetweenCalendarDates(fromYmd: string, toYmd: string): number {
  const [fy, fm, fd] = fromYmd.split('-').map(Number)
  const [ty, tm, td] = toYmd.split('-').map(Number)
  const fromUtc = Date.UTC(fy, fm - 1, fd)
  const toUtc = Date.UTC(ty, tm - 1, td)
  return Math.round((toUtc - fromUtc) / 86_400_000)
}
