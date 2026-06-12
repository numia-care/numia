'use server'

import { createClient } from '@/lib/supabase/server'
import { isValidIanaTimezone } from '@/lib/timezone'

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
  return { changed: true, tz: detected }
}

/**
 * Прочитать tz юзера из profiles. Дефолт 'UTC' если ряда нет
 * (триггер handle_new_user должен был создать профиль на signup,
 * но на всякий случай fallback есть).
 *
 * Используется при генерации слотов расписания на сервере.
 */
export async function getUserTimezone(): Promise<string> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return 'UTC'

  const { data } = await supabase
    .from('profiles')
    .select('timezone')
    .eq('id', user.id)
    .maybeSingle()

  return data?.timezone ?? 'UTC'
}
