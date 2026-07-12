// Soft-lockout ввода PIN — ЕДИНАЯ механика для всех мест, где PIN
// проверяется: экран разблокировки (app/(auth)/pin/form.tsx) и диалог
// включения биометрии (components/settings/biometric-toggle.tsx).
// Если бы у диалога не было паузы, он стал бы обходом защиты от перебора.
//
// Счётчик и дедлайн паузы живут в IndexedDB (PinStorage) — общие для всех
// поверхностей и переживают reload. Обход очисткой IndexedDB атакующему не
// помогает: вместе с паузой сотрётся обёртка DEK — данные не расшифровать.

import { PinStorage } from './storage'

// После этого числа неверных попыток подряд — нарастающая пауза. Это часть
// модели «защита от чужих рук на 30 секунд»: без паузы онлайн-перебор по
// клавиатуре ничем не ограничен.
export const SOFT_LOCKOUT_AFTER = 5

// Пауза после n-й неверной попытки: 30с → 1м → 2м → 4м → потолок 5 минут.
export function lockoutMs(attempts: number): number {
  return Math.min(30_000 * 2 ** (attempts - SOFT_LOCKOUT_AFTER), 300_000)
}

/**
 * Зарегистрировать неверную попытку: инкремент счётчика, с пятой — пауза.
 * Возвращает счётчик и секунды назначенной паузы (0 = паузы ещё нет).
 */
export async function registerFailedPinAttempt(): Promise<{
  attempts: number
  lockoutSeconds: number
}> {
  const attempts = await PinStorage.incrementFailedAttempts()
  if (attempts >= SOFT_LOCKOUT_AFTER) {
    const ms = lockoutMs(attempts)
    await PinStorage.setLockoutUntil(Date.now() + ms)
    return { attempts, lockoutSeconds: Math.ceil(ms / 1000) }
  }
  return { attempts, lockoutSeconds: 0 }
}

/** Сколько секунд паузы осталось прямо сейчас (0 = вводить можно). */
export async function readLockoutSeconds(): Promise<number> {
  const until = await PinStorage.getLockoutUntil()
  if (!until) return 0
  return Math.max(0, Math.ceil((until - Date.now()) / 1000))
}
