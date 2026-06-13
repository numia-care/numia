import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { parseSchedule, type Schedule } from './schedule'

const ID_SCHEMA = z.string().uuid()

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

// ВАЖНО: эти READ-функции живут ЗДЕСЬ, а не в medications.ts, намеренно.
// medications.ts помечен 'use server' → каждый его экспорт становится
// Server Action (RPC-эндпоинт для МУТАЦИЙ, который клиент дёргает по одному).
// Если читать данные таким экспортом во время рендера страницы, то при
// soft-навигации (переход по <Link>, а не полная перезагрузка) Next.js 16
// прогоняет вызов через action-канал, и ответ приходит не как RSC →
// «An unexpected response was received from the server» (E394).
// Чтение для SSR должно быть обычной server-функцией — что и есть этот файл.
// См. доки Next: «Server Functions are designed for server-side mutations»
// (01-getting-started/07-mutating-data.md).

/**
 * Активные препараты юзера: не stopped (end_date null) и не soft-deleted.
 * Покрыто partial-индексом idx_medications_user_active. RLS фильтрует по
 * user_id; условие в where дублирующее, но читаемое.
 *
 * parseSchedule() на каждом ряду — чтобы вызывающий получил типизированную
 * Schedule, реально провалидированную, а не приведённую через as.
 */
export async function listActiveMedications(): Promise<MedicationRow[]> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase
    .from('medications')
    .select('*')
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .is('end_date', null)
    .order('created_at', { ascending: false })

  if (error || !data) return []

  return data.map((row) => ({
    ...row,
    schedule: parseSchedule(row.schedule),
  })) as MedicationRow[]
}

/**
 * Один препарат по id для страницы редактирования.
 * RLS отбивает чужие; если ряд не найден или удалён — null.
 */
export async function getMedicationForEdit(
  id: string,
): Promise<MedicationRow | null> {
  if (!ID_SCHEMA.safeParse(id).success) return null

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase
    .from('medications')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (error || !data) return null
  return { ...data, schedule: parseSchedule(data.schedule) } as MedicationRow
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
