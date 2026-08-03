'use server'

import { createClient } from '@/lib/supabase/server'
import { isValidIanaTimezone } from '@/lib/timezone'
import {
  SLOT_GEN_DAYS,
  generateSlotsForActiveMeds,
  startOfUserDayUtc,
} from '@/lib/tracker/slot-generator'

/**
 * Server actions для работы с profiles.timezone.
 * Все экспорты этого файла — server actions (так работает 'use server'),
 * так что pure-функции живут отдельно в lib/timezone.ts.
 */

/**
 * Записать таймзону в profiles текущего юзера.
 *
 * Вызывается с клиента после detectUserTimezone(), обычно при первом
 * входе после логина из компонента-синхронизатора в (app)/layout.tsx.
 *
 * RLS политика profiles_update_own дополнительно гарантирует что юзер
 * может писать только в свой ряд — даже если кто-то подделает user_id
 * в запросе, Postgres откажет.
 */
export async function saveUserTimezone(
  timezone: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isValidIanaTimezone(timezone)) {
    return { ok: false, error: 'invalid_timezone' }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const { error } = await supabase
    .from('profiles')
    .update({ timezone })
    .eq('id', user.id)

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/**
 * Синхронизировать tz: сравнить с текущей в profiles, обновить если разные.
 * Возвращает {changed: true} если был UPDATE, иначе {changed: false}.
 *
 * Вызывается с клиента из <TimezoneSync /> на (app)/layout при каждом
 * входе. Если юзер переехал в другой часовой пояс (или сменил настройку
 * в системе) — profile.timezone обновится без явного действия.
 *
 * Это надёжнее чем «спросить tz один раз при signup» — юзер мог
 * переехать или путешествовать.
 */
export async function syncUserTimezone(
  detected: string,
): Promise<{ changed: boolean; tz: string }> {
  if (!isValidIanaTimezone(detected)) {
    return { changed: false, tz: 'UTC' }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { changed: false, tz: 'UTC' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('timezone')
    .eq('id', user.id)
    .maybeSingle()

  const current = profile?.timezone ?? 'UTC'
  if (current === detected) {
    return { changed: false, tz: current }
  }

  const { error } = await supabase
    .from('profiles')
    .update({ timezone: detected })
    .eq('id', user.id)

  if (error) return { changed: false, tz: current }

  // Слоты расписаний хранятся UTC-инстантами, посчитанными в СТАРОЙ tz.
  // После смены tz они «уезжают» на разницу зон и висят дублями рядом с
  // новыми: unique-индекс (medication_id, scheduled_at) такие пары не
  // склеивает (баг 22:00/23:00 — профиль флипался
  // между таймзонами разных устройств). Поэтому сносим upcoming и генерим
  // заново в новой tz. История (taken/skipped/missed) не трогается.
  //
  // Граница снизу — начало СЕГОДНЯШНЕГО дня юзера. Без неё этот делит был
  // самым опасным местом в трекере: ни фильтра по препарату, ни по времени,
  // то есть один автоматический флип tz (а он случался сам собой между
  // устройствами) стирал всё неотмеченное прошлое юзера насовсем.
  // Фикс с сиротой 22:00/23:00 граница не задевает — та сирота
  // внутридневная (22:00 и 23:00 ОДНОГО дня), она остаётся под удалением.
  //
  // Считаем границу в НОВОЙ зоне (detected), а не в старой: пересобираем
  // слоты тоже в ней, так что окно удаления и окно генерации совпадают.
  // Best-effort: сбой не валит sync — сверка в генераторах добьёт позже.
  try {
    const { error: delError } = await supabase
      .from('intake_events')
      .delete()
      .eq('user_id', user.id)
      .eq('status', 'upcoming')
      .gte('scheduled_at', startOfUserDayUtc(detected).toISOString())
    if (delError) {
      console.error('upcoming cleanup after tz change failed:', delError.message)
    } else {
      await generateSlotsForActiveMeds(supabase, user.id, detected, SLOT_GEN_DAYS)
    }
  } catch (e) {
    console.error('slot regen after tz change failed:', e)
  }

  return { changed: true, tz: detected }
}
