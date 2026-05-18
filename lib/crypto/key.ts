// Скелет деривации AES-GCM ключа из PIN.
//
// Сейчас не используется в продакшен-флоу (E2E полей ещё нет), но вызывается
// на /pin/setup и /pin — чтобы убедиться что архитектура работает end-to-end
// и чтобы ключ был в памяти когда понадобится. Подключим к реальному
// шифрованию на этапе 2 (дневник настроения) и этапе 4 (фото/голос).
//
// Архитектура (как PIN превращается в два разных секрета):
//   PIN + salt_verify + info-tag "verify" → PBKDF2 → hash (хранится локально)
//   PIN + salt_crypto + info-tag "crypto" → PBKDF2 → CryptoKey (только в памяти)
// Разные info-теги защищают: один из секретов нельзя получить из другого.
//
// Кросс-девайс E2E (этап 2+): salt_crypto должна быть стабильной у юзера
// на всех устройствах, иначе один и тот же PIN даст разные ключи и записи
// с одного устройства не расшифруются на другом. Решение — реплицировать
// salt_crypto в Supabase user_metadata (соль не секрет, ок хранить на сервере).
// Сейчас (этап 0) держим только локально — на одном устройстве ок.

const KEY_ITERATIONS = 210_000
const KEY_BITS = 256
const KEY_INFO = 'numia-pin-crypto-v1'

const enc = new TextEncoder()

// Возвращает CryptoKey, а не raw bytes — Web Crypto не даёт JS прямой доступ
// к материалу ключа, только subtle.encrypt/decrypt. Это правильно.
export async function deriveCryptoKey(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(pin + KEY_INFO),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  )

  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: KEY_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: KEY_BITS },
    false, // extractable=false — ключ не вытащить наружу из CryptoKey
    ['encrypt', 'decrypt'],
  )
}

// TODO (этап 2+): хелперы encryptField / decryptField.
//
// encryptField(key, plaintext):
//   iv = crypto.getRandomValues(new Uint8Array(12))  // 12 байт = стандарт AES-GCM
//   ciphertext = subtle.encrypt({name:'AES-GCM', iv}, key, encode(plaintext))
//   return base64(iv || ciphertext)   // tag уже включён в ciphertext в Web Crypto
//
// decryptField(key, blob):
//   bytes = base64decode(blob)
//   iv = bytes[0..12]; ct = bytes[12..]
//   return decode(subtle.decrypt({name:'AES-GCM', iv}, key, ct))
//
// Для каждой записи СВОЙ iv — нельзя переиспользовать iv с одним ключом,
// это разрушает AES-GCM. crypto.getRandomValues даёт достаточную энтропию
// при разумных объёмах (< 2^32 записей у одного юзера — мы заведомо там).
