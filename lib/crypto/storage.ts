// IndexedDB для хранения PIN-хэша и сопутствующих данных.
// Только клиент — IndexedDB на сервере не существует. Все вызывающие должны
// быть в 'use client' компонентах.
//
// Структура: одна БД "numia", один store "auth" (key-value).
// Поля:
//   pin_hash         — base64 от PBKDF2 хэша
//   pin_salt         — base64 от соли для верификации
//   pin_crypto_salt  — base64 от соли для деривации KEK_pin (envelope, локально)
//   dek_wrapped_pin  — base64(iv‖ct): DEK, обёрнутый ключом из PIN (envelope)
//   kdf_iterations   — итерации PBKDF2, которыми создан ВЕСЬ набор выше
//                      (hash И обёртка). Отсутствует = legacy 210k. Пишется
//                      ТОЛЬКО атомарно вместе с набором (writeLocalVault) —
//                      иначе рассинхрон «hash на одних итерациях, обёртка на
//                      других» ломает вход при верном PIN.
//   recovery_ack     — boolean: сохранил ли юзер recovery-ключ (для напоминания)
//   pin_created_at   — timestamp (number) когда PIN был создан
//   failed_attempts  — счётчик неудачных попыток unlock (для soft-lockout)
//   lockout_until    — timestamp (ms): до этого момента ввод PIN на паузе
//                      (нарастающий backoff после серии неверных попыток)
//   bio_credential_id — base64 rawId passkey для биометрии (WebAuthn)
//   bio_prf_salt      — base64 соли для PRF-eval этого passkey
//   dek_wrapped_bio   — base64(iv‖ct): DEK под ключом из PRF-вывода passkey
//                       (см. lib/crypto/biometric.ts — третья обёртка DEK,
//                       живёт ТОЛЬКО локально, как и PIN-обёртка)
//
// ВАЖНО про envelope (см. lib/crypto/envelope.ts): обёртка DEK под PIN
// (dek_wrapped_pin) и соль PIN живут ТОЛЬКО здесь, локально. На сервере их
// держать нельзя — 6-значный PIN перебираем оффлайн при утечке БД. Серверный
// якорь — это обёртка под recovery-фразой (profiles.dek_wrapped_recovery).

const DB_NAME = 'numia'
const DB_VERSION = 1
const STORE = 'auth'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE)
      }
    }
  })

  return dbPromise
}

async function getItem<T = unknown>(key: string): Promise<T | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(key)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve((req.result ?? null) as T | null)
  })
}

async function setItem(key: string, value: unknown): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const req = tx.objectStore(STORE).put(value, key)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve()
  })
}

async function removeItem(key: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const req = tx.objectStore(STORE).delete(key)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve()
  })
}

// Несколько put в ОДНОЙ транзакции — атомарно (все или ничего). Нужно для
// записи связного набора PIN-артефактов: частичная запись при обрыве оставила
// бы хранилище в состоянии, где верный PIN не проходит.
async function setItems(entries: Record<string, unknown>): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    for (const [key, value] of Object.entries(entries)) store.put(value, key)
    tx.onerror = () => reject(tx.error)
    tx.oncomplete = () => resolve()
  })
}

