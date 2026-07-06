// Хэширование PIN для верификации на устройстве.
//
// Используем PBKDF2-SHA256 (встроено в Web Crypto API).
//
// ── Итерации PBKDF2 (версионируются, см. security-аудит 2026-07-06, M3) ──
// Текущее значение — 600k (рекомендация OWASP для PBKDF2-SHA256). Исторические
// артефакты (hash/обёртки) созданы на 210k; сколько итераций у КОНКРЕТНОГО
// набора — хранится рядом с ним (IndexedDB kdf_iterations, profiles.
// recovery_kdf_iterations). Отсутствие значения = LEGACY (210k). Апгрейд —
// ленивый, при успешном unlock (vault.ts), одной атомарной транзакцией.
//
// ВАЖНО: этот хэш — ТОЛЬКО для проверки "ввели ли правильный PIN при unlock".
// Деривация ключа шифрования для E2E-полей — в envelope.ts, с другим info-тегом
// и собственной солью. Разделение доменов: компрометация хэша не раскрывает ключ.

export const KDF_ITERATIONS = 600_000
export const LEGACY_KDF_ITERATIONS = 210_000

const PIN_HASH_BITS = 256
const PIN_VERIFY_INFO = 'numia-pin-verify-v1'

const enc = new TextEncoder()

// 16 байт случайной соли. Хранится в IndexedDB рядом с хэшем — не секрет.
export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16))
}

// iterations по умолчанию — текущие; для проверки старого хэша вызывающий
// передаёт значение, сохранённое рядом с ним (см. шапку файла).
export async function hashPin(
  pin: string,
  salt: Uint8Array,
  iterations: number = KDF_ITERATIONS,
): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(pin + PIN_VERIFY_INFO),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  )

  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    baseKey,
    PIN_HASH_BITS,
  )

  return new Uint8Array(bits)
}

// Сравнение постоянного времени — не даём утекать через тайминг "сколько байт совпало".
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false
  let diff = 0
  for (let i = 0; i < a.byteLength; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

// Утилиты base64 — IndexedDB умеет хранить Uint8Array напрямую, но строки
// удобнее в DevTools и переносе. Это не криптография, оптимизировать не надо.
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
