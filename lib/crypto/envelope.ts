// Envelope-шифрование (key wrapping) для E2E «Пути» и дневника.
//
// ── Почему НЕ «деривируем ключ прямо из PIN» (как было на этапе 0, key.ts) ──
//
// Старая схема: content_key = PBKDF2(PIN, salt). Проблемы, которые ломают
// требования этого этапа:
//   1. Recovery-фраза. Нельзя сделать так, чтобы PBKDF2(PIN) и PBKDF2(фраза)
//      дали ОДИН И ТОТ ЖЕ ключ — это разные входы. Значит «тот же ключ из
//      фразы» математически невозможен при прямой деривации.
//   2. Смена PIN заставила бы перешифровать ВЕСЬ контент (ключ-то меняется).
//
// ── Решение: envelope encryption (двухуровневые ключи) ──
//
//   DEK (Data Encryption Key) — случайный 256-бит ключ. Им и ТОЛЬКО им
//     шифруется весь контент (фото, подписи, заметки). Генерится один раз.
//   KEK (Key Encryption Key) — выводится из секрета (PIN или recovery-фразы)
//     через PBKDF2. Им шифруется (оборачивается) копия DEK.
//
//   DEK оборачивается НЕСКОЛЬКО раз — по разу на каждый способ разблокировки:
//     wrapped_pin      = AES-GCM(KEK_pin,    DEK)
//     wrapped_recovery = AES-GCM(KEK_phrase, DEK)
//   Расшифровать DEK можно любым из секретов; контент при этом один.
//
//   Выгоды:
//     • Recovery-фраза даёт доступ к ТОМУ ЖЕ DEK → тот же контент.
//     • Смена PIN = перевернуть только wrapped_pin (DEK не трогаем, контент
//       не перешифровываем).
//     • Новый способ входа (passkey/биометрия в будущем) = ещё одна обёртка.
//
// ── Что где лежит — см. CLAUDE.md, блок «Путь». Коротко: wrapped_recovery
//    (обёрнут 128-битной фразой) безопасно держать на сервере, wrapped_pin
//    (обёрнут слабым 6-значным PIN) — НЕ на сервере. Эти функции не знают про
//    хранилище — только примитивы. Решение «где хранить» — в вызывающем коде.

import { base64ToBytes, bytesToBase64 } from './pin'

const KEK_ITERATIONS = 210_000
// info-тег отделяет домен KEK от домена verify-хэша (pin.ts) — даже при той же
// соли и том же PIN это разные секреты.
const KEK_INFO = 'numia-kek-v1'
const IV_BYTES = 12 // стандарт для AES-GCM

const enc = new TextEncoder()
const dec = new TextDecoder()

// ── DEK ──────────────────────────────────────────────────────────────────

export interface Dek {
  // Для шифрования/дешифрования контента. non-extractable: материал ключа
  // наружу из CryptoKey не вытащить (Web Crypto это гарантирует).
  key: CryptoKey
  // Сырые байты — нужны ТОЛЬКО чтобы обернуть DEK KEK'ами при setup. После
  // оборачивания вызывающий обязан их забыть (выходят из области видимости).
  raw: Uint8Array
}

// Новый случайный DEK. Вызывается один раз при первичной настройке E2E.
export async function generateDek(): Promise<Dek> {
  const raw = crypto.getRandomValues(new Uint8Array(32))
  return { key: await importDek(raw), raw }
}

// Импорт сырых байт DEK в рабочий (non-extractable) CryptoKey для контента.
export async function importDek(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    raw as BufferSource,
    { name: 'AES-GCM' },
    false, // extractable=false
    ['encrypt', 'decrypt'],
  )
}

// ── KEK ──────────────────────────────────────────────────────────────────

