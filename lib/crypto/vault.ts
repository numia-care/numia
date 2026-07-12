// Оркестрация E2E-доступа: связывает envelope-примитивы (envelope.ts) с
// хранилищами (IndexedDB через storage.ts, profiles через Supabase) и сессией
// (session.ts). Высокоуровневые операции: setup / unlock / recover.
//
// Где что лежит (см. CLAUDE.md, миграцию 20260623):
//   локально (IndexedDB):  соль PIN  + dek_wrapped_pin       — слабый секрет
//   на сервере (profiles): recovery_salt + dek_wrapped_recovery — сильный якорь
//
// Только клиент: Web Crypto + IndexedDB + браузерный Supabase-клиент.

import { createClient } from '@/lib/supabase/client'

import {
  deriveKek,
  generateDek,
  importDek,
  unwrapDekRaw,
  wrapDek,
  type Dek,
} from './envelope'
import {
  generateSalt,
  bytesToBase64,
  base64ToBytes,
  hashPin,
  KDF_ITERATIONS,
  LEGACY_KDF_ITERATIONS,
} from './pin'
import { generateRecoveryPhrase, normalizeRecoveryPhrase } from './recovery'
import { markUnlocked } from './session'
import { PinStorage } from './storage'

/**
 * Собрать и атомарно записать ПОЛНЫЙ локальный PIN-набор (verify-хэш + соли +
 * обёртка DEK + итерации) на текущих KDF-параметрах. Единственный код-путь
 * записи набора — исключает рассинхрон «хэш на одних итерациях, обёртка на
 * других» (он ломал бы вход при верном PIN).
 */
async function writeLocalPinArtifacts(pin: string, dekRaw: Uint8Array): Promise<void> {
  const verifySalt = generateSalt()
  const cryptoSalt = generateSalt()
  const [hash, kekPin] = await Promise.all([
    hashPin(pin, verifySalt, KDF_ITERATIONS),
    deriveKek(pin, cryptoSalt, KDF_ITERATIONS),
  ])
  const wrappedPin = await wrapDek(kekPin, dekRaw)

  await PinStorage.writeLocalVault({
    pinHashB64: bytesToBase64(hash),
    pinSaltB64: bytesToBase64(verifySalt),
    cryptoSaltB64: bytesToBase64(cryptoSalt),
    wrappedDekB64: wrappedPin,
    iterations: KDF_ITERATIONS,
  })
}

/**
 * Первичная настройка хранилища при создании PIN.
 *
 * Генерит случайный DEK и recovery-фразу, оборачивает DEK двумя ключами:
 *   • под PIN  → кладём локально (IndexedDB), ВМЕСТЕ с verify-хэшем PIN —
 *     весь набор одной атомарной записью (writeLocalPinArtifacts)
 *   • под фразой → кладём на сервер (profiles) как якорь восстановления
 * Помечает сессию разблокированной (DEK в памяти) и ВОЗВРАЩАЕТ фразу —
 * показать юзеру один раз. Фразу нигде не сохраняем сами.
 *
 * Бросает, если серверный якорь записать не удалось: без него забытый PIN =
 * безвозвратная потеря данных, так что молча продолжать нельзя.
 */
export async function setupVault(pin: string): Promise<string> {
  const phrase = generateRecoveryPhrase()
  const dek = await generateDek()

  // — Серверная обёртка под recovery-фразой —
  const recoverySalt = generateSalt()
  const kekPhrase = await deriveKek(normalizeRecoveryPhrase(phrase), recoverySalt)
  const wrappedRecovery = await wrapDek(kekPhrase, dek.raw)

  // Сначала серверный якорь — если упадёт, не оставляем половинчатое состояние
  // (локальная обёртка без возможности восстановления).
  await writeRecoveryAnchor(bytesToBase64(recoverySalt), wrappedRecovery)

  // — Локальный набор под PIN (хэш + соли + обёртка + итерации, атомарно) —
  await writeLocalPinArtifacts(pin, dek.raw)
  // Ключ только что сгенерён и ещё не сохранён юзером → напоминаем.
  await PinStorage.setRecoveryAck(false)

  markUnlocked(dek.key)
  return phrase
}

/**
 * PIN → сырые байты DEK, без побочных эффектов (сессию не трогает).
 *
 * ОСТОРОЖНО с raw: этот экспорт — для потоков, которым нужно ПЕРЕобернуть
 * DEK новым секретом (unlockWithPin с ленивым KDF-апгрейдом, регистрация
 * биометрии в biometric.ts). Для обычного «проверить и войти» используй
 * unlockWithPin. iterations в ответе — какими итерациями был создан набор
 * (нужно вызывающему, чтобы решить, пора ли апгрейдить).
 */
export async function unwrapDekRawWithPin(
  pin: string,
): Promise<{ raw: Uint8Array; iterations: number } | 'wrong' | 'no_vault'> {
  const saltB64 = await PinStorage.readCryptoSalt()
  const wrappedPin = await PinStorage.readWrappedDek()
  if (!saltB64 || !wrappedPin) return 'no_vault'

  // Итерации, которыми создан ЭТОТ набор (null = legacy 210k, до
  // версионирования). Разворачиваем строго ими — не текущей константой.
  const iterations = (await PinStorage.readKdfIterations()) ?? LEGACY_KDF_ITERATIONS

  try {
    const kekPin = await deriveKek(pin, base64ToBytes(saltB64), iterations)
    return { raw: await unwrapDekRaw(kekPin, wrappedPin), iterations }
  } catch {
    // AES-GCM не сошёлся по тегу → неверный PIN.
    return 'wrong'
  }
}

