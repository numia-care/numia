import { deleteAccount } from '@/lib/api/account'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiJson, apiNoContent, parseJsonBody } from '@/lib/api/http'
import {
  ProfilePatchRequestSchema,
  toApiTimestamp,
  type ProfileResponse,
} from '@/lib/api/schemas'

/**
 * Профиль текущего юзера. Контракт: docs/api-v1.md, §5.
 *
 * Первый содержательный маршрут BFF — он же проверка всей цепочки:
 * Bearer-токен → валидация в GoTrue → запрос в Postgres от имени юзера →
 * RLS отдаёт ровно его строку. Если /me отвечает правильно, транспорт
 * собран верно, и остальные ресурсы — та же схема.
 *
 * Про границу шифрования: timezone открыта (сервер считает по ней слоты и
 * шлёт напоминания), profile_ciphertext — E2E-блоб с именем и формой
 * обращения, мы его только переносим, не читаем.
 */

// Колонки profiles на 2026-08-31 (миграции 20260519, 20260623, 20260706,
// 20260715). Имена в API совпадают с колонками сегодня, но это совпадение,
// а не обязательство — см. правило 2 в docs/api-v1.md.
const PROFILE_COLUMNS = 'id, timezone, profile_ciphertext, dek_wrapped_recovery, created_at'

interface ProfileRow {
  id: string
  timezone: string
  profile_ciphertext: string | null
  dek_wrapped_recovery: string | null
  created_at: string
}

function toApi(row: ProfileRow): ProfileResponse {
  return {
    user_id: row.id,
    timezone: row.timezone,
    profile_ciphertext: row.profile_ciphertext,
    e2e: {
      // Наружу отдаём ФАКТ наличия якоря восстановления, а не сам якорь:
      // приложению нужно знать, можно ли предложить вход по фразе. Обёртку
      // и соль отдаёт отдельный GET /e2e/recovery, когда она реально нужна.
      has_recovery_anchor: row.dek_wrapped_recovery !== null,
    },
    created_at: toApiTimestamp(row.created_at),
  }
}

export const GET = withAuth(async (_request, { user, supabase }) => {
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', user.id)
    .maybeSingle<ProfileRow>()

  if (error) {
    console.error('profiles select failed:', error.message)
    return apiError('internal')
  }
  // Профиль создаётся триггером on_auth_user_created. Его отсутствие —
  // рассогласование данных, а не нормальный случай.
  if (!data) return apiError('not_found', 'profile row missing')

  return apiJson(toApi(data))
})

export const PATCH = withAuth(async (request, { user, supabase }) => {
  const parsed = await parseJsonBody(request, ProfilePatchRequestSchema)
  if ('response' in parsed) return parsed.response
  if (Object.keys(parsed.data).length === 0) {
    return apiError('invalid_input', 'empty patch')
  }

  const { data, error } = await supabase
    .from('profiles')
    .update(parsed.data)
    .eq('id', user.id)
    .select(PROFILE_COLUMNS)
    .maybeSingle<ProfileRow>()

  if (error) {
    console.error('profiles update failed:', error.message)
    return apiError('internal')
  }
  if (!data) return apiError('not_found', 'profile row missing')

  return apiJson(toApi(data))
})

// Удаление аккаунта со всеми данными и файлами (App Store 5.1.1(v)).
// Повторная проверка кода перед удалением не требуется — решение
// зафиксировано в docs/api-v1.md, §5. Как устроено — lib/api/account.ts.
export const DELETE = withAuth(async (_request, { user, supabase }) => {
  const failure = await deleteAccount(supabase, user.id)
  if (failure === 'unreachable') return apiError('service_unavailable', 'storage or database unreachable')
  if (failure === 'internal') return apiError('internal')
  return apiNoContent()
})
