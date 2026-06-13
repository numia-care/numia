'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { MedicationInputSchema } from './medication-schema'

/**
 * CRUD-server actions для medications.
 *
 * Архитектурные решения этого слоя:
 *
 *   1. Zod-валидация на сервере ОБЯЗАТЕЛЬНА. RLS защищает от чужих рядов,
 *      но не от мусорных данных от текущего юзера (или подделанного
 *      запроса в DevTools). Без валидации можно записать schedule с
 *      сломанной структурой → следующее чтение упадёт на parseSchedule().
 *
 *   2. Возвращаем ActionResult<T> вместо throw. Server actions в Next.js
 *      по умолчанию пробрасывают исключения на клиент в кривом виде
 *      (Error: An error occurred in the Server Components render). Лучше
 *      явный discriminated union, который форма умеет показать.
 *
 *   3. revalidatePath('/tracker') после мутаций — Server Components
 *      кэшируются между запросами, без revalidate карточка добавленного
 *      препарата не появится до hard refresh.
 *
 *   4. READ-функции (чтение для рендера) здесь НЕ живут — они в
 *      lib/tracker/queries.ts. Причина: 'use server' делает каждый экспорт
 *      Server Action'ом, а вызов экшена во время рендера ломается при
 *      soft-навигации (Next.js 16 гонит его через action-канал → ответ не
 *      RSC → E394 "unexpected response"). Этот файл — только МУТАЦИИ.
 */

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string }

const ID_SCHEMA = z.string().uuid()

/**
 * Создать препарат. Возвращает id вставленного ряда.
 */
export async function createMedication(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = MedicationInputSchema.safeParse(input)
  if (!parsed.success) {
    // Не светим внутренности Zod на клиент (могут содержать значения полей).
    // Конкретные ошибки показывает client-side валидация в форме до отправки.
    return { ok: false, error: 'invalid_input' }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const { data, error } = await supabase
    .from('medications')
    .insert({
      ...parsed.data,
      // Пустая строка в notes = «нет заметки» → пишем NULL, чтобы не
      // путать с осмысленным «notes='' значит что-то». Та же логика
      // в updateMedication ниже.
      notes: normalizeNotes(parsed.data.notes),
      user_id: user.id,
    })
    .select('id')
    .single()

  if (error) return { ok: false, error: error.message }

  revalidatePath('/tracker')
  return { ok: true, data: { id: data.id } }
}

/**
 * Частичный апдейт препарата. Поля передаются те, что юзер реально менял
 * — остальные не трогаем (нет ON UPDATE DEFAULT в БД, так что NULL в
 * notes — это значит «очистить заметку»).
 *
 * RLS гарантирует, что попытка апдейта чужого ряда тихо ничего не сделает
 * (rows affected = 0). Дополнительно НЕ проверяем user_id в коде — это
 * правильно: вся защита от смены владельца на стороне RLS.
 */
export async function updateMedication(
  id: string,
  input: unknown,
): Promise<ActionResult> {
  if (!ID_SCHEMA.safeParse(id).success) {
    return { ok: false, error: 'invalid_id' }
  }

  const PartialSchema = MedicationInputSchema.partial()
  const parsed = PartialSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  // Если в патче пришли notes — нормализуем пустую строку в null.
  const patch =
    'notes' in parsed.data
      ? { ...parsed.data, notes: normalizeNotes(parsed.data.notes) }
      : parsed.data

  const { error } = await supabase
    .from('medications')
    .update(patch)
    .eq('id', id)

  if (error) return { ok: false, error: error.message }

  revalidatePath('/tracker')
  return { ok: true, data: undefined }
}

/**
 * Пустая строка в notes — это «нет заметки», пишем NULL.
 * Иначе при чтении будет '' что неотличимо от «юзер написал пустоту».
 */
function normalizeNotes(notes: string | undefined): string | null {
  if (!notes) return null
  const trimmed = notes.trim()
  return trimmed.length === 0 ? null : trimmed
}

/**
 * Мягкое удаление: ставим deleted_at = now(). Препарат пропадает из
 * listActiveMedications, но история intake_events ссылается на него
 * как и раньше — graphic регулярности не теряет данных.
 *
 * Восстановление (flip deleted_at → NULL) пока не реализовано в UI,
 * но БД поддерживает (см. CLAUDE.md).
 */
export async function softDeleteMedication(
  id: string,
): Promise<ActionResult> {
  if (!ID_SCHEMA.safeParse(id).success) {
    return { ok: false, error: 'invalid_id' }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const { error } = await supabase
    .from('medications')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)

  if (error) return { ok: false, error: error.message }

  revalidatePath('/tracker')
  return { ok: true, data: undefined }
}
