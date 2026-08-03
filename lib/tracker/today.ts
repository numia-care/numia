import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

import { createClient, getAuthUser } from '@/lib/supabase/server'

import type { IntakeEventRow, MedicationRow } from './queries'
import { parseSchedule } from './schedule'

/**
 * Чтение слотов приёмов за произвольный диапазон + утилиты «Сегодня».
 *
 * Файл называется today.ts исторически: сначала здесь было только чтение
 * сегодняшнего дня. Теперь базовая функция — getSlotsInRange, а getTodaySlots
 * стала её частным случаем. Файл НЕ переименован намеренно: оба потребителя
 * («Сегодня» на /tracker и карточка дашборда) импортируют отсюда, а на ветке
 * design-kai эти компоненты переписаны — правка их импортов дала бы конфликты
 * на мерже ради косметики. Долг записан, переименуем отдельным заходом.
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
  // Конец дня = начало следующего. Считаем не как start+24ч: в DST-переходе
  // сутки бывают 23 или 25 часов. Прыгаем на +36ч (точно попадаем в следующий
  // день при любом переходе), берём его YMD и от него — локальную полночь.
  const tomorrow = new Date(start.getTime() + 36 * 60 * 60 * 1000)
  const tomorrowYmd = formatInTimeZone(tomorrow, timezone, 'yyyy-MM-dd')
  const end = fromZonedTime(`${tomorrowYmd}T00:00:00`, timezone)
  return { start, end }
}

/**
 * Событие + название препарата + dose/form/unit — то, что нужно карточке слота.
 * intake_events ссылается на medication_id, мы джойним через select.
 */
export interface IntakeSlot extends IntakeEventRow {
  medication: Pick<
    MedicationRow,
    'name' | 'kind' | 'form' | 'dose_amount' | 'dose_unit'
  > | null // null если препарат hard-deleted (orphan)
}

/**
 * Старое имя типа. Оставлено алиасом, чтобы не править импорты в компонентах
 * «Сегодня» — они на ветках разошлись, и лишний диф там дорого стоит.
 * В новом коде (История) использовать IntakeSlot.
 */
export type TodaySlot = IntakeSlot

export type SlotOrder = 'asc' | 'desc'

// Список полей вынесен в константу: диапазонное чтение — единственное место,
// где он теперь нужен, но держать его именованным удобнее при отладке.
const SLOT_SELECT = `
  id, user_id, medication_id, scheduled_at, taken_at, status,
  dose_actual, notes, created_at,
  medication:medications(name, kind, form, dose_amount, dose_unit)
`

/**
 * Нормализация вложенного ресурса из PostgREST.
 *
 * При medication_id IS NULL (препарат hard-deleted, ON DELETE SET NULL)
 * приходит null — слот-сирота, UI показывает его как «удалённый препарат».
 * В «Сегодня» это редкость, в Истории — обычное дело.
 *
 * Массив разворачиваем на всякий случай: supabase-js типизирует вложенный
 * ресурс то объектом, то массивом в зависимости от формы запроса, и прежний
 * `?? null` на пустом массиве вернул бы [], а не null — то есть «препарат
 * есть, но без полей». Здесь такого не случится.
 */
function normalizeMedication(raw: unknown): IntakeSlot['medication'] {
  if (!raw) return null
  const value = Array.isArray(raw) ? (raw[0] ?? null) : raw
  return (value as IntakeSlot['medication']) ?? null
}

/**
 * Слоты приёмов за произвольный диапазон, полуинтервал [fromUtc, toUtc).
 *
 * Базовая функция чтения: и «Сегодня», и История ходят через неё. Границы
 * считает вызывающая сторона (для дня — getTodayRange, для Истории — свой
 * период), потому что только она знает, в какой tz их считать.
 *
 * order: 'asc' — как в «Сегодня» (утро сверху), 'desc' — для ленты Истории
 * (свежее сверху). Сортировка на стороне Postgres, индекс
 * idx_intake_events_user_scheduled покрывает оба направления.
 */
export async function getSlotsInRange(
  fromUtc: Date,
  toUtc: Date,
  order: SlotOrder = 'asc',
): Promise<IntakeSlot[]> {
  const user = await getAuthUser() // кэширован на запрос
  if (!user) return []
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('intake_events')
    .select(SLOT_SELECT)
    .eq('user_id', user.id)
    .gte('scheduled_at', fromUtc.toISOString())
    .lt('scheduled_at', toUtc.toISOString())
    .order('scheduled_at', { ascending: order === 'asc' })

  if (error || !data) return []

  // Тип приводим вручную — сгенерённых Database-типов у нас пока нет.
  return data.map((row) => ({
    ...row,
    medication: normalizeMedication(row.medication),
  })) as IntakeSlot[]
}

/**
 * Слоты на сегодня в tz юзера, отсортированные по scheduled_at ASC.
 *
 * Частный случай getSlotsInRange. Сигнатура и результат намеренно те же, что
 * были до обобщения: оба потребителя «Сегодня» остаются нетронутыми.
 *
 * Фильтра deleted_at здесь нет и не было — см. комментарий в
 * softDeleteMedication (lib/tracker/medications.ts) о том, почему это важно.
 */
export async function getTodaySlots(timezone: string): Promise<IntakeSlot[]> {
  const { start, end } = getTodayRange(timezone)
  return getSlotsInRange(start, end, 'asc')
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
