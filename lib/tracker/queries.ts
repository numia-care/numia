import type { SupabaseClient } from '@supabase/supabase-js'
import type { Schedule } from './schedule'

/**
 * Типизированные обёртки supabase select для трекера ЗГТ.
 *
 * Зачем отдельный слой:
 *   - supabase-js возвращает данные как Database['public']['Tables'][...]['Row'],
 *     но мы пока не генерим типы Supabase (TODO: `pnpm dlx supabase gen types`).
 *     Здесь — ручные интерфейсы, синхронизированы с миграцией
 *     supabase/migrations/20260519120000_etap1a_tracker.sql.
 *   - schedule приходит как jsonb (unknown), мы её парсим через ScheduleSchema
 *     перед возвратом — RLS не валидирует структуру JSON.
 *   - все запросы фильтруют по user_id через RLS на сервере, но в коде тоже
 *     явно передаём userId для читаемости и подстраховки на случай дыр RLS.
 *
 * Эти обёртки — заготовки этапа 1a. Реальные реализации с обработкой
 * ошибок и парсингом schedule доделаем когда подключим к UI трекера.
 */

// ---- ряды таблиц (зеркало миграции) ---------------------------------------

export type MedicationKind =
  | 'estrogen'
  | 'antiandrogen'
  | 'progesterone'
  | 'testosterone'
  | 'other'

export type MedicationForm =
  | 'tablet'
  | 'capsule'
  | 'injection'
  | 'gel'
  | 'patch'
  | 'drops'
  | 'spray'
  | 'other'

export type DoseUnit = 'mg' | 'mcg' | 'ml' | 'iu' | 'drop' | 'puff'

export type IntakeStatus = 'upcoming' | 'taken' | 'skipped' | 'missed'

export interface MedicationRow {
  id: string
  user_id: string
  name: string
  kind: MedicationKind
  form: MedicationForm
  dose_amount: number
  dose_unit: DoseUnit
  schedule: Schedule // парсится через parseSchedule() перед возвратом
  start_date: string // YYYY-MM-DD
  end_date: string | null
  deleted_at: string | null
  notes: string | null
  created_at: string
}

export interface IntakeEventRow {
  id: string
  user_id: string
  medication_id: string | null // SET NULL при hard-delete препарата
  scheduled_at: string // ISO UTC
  taken_at: string | null
  status: IntakeStatus
  dose_actual: number | null
  notes: string | null
  created_at: string
}

// ---- запросы ---------------------------------------------------------------

/**
 * Активные препараты юзера: не stopped (end_date null) и не soft-deleted.
 * Покрыто partial-индексом idx_medications_user_active.
 *
 * TODO: реализовать после того как первая страница трекера будет дёргать.
 *       Не забыть: parseSchedule() на каждом ряду, чтобы Schedule был
 *       реально провалидирован а не приведён через as.
 */
export async function getActiveMedications(
  _supabase: SupabaseClient,
  _userId: string,
): Promise<MedicationRow[]> {
  throw new Error('TODO: реализовать в (app)/tracker page')
}

/**
 * Один препарат по id (для деталки и формы редактирования).
 * RLS уже фильтрует по user_id — лишняя проверка не нужна, но id
 * передаём явно для логирования если что-то пойдёт не так.
 */
export async function getMedicationById(
  _supabase: SupabaseClient,
  _medicationId: string,
): Promise<MedicationRow | null> {
  throw new Error('TODO: реализовать в (app)/tracker/[id] page')
}

/**
 * Слоты приёмов на конкретный календарный день в tz юзера.
 * Возвращает события со status='upcoming'|'taken'|'skipped'|'missed',
 * отсортированные по scheduled_at ASC. Используется на главной трекера.
 *
 * Диапазон: [startOfDayUtc, endOfDayUtc) — вычисляется на вызывающей
 * стороне через date-fns-tz (startOfDay в tz юзера → fromZonedTime).
 */
export async function getIntakeEventsForRange(
  _supabase: SupabaseClient,
  _userId: string,
  _fromUtc: Date,
  _toUtc: Date,
): Promise<IntakeEventRow[]> {
  throw new Error('TODO: реализовать в (app)/tracker page')
}

/**
 * История приёмов конкретного препарата за последние N дней.
 * Для деталки препарата и графика регулярности.
 */
export async function getIntakeHistoryForMedication(
  _supabase: SupabaseClient,
  _medicationId: string,
  _sinceUtc: Date,
): Promise<IntakeEventRow[]> {
  throw new Error('TODO: реализовать на странице деталки препарата')
}
