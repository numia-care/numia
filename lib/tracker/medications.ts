'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { MedicationInputSchema } from './medication-schema'
import {
  SLOT_GEN_DAYS,
  generateSlotsForActiveMeds,
  startOfUserDayUtc,
} from './slot-generator'

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

  // Сразу генерим слоты на ближайшие ~48ч, чтобы напоминания работали не
  // дожидаясь суточного cron generate-upcoming или переоткрытия трекера.
  // Без этого свежесозданный препарат с приёмом сегодня пуш бы не получил.
  await regenerateUpcomingSlots(supabase, user.id, await getProfileTimezone(supabase, user.id))

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

  const timezone = await getProfileTimezone(supabase, user.id)

  // Если поменялось расписание — неотмеченные слоты больше ему не
  // соответствуют. Удаляем upcoming этого препарата начиная с сегодняшнего
  // дня юзера и генерим заново.
  //
  // История границы: сначала здесь стоял фильтр .gte(scheduled_at, now) —
  // из-за него просроченный upcoming старого расписания оставался сиротой в
  // «Сегодня» (баг 22:00/23:00). Границу убрали совсем, и
  // это ушло в другую крайность: сносило неотмеченные слоты любой давности.
  // Теперь граница по началу дня юзера — середина между двумя: сирота
  // внутридневная, она под удаление попадает; позавчерашний неотмеченный
  // приём — нет. История (taken/skipped/missed) не трогается как и раньше.
  if ('schedule' in parsed.data) {
    const { error: slotsError } = await supabase
      .from('intake_events')
      .delete()
      .eq('medication_id', id)
      .eq('status', 'upcoming')
      .gte('scheduled_at', startOfUserDayUtc(timezone).toISOString())
    // Не молчим (как раньше): осиротевшие слоты хуже, чем ошибка формы.
    if (slotsError) return { ok: false, error: slotsError.message }
  }

  await regenerateUpcomingSlots(supabase, user.id, timezone)

  revalidatePath('/tracker')
  return { ok: true, data: undefined }
}

/**
 * Таймзона юзера из profiles. 'UTC' если ряда нет — тот же дефолт, что в
 * колонке и в getUserTimezoneServer.
 *
 * Вынесено из regenerateUpcomingSlots, потому что теперь tz нужна раньше и
 * не только генератору: по ней считается нижняя граница удаления слотов
 * (см. startOfUserDayUtc). Один запрос на действие вместо двух.
 */
async function getProfileTimezone(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string> {
  const { data } = await supabase
    .from('profiles')
    .select('timezone')
    .eq('id', userId)
    .maybeSingle()
  return data?.timezone ?? 'UTC'
}

/**
 * Сгенерировать слоты активных препаратов юзера на ближайшие SLOT_GEN_DAYS.
 * Best-effort: сбой не должен валить создание/редактирование препарата —
 * слот добекфилит cron generate-upcoming или on-demand при открытии трекера.
 */
async function regenerateUpcomingSlots(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  timezone: string,
): Promise<void> {
  try {
    await generateSlotsForActiveMeds(supabase, userId, timezone, SLOT_GEN_DAYS)
  } catch (e) {
    console.error('slot generation failed:', e)
  }
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
 * listActiveMedications, но история intake_events ссылается на него как и
 * раньше — график регулярности не теряет данных.
 *
 * Заодно убираем будущие напоминалки. Без этого слоты status='upcoming'
 * оставались: висели в «Сегодня» (getTodaySlots не фильтрует deleted_at) и
 * пушились (send-reminders читает upcoming-слоты у времени). Удаляем начиная
 * с сегодняшнего дня юзера, а taken/skipped/missed НЕ трогаем — это история.
 * Воссоздания не будет: и cron generate-upcoming, и on-demand slot-generator
 * фильтруют deleted_at IS NULL.
 *
 * Прошлые неотмеченные слоты удалённого препарата теперь ОСТАЮТСЯ (раньше
 * сносились вместе с остальными). Это намеренно и согласуется с моделью из
 * миграции этапа 1a: история приёмов переживает удаление препарата. Развёртка
 * mark_missed_intakes пометит их 'missed', а medication_id при soft-delete
 * никуда не девается — значит в «Истории» они покажутся с названием, а не как
 * «удалённый препарат».
 *
 * Восстановление (flip deleted_at → NULL) пока не реализовано в UI, но БД
 * поддерживает (см. CLAUDE.md). После восстановления будущие слоты заведёт
 * ближайший прогон генерации.
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

  // 1. Сначала убираем upcoming-слоты. Порядок важен: если этот шаг упадёт,
  //    препарат ещё активен → состояние консистентно (слоты при необходимости
  //    переродятся), а не «препарат удалён, но пуши идут».
  const timezone = await getProfileTimezone(supabase, user.id)
  const { error: slotsError } = await supabase
    .from('intake_events')
    .delete()
    .eq('medication_id', id)
    .eq('status', 'upcoming')
    .gte('scheduled_at', startOfUserDayUtc(timezone).toISOString())

  if (slotsError) return { ok: false, error: slotsError.message }

  // 2. Мягкое удаление самого препарата.
  const { error } = await supabase
    .from('medications')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)

  if (error) return { ok: false, error: error.message }

  revalidatePath('/tracker')
  return { ok: true, data: undefined }
}