/**
 * Разблокировка на ЭТОМ устройстве: PIN → локальная обёртка → DEK в память.
 *
 * 'no_vault' — локальной обёртки нет вовсе: на этом устройстве envelope ещё
 * не настроен (старый PIN с этапа 0), вызывающий должен запустить ленивый
 * бэкфилл (setupVault) после верификации PIN.
 */
export async function unlockWithPin(pin: string): Promise<'ok' | 'wrong' | 'no_vault'> {
  const unwrapped = await unwrapDekRawWithPin(pin)
  if (unwrapped === 'wrong' || unwrapped === 'no_vault') return unwrapped

  markUnlocked(await importDek(unwrapped.raw))

  // Ленивый апгрейд KDF-параметров: PIN верный, DEK в руках → переворачиваем
  // весь локальный набор на текущие итерации (атомарно). Ошибка апгрейда не
  // мешает входу — попробуем в следующий раз.
  if (unwrapped.iterations !== KDF_ITERATIONS) {
    try {
      await writeLocalPinArtifacts(pin, unwrapped.raw)
    } catch (e) {
      console.error('kdf upgrade failed (will retry on next unlock):', e)
    }
  }

  return 'ok'
}

/**
 * Восстановление по recovery-фразе (забытый PIN / новое устройство):
 * фраза + серверный якорь → DEK. Помечает сессию разблокированной и
 * ВОЗВРАЩАЕТ Dek (с сырыми байтами), чтобы вызывающий сразу перевернул его под
 * новым PIN через setLocalPin. Бросает, если якоря нет или фраза неверная.
 */
export async function recoverWithPhrase(phrase: string): Promise<Dek> {
  const anchor = await readRecoveryAnchor()
  if (!anchor) throw new Error('no_recovery_anchor')

  const kekPhrase = await deriveKek(
    normalizeRecoveryPhrase(phrase),
    base64ToBytes(anchor.recoverySalt),
    // Итерации, которыми создан якорь (null = legacy 210k). Для 128-битной
    // фразы разница некритична (перебор невозможен при любых), но развернуть
    // обёртку можно только теми же параметрами, что её создали.
    anchor.kdfIterations ?? LEGACY_KDF_ITERATIONS,
  )
  // Неверная фраза → unwrapDekRaw бросит (AES-GCM tag mismatch).
  const raw = await unwrapDekRaw(kekPhrase, anchor.wrappedRecovery)
  const key = await importDek(raw)
  markUnlocked(key)
  return { key, raw }
}

/**
 * Задать новый локальный PIN поверх того же DEK (после восстановления по
 * фразе или на новом устройстве). DEK не меняется → весь контент остаётся
 * читаемым, переворачивается только локальный набор (хэш + обёртка, атомарно,
 * на текущих итерациях). dek берём из recoverWithPhrase.
 */
export async function setLocalPin(dek: Dek, newPin: string): Promise<void> {
  await writeLocalPinArtifacts(newPin, dek.raw)
}

/**
 * Есть ли на сервере якорь восстановления. true → vault уже настраивался
 * (хотя бы на одном устройстве), значит НЕЛЬЗЯ генерить новый DEK через
 * setupVault — он осиротит существующий E2E-контент и повторно покажет ключ.
 * В таком случае доступ возвращают по recovery-фразе (recoverWithPhrase).
 */
export async function hasRemoteVault(): Promise<boolean> {
  return (await readRecoveryAnchor()) !== null
}

// ── Supabase helpers: серверный якорь в profiles ────────────────────────────

async function writeRecoveryAnchor(recoverySaltB64: string, wrappedRecoveryB64: string): Promise<void> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('not_authenticated')

  const { error } = await supabase
    .from('profiles')
    .update({
      recovery_salt: recoverySaltB64,
      dek_wrapped_recovery: wrappedRecoveryB64,
      // Итерации, которыми обёрнут якорь, — чтобы новое устройство знало, как
      // его развернуть (см. миграцию recovery_kdf_iterations).
      recovery_kdf_iterations: KDF_ITERATIONS,
    })
    .eq('id', user.id)

  if (error) throw new Error(`recovery_anchor_write_failed: ${error.message}`)
}

async function readRecoveryAnchor(): Promise<{
  recoverySalt: string
  wrappedRecovery: string
  kdfIterations: number | null // null = якорь legacy (210k)
} | null> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase
    .from('profiles')
    .select('recovery_salt, dek_wrapped_recovery, recovery_kdf_iterations')
    .eq('id', user.id)
    .maybeSingle()

  if (error || !data || !data.recovery_salt || !data.dek_wrapped_recovery) return null
  return {
    recoverySalt: data.recovery_salt,
    wrappedRecovery: data.dek_wrapped_recovery,
    kdfIterations: data.recovery_kdf_iterations,
  }
}
