// Состояние "разблокировано" в текущей сессии браузера.
//
// sessionStorage очищается при закрытии вкладки/PWA — это нужное свойство:
// после закрытия приложения и повторного открытия снова потребуется PIN,
// даже если Supabase-сессия ещё валидна. CLAUDE.md (раздел "PIN-код"):
// "телефон попал в чужие руки на 30 секунд".
//
// Crypto-ключ держим только в переменной модуля — не в storage. Это правильно
// для модели угроз: storage можно проинспектировать через DevTools, переменная
// модуля живёт только пока загружена страница и автоматически уходит при reload.

const UNLOCK_FLAG = 'numia_unlocked_at'

// TTL разблокировки в миллисекундах. После возврата из фона спустя этот срок —
// требуем PIN снова. 5 минут — баланс между UX и безопасностью.
export const UNLOCK_TTL_MS = 5 * 60 * 1000

let memoryKey: CryptoKey | null = null

export function markUnlocked(key?: CryptoKey | null): void {
  sessionStorage.setItem(UNLOCK_FLAG, String(Date.now()))
  if (key) memoryKey = key
}

export function isUnlocked(): boolean {
  if (typeof window === 'undefined') return false
  const ts = sessionStorage.getItem(UNLOCK_FLAG)
  if (!ts) return false
  const age = Date.now() - Number(ts)
  return age >= 0 && age < UNLOCK_TTL_MS
}

export function lock(): void {
  sessionStorage.removeItem(UNLOCK_FLAG)
  memoryKey = null
}

// Доступен только текущему рантайму — между перезагрузками теряется.
// Используют только модули шифрования (этап 2+).
export function getCryptoKey(): CryptoKey | null {
  return memoryKey
}
