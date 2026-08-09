// Персональный коридор показателя: чтение, запись, удаление.
//
// Границы «твоего обычного» задаёт ЮЗЕР руками — это назначение врача.
// Приложение их НЕ вычисляет: здесь нет и не появится ни перцентилей по
// замерам, ни min/max с отбрасыванием выбросов. Функция записи кладёт ровно
// то, что дал человек. Коридор, выведенный из истории, на экране неотличим от
// медицинской нормы, но ею не является.
//
// Данные открыты под RLS, не E2E: границы не чувствительнее самих замеров,
// которые лежат рядом плейнтекстом с этапа 3. Поэтому ни DEK, ни PIN-сессия
// тут не нужны — в отличие от records.ts, где заметка и бланк шифруются.
//
// Только клиент, как records.ts: браузерный Supabase, вызов из формы. Если
// истории позже понадобится префетч на сервере (чтобы полоса на графике
// рисовалась без мигания), рядом в queries.ts заводится listLabRangesServer
// по образцу listLabResults — те же 15 строк на серверном клиенте.

import { createClient } from '@/lib/supabase/client'

import type { UserRange } from './stats'

/** Строка таблицы lab_ranges как её отдаёт PostgREST. */
export interface LabRangeRow {
  id: string
  analyte: string
  min_value: number
  max_value: number
  unit: string
  created_at: string
  updated_at: string
}

/**
 * Коридоры юзера, разложенные по коду показателя.
 *
 * Значение — сразу UserRange из stats.ts, а не строка БД: так
 * positionInRange(value, unit, ranges[analyte], analyte) вызывается без
 * переклейки полей на месте использования. Перекладывание min_value → min
 * живёт в одном месте — здесь.
 */
export type LabRanges = Record<string, UserRange>

/** Что нужно, чтобы задать или поправить коридор. */
export interface NewLabRange {
  analyte: string
  min: number
  max: number
  /** Единица, В КОТОРОЙ ЮЗЕР ВВЁЛ границы. Не «текущая единица графика». */
  unitCode: string
}

// ── Чтение ───────────────────────────────────────────────────────────────────

/**
 * Все коридоры текущего юзера.
 *
 * RLS сама отбивает чужие строки (lab_ranges_select_own), фильтр по user_id в
 * запросе не нужен.
 *
 * ⚠️ ОТЛИЧИЕ ОТ listLabResults, намеренное: тот при ошибке возвращает пустой
 * результат, а этот бросает. Причина не в стиле, а в цене ошибки. Пустая
 * история — это просто пустой экран. Пустой ответ здесь означал бы «коридор не
 * задан», редактор показал бы чистые поля, юзер ввёл бы новые границы — и
 * upsert затёр бы те, что уже были заданы врачом. Молчаливый возврат {} тут
 * приводит к потере данных, поэтому лучше честно упасть.
 */
export async function listLabRanges(): Promise<LabRanges> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('not_authenticated')

  const { data, error } = await supabase
    .from('lab_ranges')
    .select('id, analyte, min_value, max_value, unit, created_at, updated_at')
  if (error) throw new Error(`lab_ranges_select_failed: ${error.message}`)

  const ranges: LabRanges = {}
  for (const raw of data ?? []) {
    const row = raw as LabRangeRow

    // 'other' в таблицу не пускает CHECK (lab_ranges_analyte_not_other), но
    // читатель не обязан на это полагаться: констрейнт могут ослабить раньше,
    // чем сюда доедет поддержка кастомных показателей.
    if (!row.analyte || row.analyte === 'other') continue

    // numeric из PostgREST приезжает строкой — тот же Number(), что в
    // listLabResults для value (queries.ts).
    const min = Number(row.min_value)
    const max = Number(row.max_value)
    if (!Number.isFinite(min) || !Number.isFinite(max)) continue

    ranges[row.analyte] = { min, max, unitCode: row.unit }
  }

  return ranges
}

// ── Запись ───────────────────────────────────────────────────────────────────

/**
 * Задать или поправить коридор показателя.
 *
 * Upsert по (user_id, analyte) — правка это не «найди id и обнови»: клиенту не
 * нужно знать идентификатор строки, он знает, чей это показатель. Ключ
 * обслуживает уникальный индекс idx_lab_ranges_user_analyte_uniq.
 */
export async function saveLabRange(input: NewLabRange): Promise<void> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('not_authenticated')

  const { analyte, min, max, unit } = validate(input)

  const { error } = await supabase.from('lab_ranges').upsert(
    {
      user_id: user.id,
      analyte,
      min_value: min,
      max_value: max,
      unit,
      // ⚠️ updated_at ОБЯЗАТЕЛЬНО явно, в каждой записи.
      //
      // default now() в схеме срабатывает только на INSERT, а триггера,
      // который двигал бы колонку на UPDATE, в проекте нет ни одного (см.
      // комментарий в миграции 20260809120000). Без этой строки коридор,
      // поправленный через год, показывал бы дату первого сохранения — и
      // поле врало бы молча, что хуже его отсутствия.
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,analyte' },
  )
  if (error) throw new Error(`lab_range_upsert_failed: ${error.message}`)
}

// ── Удаление ─────────────────────────────────────────────────────────────────

/**
 * Убрать коридор показателя — штатное действие, а не аварийное.
 *
 * Фильтр по user_id не нужен: RLS (lab_ranges_delete_own) не даст удалить
 * чужую строку, а .eq('analyte', ...) без него снёс бы у текущего юзера ровно
 * одну — больше одной строки на (user_id, analyte) не бывает.
 */
export async function deleteLabRange(analyte: string): Promise<void> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('not_authenticated')

  const code = analyte.trim()
  if (!code) throw new Error('lab_range_analyte_required')

  const { error } = await supabase
    .from('lab_ranges')
    .delete()
    .eq('user_id', user.id)
    .eq('analyte', code)
  if (error) throw new Error(`lab_range_delete_failed: ${error.message}`)
}

// ── Валидация ────────────────────────────────────────────────────────────────

/**
 * Проверки ПЕРЕД записью. Дублируют CHECK'и в схеме сознательно: БД — последний
 * рубеж, а не первый. Ошибку хочется получить понятным кодом до сетевого
 * запроса, а не строкой «violates check constraint» из Postgres.
 *
 * Перевёрнутый коридор НЕ чиним перестановкой: min > max — это ошибка ввода, и
 * решать за человека, что он имел в виду, здесь нельзя. Ровно так же ведёт себя
 * positionInRange (stats.ts) — там такой диапазон даёт null, а не догадку.
 */
function validate(input: NewLabRange): {
  analyte: string
  min: number
  max: number
  unit: string
} {
  const analyte = input.analyte?.trim()
  if (!analyte) throw new Error('lab_range_analyte_required')

  // 'other' пока без коридора: ключ (user_id, analyte) склеил бы разные
  // кастомные показатели в один. См. CHECK lab_ranges_analyte_not_other.
  if (analyte === 'other') throw new Error('lab_range_other_unsupported')

  const unit = input.unitCode?.trim()
  if (!unit) throw new Error('lab_range_unit_required')

  const { min, max } = input
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    throw new Error('lab_range_bounds_not_finite')
  }
  if (min < 0 || max < 0) throw new Error('lab_range_bounds_negative')
  if (min > max) throw new Error('lab_range_min_gt_max')

  return { analyte, min, max, unit }
}