// Выводит ключ-обёртку из секрета. secret — это либо строка PIN, либо
// нормализованная recovery-фраза. salt — своя на каждый способ (pin_salt /
// recovery_salt). Высокая энтропия фразы (128 бит) делает для неё число
// итераций некритичным, но единый код-путь проще ревьюить; стоимость
// платится редко (только на unlock/recovery).
export async function deriveKek(secret: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret + KEK_INFO),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: KEK_ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'], // KEK и оборачивает, и разворачивает DEK
  )
}

// ── wrap / unwrap DEK ──────────────────────────────────────────────────────

// Оборачивает сырые байты DEK ключом KEK. Возврат — base64(iv ‖ ciphertext),
// самодостаточная строка (IV внутри). Кладётся в profiles / IndexedDB.
export async function wrapDek(kek: CryptoKey, dekRaw: Uint8Array): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, dekRaw as BufferSource)
  return pack(iv, new Uint8Array(ct))
}

// Разворачивает DEK в СЫРЫЕ байты. Если KEK неверный (не тот PIN / не та
// фраза) — AES-GCM не сойдётся по тегу и subtle.decrypt бросит. Это и есть
// проверка «правильный ли секрет»: ловим throw у вызывающего.
// Сырые байты нужны, когда DEK предстоит перевернуть под другим секретом
// (восстановление по фразе → задать новый PIN). Для обычного unlock используй
// unwrapDek (отдаёт сразу CryptoKey, без болтающихся байт).
export async function unwrapDekRaw(kek: CryptoKey, wrappedB64: string): Promise<Uint8Array> {
  const { iv, ct } = unpack(wrappedB64)
  const raw = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    kek,
    ct as BufferSource,
  )
  return new Uint8Array(raw)
}

// Разворачивает DEK сразу в рабочий CryptoKey (обычный unlock).
export async function unwrapDek(kek: CryptoKey, wrappedB64: string): Promise<CryptoKey> {
  return importDek(await unwrapDekRaw(kek, wrappedB64))
}

// ── Шифрование текстовых полей (encrypted_content: подпись фото / заметка) ──

export async function encryptText(dek: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    dek,
    enc.encode(plaintext) as BufferSource,
  )
  return pack(iv, new Uint8Array(ct))
}

export async function decryptText(dek: CryptoKey, blobB64: string): Promise<string> {
  const { iv, ct } = unpack(blobB64)
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    dek,
    ct as BufferSource,
  )
  return dec.decode(pt)
}

// ── Шифрование бинарных блобов (медиа «Пути»: фото, голос) ───────────────────
//
// Отличие от encryptText: IV возвращается ОТДЕЛЬНО, не упакован в шифротекст.
// Так нужно, потому что схема path_entries хранит media_iv отдельной колонкой,
// а сам шифроблоб — файлом в Storage. Новый IV на каждый файл (вызывающий не
// должен переиспользовать) — это и даёт AES-GCM стойкость.

// Возврат типизируем как Uint8Array<ArrayBuffer> (не голый Uint8Array): иначе TS
// расширяет до ArrayBufferLike, и значение не лезет в BlobPart при сборке Blob.
export async function encryptBytes(
  dek: CryptoKey,
  data: Uint8Array,
): Promise<{ iv: Uint8Array<ArrayBuffer>; ciphertext: Uint8Array<ArrayBuffer> }> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    dek,
    data as BufferSource,
  )
  return { iv, ciphertext: new Uint8Array(ct) }
}

export async function decryptBytes(
  dek: CryptoKey,
  iv: Uint8Array,
  ciphertext: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    dek,
    ciphertext as BufferSource,
  )
  return new Uint8Array(pt)
}

// ── base64(iv ‖ ct) упаковка ────────────────────────────────────────────────

function pack(iv: Uint8Array, ct: Uint8Array): string {
  const out = new Uint8Array(iv.length + ct.length)
  out.set(iv, 0)
  out.set(ct, iv.length)
  return bytesToBase64(out)
}

function unpack(b64: string): { iv: Uint8Array; ct: Uint8Array } {
  const bytes = base64ToBytes(b64)
  return { iv: bytes.slice(0, IV_BYTES), ct: bytes.slice(IV_BYTES) }
}
