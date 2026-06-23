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
  unwrapDek,
  unwrapDekRaw,
  wrapDek,
  type Dek,
} from './envelope'
import { generateSalt, bytesToBase64, base64ToBytes } from './pin'
import { generateRecoveryPhrase, normalizeRecoveryPhrase } from './recovery'
import { markUnlocked } from './session'
import { PinStorage } from './storage'

/**
 * Первичная настройка хранилища при создании PIN.
 *
 * Генерит случайный DEK и recovery-фразу, оборачивает DEK двумя ключами:
 *   • под PIN  → кладём локально (IndexedDB)
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

  // — Локальная обёртка под PIN —
  const pinSalt = generateSalt()
  const kekPin = await deriveKek(pin, pinSalt)
  const wrappedPin = await wrapDek(kekPin, dek.raw)

  // — Серверная обёртка под recovery-фразой —
  const recoverySalt = generateSalt()
  const kekPhrase = await deriveKek(normalizeRecoveryPhrase(phrase), recoverySalt)
  const wrappedRecovery = await wrapDek(kekPhrase, dek.raw)

  // Сначала серверный якорь — если упадёт, не оставляем половинчатое состояние
  // (локальная обёртка без возможности восстановления).
  await writeRecoveryAnchor(bytesToBase64(recoverySalt), wrappedRecovery)

  await PinStorage.writeCryptoSalt(bytesToBase64(pinSalt))
  await PinStorage.writeWrappedDek(wrappedPin)
  // Ключ только что сгенерён и ещё не сохранён юзером → напоминаем.
  await PinStorage.setRecoveryAck(false)

  markUnlocked(dek.key)
  return phrase
}

/**
 * Разблокировка на ЭТОМ устройстве: PIN → локальная обёртка → DEK в память.
 * Возвращает true при успехе. Неверный PIN → unwrap бросит (ловим, false).
 *
 * null-возврат (не bool) если локальной обёртки нет вовсе — значит на этом
 * устройстве envelope ещё не настроен (старый PIN с этапа 0): вызывающий
 * должен запустить ленивый бэкфилл (setupVault) после верификации PIN.
 */
export async function unlockWithPin(pin: string): Promise<'ok' | 'wrong' | 'no_vault'> {
  const saltB64 = await PinStorage.readCryptoSalt()
  const wrappedPin = await PinStorage.readWrappedDek()
  if (!saltB64 || !wrappedPin) return 'no_vault'

  try {
    const kekPin = await deriveKek(pin, base64ToBytes(saltB64))
    const dekKey = await unwrapDek(kekPin, wrappedPin)
    markUnlocked(dekKey)
    return 'ok'
  } catch {
    // AES-GCM не сошёлся по тегу → неверный PIN.
    return 'wrong'
  }
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
 * читаемым, переворачивается только PIN-обёртка. dek берём из recoverWithPhrase.
 */
export async function setLocalPin(dek: Dek, newPin: string): Promise<void> {
  const pinSalt = generateSalt()
  const kekPin = await deriveKek(newPin, pinSalt)
  const wrappedPin = await wrapDek(kekPin, dek.raw)
  await PinStorage.writeCryptoSalt(bytesToBase64(pinSalt))
  await PinStorage.writeWrappedDek(wrappedPin)
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
    })
    .eq('id', user.id)

  if (error) throw new Error(`recovery_anchor_write_failed: ${error.message}`)
}

async function readRecoveryAnchor(): Promise<{ recoverySalt: string; wrappedRecovery: string } | null> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase
    .from('profiles')
    .select('recovery_salt, dek_wrapped_recovery')
    .eq('id', user.id)
    .maybeSingle()

  if (error || !data || !data.recovery_salt || !data.dek_wrapped_recovery) return null
  return { recoverySalt: data.recovery_salt, wrappedRecovery: data.dek_wrapped_recovery }
}
