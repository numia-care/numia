import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Удаление аккаунта для DELETE /me. Контракт: docs/api-v1.md, §5.
 *
 * Два шага, порядок важен:
 *   1. Файлы в Storage — токеном пользователя, через Storage API. Политика
 *      path_media_delete_own пускает только в свою папку `{user_id}/`.
 *   2. Сам аккаунт — функцией Postgres delete_my_account() (миграция
 *      20260915130000): удаляет auth.users по auth.uid(), таблицы и сессии
 *      уходят каскадом.
 *
 * Файлы первыми, потому что после шага 2 токена больше нет и осиротевшие
 * файлы стало бы нечем удалить. Обратное безопасно: упали на шаге 1 или 2 —
 * аккаунт на месте, повтор дочищает то, что осталось. Поэтому операция
 * идемпотентна без отдельного журнала.
 *
 * service_role здесь НЕ используется — см. шапку миграции.
 */

// Все E2E-файлы веба и iOS лежат в одном бакете: «Путь» (lib/path/entries.ts)
// и бланки анализов (lib/labs/records.ts). Новый бакет с данными пользователя
// нужно добавить сюда — иначе удаление аккаунта оставит его файлы.
export const USER_BUCKETS = ['path-media'] as const

const PAGE = 1000

export type AccountDeletionFailure = 'unreachable' | 'internal'

interface StorageFailure {
  status?: number
  name?: string
}

// Нет HTTP-статуса — не достучались до Storage вовсе; 502–504 — шлюз.
function classify(error: StorageFailure): AccountDeletionFailure {
  const status = error.status
  if (status === undefined || (status >= 502 && status <= 504)) return 'unreachable'
  return 'internal'
}

async function removeFolder(
  supabase: SupabaseClient,
  bucket: string,
  folder: string,
): Promise<AccountDeletionFailure | null> {
  const storage = supabase.storage.from(bucket)

  // Всегда читаем первую страницу: удалённое из листинга пропадает, так что
  // смещение не нужно. Цикл кончается, когда папка пуста.
  for (;;) {
    const listed = await storage.list(folder, { limit: PAGE })
    if (listed.error) {
      console.error(`storage list failed: bucket=${bucket} status=${(listed.error as StorageFailure).status ?? '-'}`)
      return classify(listed.error as StorageFailure)
    }
    if (listed.data.length === 0) return null

    // У вложенных «папок» в листинге нет id. Сейчас структура плоская, но
    // обходим и их: пропущенный файл пережил бы удаление аккаунта.
    const files: string[] = []
    for (const entry of listed.data) {
      const path = `${folder}/${entry.name}`
      if (entry.id === null) {
        const nested = await removeFolder(supabase, bucket, path)
        if (nested) return nested
      } else {
        files.push(path)
      }
    }
    if (files.length === 0) continue

    const removed = await storage.remove(files)
    if (removed.error) {
      console.error(`storage remove failed: bucket=${bucket} status=${(removed.error as StorageFailure).status ?? '-'}`)
      return classify(removed.error as StorageFailure)
    }
    // Storage не сообщает об отказе политики ошибкой — просто не удаляет.
    // Без этой проверки цикл крутился бы вечно на одних и тех же файлах.
    if (removed.data.length < files.length) {
      console.error(`storage remove incomplete: bucket=${bucket}`)
      return 'internal'
    }
  }
}

export async function deleteAccount(
  supabase: SupabaseClient,
  userId: string,
): Promise<AccountDeletionFailure | null> {
  for (const bucket of USER_BUCKETS) {
    const failure = await removeFolder(supabase, bucket, userId)
    if (failure) return failure
  }

  const { error, status } = await supabase.rpc('delete_my_account')
  if (error) {
    console.error(`delete_my_account failed: status=${status} code=${error.code || '-'}`)
    return status === 0 || (status >= 502 && status <= 504) ? 'unreachable' : 'internal'
  }
  return null
}
