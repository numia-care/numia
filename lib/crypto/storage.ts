// IndexedDB для хранения PIN-хэша и сопутствующих данных.
// Только клиент — IndexedDB на сервере не существует. Все вызывающие должны
// быть в 'use client' компонентах.
//
// Структура: одна БД "numia", один store "auth" (key-value).
// Поля:
//   pin_hash         — base64 от PBKDF2 хэша
//   pin_salt         — base64 от соли для верификации
//   pin_crypto_salt  — base64 от соли для деривации crypto-ключа (E2E этап 2+)
//   pin_created_at   — timestamp (number) когда PIN был создан
//   failed_attempts  — счётчик неудачных попыток unlock (для soft-lockout UX)

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

// Доменные хелперы — всё что надо вызывающим компонентам.
// Низкоуровневые get/set/remove оставлены приватными — чтобы случайно не появилось
// разнотык в названиях ключей в разных местах кодовой базы.
export const PinStorage = {
  async hasPin(): Promise<boolean> {
    return (await getItem('pin_hash')) !== null
  },

  async readPin(): Promise<{ hash: string; salt: string } | null> {
    const hash = await getItem<string>('pin_hash')
    const salt = await getItem<string>('pin_salt')
    if (!hash || !salt) return null
    return { hash, salt }
  },

  async writePin(hashB64: string, saltB64: string): Promise<void> {
    await setItem('pin_hash', hashB64)
    await setItem('pin_salt', saltB64)
    await setItem('pin_created_at', Date.now())
    await setItem('failed_attempts', 0)
  },

  async clearPin(): Promise<void> {
    await removeItem('pin_hash')
    await removeItem('pin_salt')
    await removeItem('pin_created_at')
    await removeItem('pin_crypto_salt')
    await removeItem('failed_attempts')
  },

  async writeCryptoSalt(saltB64: string): Promise<void> {
    await setItem('pin_crypto_salt', saltB64)
  },

  async readCryptoSalt(): Promise<string | null> {
    return await getItem<string>('pin_crypto_salt')
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
  },
}