// Доменные хелперы — всё что надо вызывающим компонентам.
// Низкоуровневые get/set/remove оставлены приватными — чтобы случайно не появилось
// разнотык в названиях ключей в разных местах кодовой базы.
export const PinStorage = {
  async hasPin(): Promise<boolean> {
    return (await getItem('pin_hash')) !== null
  },

  // iterations: null — набор создан до версионирования (legacy 210k);
  // интерпретация legacy-значения — на вызывающем (LEGACY_KDF_ITERATIONS).
  async readPin(): Promise<{ hash: string; salt: string; iterations: number | null } | null> {
    const hash = await getItem<string>('pin_hash')
    const salt = await getItem<string>('pin_salt')
    if (!hash || !salt) return null
    return { hash, salt, iterations: await getItem<number>('kdf_iterations') }
  },

  async readKdfIterations(): Promise<number | null> {
    return await getItem<number>('kdf_iterations')
  },

  /**
   * ЕДИНСТВЕННЫЙ способ записать локальный PIN-набор — целиком и атомарно
   * (одна IndexedDB-транзакция): verify-хэш, обе соли, обёртка DEK и итерации,
   * которыми всё это создано. Частичной записи не бывает by construction.
   * Вызывается из vault.ts (setup / setLocalPin / lazy-апгрейд итераций).
   */
  async writeLocalVault(v: {
    pinHashB64: string
    pinSaltB64: string
    cryptoSaltB64: string
    wrappedDekB64: string
    iterations: number
  }): Promise<void> {
    await setItems({
      pin_hash: v.pinHashB64,
      pin_salt: v.pinSaltB64,
      pin_crypto_salt: v.cryptoSaltB64,
      dek_wrapped_pin: v.wrappedDekB64,
      kdf_iterations: v.iterations,
      pin_created_at: Date.now(),
      failed_attempts: 0,
      lockout_until: 0, // новый набор = чистый лист, пауза не переживает его
    })
  },

  async clearPin(): Promise<void> {
    await removeItem('pin_hash')
    await removeItem('pin_salt')
    await removeItem('pin_created_at')
    await removeItem('pin_crypto_salt')
    await removeItem('dek_wrapped_pin')
    await removeItem('kdf_iterations')
    await removeItem('recovery_ack')
    await removeItem('failed_attempts')
    await removeItem('lockout_until')
    // Биометрию сносим вместе с PIN-набором: её обёртка разворачивает ТОТ ЖЕ
    // DEK, и после «Сбросить всё» она открывала бы контент, который юзер
    // считает сброшенным. Новый vault → биометрию включают заново в настройках.
    await PinStorage.clearBio()
  },

  // ── Биометрия (passkey + PRF, см. lib/crypto/biometric.ts) ────────────────

  /**
   * Записать bio-набор целиком и атомарно (одна транзакция): credential id,
   * PRF-соль и обёртку DEK. Частичный набор бесполезен и ломал бы unlock.
   */
  async writeBioVault(v: {
    credentialIdB64: string
    prfSaltB64: string
    wrappedDekB64: string
  }): Promise<void> {
    await setItems({
      bio_credential_id: v.credentialIdB64,
      bio_prf_salt: v.prfSaltB64,
      dek_wrapped_bio: v.wrappedDekB64,
    })
  },

  async readBioVault(): Promise<{
    credentialIdB64: string
    prfSaltB64: string
    wrappedDekB64: string
  } | null> {
    const credentialIdB64 = await getItem<string>('bio_credential_id')
    const prfSaltB64 = await getItem<string>('bio_prf_salt')
    const wrappedDekB64 = await getItem<string>('dek_wrapped_bio')
    if (!credentialIdB64 || !prfSaltB64 || !wrappedDekB64) return null
    return { credentialIdB64, prfSaltB64, wrappedDekB64 }
  },

  async clearBio(): Promise<void> {
    await removeItem('bio_credential_id')
    await removeItem('bio_prf_salt')
    await removeItem('dek_wrapped_bio')
  },

  async readCryptoSalt(): Promise<string | null> {
    return await getItem<string>('pin_crypto_salt')
  },

  async readWrappedDek(): Promise<string | null> {
    return await getItem<string>('dek_wrapped_pin')
  },

  // Сохранил ли юзер recovery-ключ. false → показываем мягкое напоминание.
  // Дефолт true, чтобы у юзеров без envelope (до этой фичи) баннер не висел —
  // его выставит в false только setupVault, когда ключ реально сгенерён.
  async setRecoveryAck(ack: boolean): Promise<void> {
    await setItem('recovery_ack', ack)
  },

  async getRecoveryAck(): Promise<boolean> {
    return (await getItem<boolean>('recovery_ack')) ?? true
  },

  async getFailedAttempts(): Promise<number> {
    return (await getItem<number>('failed_attempts')) ?? 0
  },

  async incrementFailedAttempts(): Promise<number> {
    const n = ((await getItem<number>('failed_attempts')) ?? 0) + 1
    await setItem('failed_attempts', n)
    return n
  },

  async resetFailedAttempts(): Promise<void> {
    await setItem('failed_attempts', 0)
    await removeItem('lockout_until')
  },

  // Пауза ввода PIN (soft-lockout). Переживает reload — лежит в IndexedDB.
  // Обход через очистку IndexedDB не помогает атакующему: вместе с паузой
  // сотрётся и обёртка DEK — расшифровать станет нечем без recovery-ключа.
  async getLockoutUntil(): Promise<number | null> {
    return await getItem<number>('lockout_until')
  },

  async setLockoutUntil(ts: number): Promise<void> {
    await setItem('lockout_until', ts)
  },
}
