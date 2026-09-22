import type { SupabaseClient } from '@supabase/supabase-js'

import { withAuth } from '@/lib/api/auth'
import { apiDbFailure, apiError, apiJson, parseJsonBody } from '@/lib/api/http'
import {
  RecoveryAnchorPutRequestSchema,
  type RecoveryAnchorResponse,
} from '@/lib/api/schemas'

/**
 * Серверный якорь восстановления. Контракт: docs/api-v1.md, §12.
 *
 * Якорь — DEK, обёрнутый ключом из фразы восстановления, плюс соль и итерации.
 * Секретов в нём нет, но он единственный: перезапишешь чужим DEK — весь
 * E2E-контент пользователя становится нечитаемым навсегда. Отсюда два правила
 * этого файла.
 *
 * 1. Ошибка чтения — никогда не 404. На 404 клиент считает, что якоря нет, и
 *    генерит новый DEK. Ложный 404 из-за сбоя сети уничтожил бы данные.
 *
 * 2. Запись условная и атомарная — оптимистическая блокировка. Клиент
 *    присылает версию, которую видел; UPDATE проходит, только если она всё
 *    ещё текущая. Проверка и запись — один оператор в Postgres, а не
 *    «прочитать здесь, сравнить, записать»: между чтением и записью успело бы
 *    вклиниться другое устройство. Версию увеличивает триггер БД
 *    (миграция 20260915120000), поэтому запись из веба её тоже сдвигает.
 *
 * Тело запроса не логируется ни при каких ошибках.
 */

const ANCHOR_COLUMNS =
  'dek_wrapped_recovery, recovery_salt, recovery_kdf_iterations, recovery_anchor_version'

interface AnchorRow {
  dek_wrapped_recovery: string | null
  recovery_salt: string | null
  recovery_kdf_iterations: number | null
  recovery_anchor_version: number
}

// Якорь есть, только если есть и обёртка, и соль — так же считает веб
// (lib/crypto/vault.ts, readRecoveryAnchor).
function toApi(row: AnchorRow): RecoveryAnchorResponse | null {
  if (!row.dek_wrapped_recovery || !row.recovery_salt) return null
  return {
    dek_wrapped_recovery: row.dek_wrapped_recovery,
    recovery_salt: row.recovery_salt,
    recovery_kdf_iterations: row.recovery_kdf_iterations,
    anchor_version: row.recovery_anchor_version,
  }
}

async function readAnchorRow(supabase: SupabaseClient, userId: string) {
  return supabase
    .from('profiles')
    .select(ANCHOR_COLUMNS)
    .eq('id', userId)
    .maybeSingle<AnchorRow>()
}

export const GET = withAuth(async (_request, { user, supabase }) => {
  const result = await readAnchorRow(supabase, user.id)
  if (result.error) return apiDbFailure('recovery anchor read', result)

  // Строки профиля нет — рассогласование данных (её создаёт триггер при
  // регистрации). Это НЕ «якоря нет»: отвечать 404 здесь нельзя.
  if (!result.data) return apiError('internal', 'profile row missing')

  const anchor = toApi(result.data)
  if (!anchor) return apiError('not_found', 'no recovery anchor')
  return apiJson(anchor)
})

export const PUT = withAuth(async (request, { user, supabase }) => {
  const parsed = await parseJsonBody(request, RecoveryAnchorPutRequestSchema)
  if ('response' in parsed) return parsed.response
  const { expected_anchor_version: expected, ...anchor } = parsed.data

  // Условие записи. «Создать» проверяем по отсутствию обёртки, а не по версии
  // 0: версия только растёт, и если якорь когда-нибудь обнулят, создать его
  // заново всё равно должно быть можно. Для двух одновременных созданий это
  // так же атомарно: второй UPDATE после блокировки перепроверит условие на
  // свежей строке, увидит обёртку и не обновит ничего.
  let update = supabase.from('profiles').update(anchor).eq('id', user.id)
  update =
    expected === 0
      ? update.is('dek_wrapped_recovery', null)
      : update.eq('recovery_anchor_version', expected)

  const result = await update.select(ANCHOR_COLUMNS).maybeSingle<AnchorRow>()
  if (result.error) return apiDbFailure('recovery anchor write', result)

  const written = result.data && toApi(result.data)
  if (written) return apiJson(written)

  // Ни одна строка не подошла под условие. Чтение ниже только классифицирует
  // результат, на атомарность записи оно не влияет.
  const current = await readAnchorRow(supabase, user.id)
  if (current.error) return apiDbFailure('recovery anchor read', current)
  // Отличаем от конфликта, чтобы клиент не крутился в цикле 409 → GET → PUT.
  if (!current.data) return apiError('internal', 'profile row missing')

  // Повтор после потерянного ответа: якорь уже ровно такой, какой прислали.
  // Для создания условие «обёртки нет» больше не выполняется — её записал
  // первый же запрос. Ответить 409 здесь нельзя: клиент выбросил бы DEK и
  // фразу, а на сервере остался бы якорь под фразой, которую никто не видел.
  // Совпасть с чужим якорем невозможно — это 60 случайных байт.
  const existing = toApi(current.data)
  if (
    existing &&
    existing.dek_wrapped_recovery === anchor.dek_wrapped_recovery &&
    existing.recovery_salt === anchor.recovery_salt &&
    existing.recovery_kdf_iterations === anchor.recovery_kdf_iterations
  ) {
    return apiJson(existing)
  }
  return apiError('conflict', 'anchor version mismatch')
})
