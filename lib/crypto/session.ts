// Состояние «разблокировано» в текущей сессии браузера.
//
// Модель блокировки:
//   • Crypto-ключ (DEK) держим ТОЛЬКО в памяти модуля — он теряется при reload и
//     холодном старте PWA. Нет ключа → расшифровать нечем → нужен PIN. Это и
//     есть требование «PIN при холодном старте».
//   • Грейс-период по фону: короткий уход в фон НЕ лочит. PIN запрашиваем,
//     только если приложение пробыло в фоне дольше LOCK_GRACE_MS (по умолчанию
//     2 минуты). Момент ухода в фон пишем в sessionStorage — он переживает
//     заморозку вкладки, но не полный перезапуск PWA (там и так холодный старт).
//
// Крипта и локальное хранение PIN при этом НЕ меняются — это лишь условие
// показа экрана ввода PIN.
//
// Crypto-ключ держим в переменной модуля, не в storage: storage инспектируется
// через DevTools, а переменная живёт только пока загружена страница и
// автоматически уходит при reload.

const HIDDEN_AT = 'numia_hidden_at'

// Грейс-период: сколько можно пробыть в фоне без повторного запроса PIN.
export const LOCK_GRACE_MS = 2 * 60 * 1000

let memoryKey: CryptoKey | null = null

// Разблокировка: кладём DEK в память и сбрасываем маркер фона.
export function markUnlocked(key?: CryptoKey | null): void {
  if (key) memoryKey = key
  if (typeof window !== 'undefined') sessionStorage.removeItem(HIDDEN_AT)
}

// Заблокировать: забыть ключ (дальше потребуется PIN) и очистить маркер фона.
export function lock(): void {
  memoryKey = null
  if (typeof window !== 'undefined') sessionStorage.removeItem(HIDDEN_AT)
}

// DEK текущей сессии. null → расшифровать нечем, нужен PIN.
// Используют модули шифрования (lib/path) и PinGate.
export function getCryptoKey(): CryptoKey | null {
  return memoryKey
}

// Запомнить момент ухода в фон (visibilitychange → hidden).
export function noteHidden(): void {
  if (typeof window === 'undefined') return
  sessionStorage.setItem(HIDDEN_AT, String(Date.now()))
}

// Сколько приложение пробыло в фоне (ms). 0 — если маркера нет.
export function hiddenDurationMs(): number {
  if (typeof window === 'undefined') return 0
  const ts = sessionStorage.getItem(HIDDEN_AT)
  if (!ts) return 0
  const ms = Date.now() - Number(ts)
  return ms > 0 ? ms : 0
}

// Сбросить маркер фона (вернулись в пределах грейс-периода).
export function clearHidden(): void {
  if (typeof window !== 'undefined') sessionStorage.removeItem(HIDDEN_AT)
}
