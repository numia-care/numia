import { cache } from 'react'

import { createClient, getAuthUser } from '@/lib/supabase/server'

// Чтение profiles.timezone для серверного рендера (дашборд, трекер).
//
// НЕ в timezone-actions.ts намеренно: тот файл — 'use server', его экспорты
// становятся server actions, а чтение данных при рендере должно быть обычной
// server-функцией (см. комментарий про E394 в lib/tracker/queries.ts).
//
// cache() — один запрос к profiles на HTTP-запрос, сколько бы компонентов
// ни спросили tz в одном рендере. Дефолт 'UTC', если ряда нет (триггер
// handle_new_user должен был создать профиль на signup, но fallback есть).
export const getUserTimezoneServer = cache(async (): Promise<string> => {
  const user = await getAuthUser()
  if (!user) return 'UTC'

  const supabase = await createClient()
  const { data } = await supabase
    .from('profiles')
    .select('timezone')
    .eq('id', user.id)
    .maybeSingle()

  return data?.timezone ?? 'UTC'
})
