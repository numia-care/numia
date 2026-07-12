// Биометрический анлок (Face ID / Touch ID / Windows Hello): passkey
// (WebAuthn) с PRF-extension как ТРЕТЬЯ обёртка DEK.
//
// ── Как это устроено (см. envelope.ts — там схема обёрток) ──
//
// PRF-extension: passkey умеет детерминированно вывести 32 байта из пары
// (credential, соль), и аутентификатор отдаёт этот вывод только после
// user verification — то есть после биометрии. Это криптографический гейт:
// без пройденного Face ID PRF-вывода не существует, а без него обёртка
// dek_wrapped_bio — шум.
//
//   KEK_bio = HKDF(PRF-вывод, info='numia-kek-bio-v1')   ← без PBKDF2:
//     PRF-вывод — 256 бит настоящей энтропии, это не 6-значный PIN
//   dek_wrapped_bio = AES-GCM(KEK_bio, DEK)
//
// ── Что где лежит ──
//
// ВСЁ локально, в IndexedDB (PinStorage): credential id, PRF-соль, обёртка.
// На сервере — ничего: биометрия, как и PIN, чисто локальный разблокиратор.
// Серверной WebAuthn-церемонии нет — мы не аутентифицируемся к серверу
// (это делает magic link), поэтому challenge случайный клиентский,
// attestation 'none'. Passkey синхронизируется iCloud Keychain на другие
// устройства юзера — там он безвреден: локальной обёртки нет, разворачивать
// нечего. Кросс-девайс — по-прежнему через recovery-фразу.
//
// ── Ограничения платформ (проверено 2026-07) ──
//
// iOS: PRF работает с Safari 18.4+, только платформенные passkey (iCloud
// Keychain включён). Смена домена = RP ID = все credentials мёртвые →
// повторное включение биометрии. navigator.credentials.get/create требуют
// user gesture — вызывать только из обработчиков тапа.
//
// Только клиент (WebAuthn + IndexedDB) — вызывать из 'use client' кода.

import { createClient } from '@/lib/supabase/client'

import { importDek, unwrapDekRaw, wrapDek, type Dek } from './envelope'
import { base64ToBytes, bytesToBase64 } from './pin'
import { markUnlocked } from './session'
import { PinStorage } from './storage'
import { unwrapDekRawWithPin } from './vault'

// info-тег отделяет домен KEK_bio от остальных ключей (ср. KEK_INFO в
// envelope.ts). Менять нельзя — старые обёртки перестанут разворачиваться.
const BIO_KEK_INFO = 'numia-kek-bio-v1'
const PRF_SALT_BYTES = 32
const WEBAUTHN_TIMEOUT_MS = 60_000

// В lib.dom типы PRF-extension появились недавно и зависят от версии TS —
// объявляем свои узкие формы и кастуем через них, чтобы не зависеть от этого.
type PrfInputs = { prf?: { eval?: { first: BufferSource } } }
type PrfCreateOutputs = { prf?: { enabled?: boolean } }
type PrfGetOutputs = { prf?: { results?: { first?: ArrayBuffer } } }

/**
 * Доступна ли биометрия с PRF на этом устройстве/браузере.
 *   'yes'     — платформенный аутентификатор есть и PRF заявлен
 *   'no'      — точно нет (нет WebAuthn / нет биометрии / PRF заявлен как нет)
 *   'unknown' — аутентификатор есть, но браузер не умеет сказать про PRF
 *               (старый API) — можно показать тумблер и дать enroll'у самому
 *               выяснить (вернёт 'prf_unsupported')
 */
export async function detectBiometricSupport(): Promise<'yes' | 'no' | 'unknown'> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) return 'no'

  try {
    const available =
      await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
    if (!available) return 'no'
  } catch {
    return 'no'
  }

  // getClientCapabilities есть в Safari 17.4+/Chrome 133+; в старых браузерах
  // — нет, тогда честно 'unknown' (узнаем при попытке включить).
  const pkc = PublicKeyCredential as unknown as {
    getClientCapabilities?: () => Promise<Record<string, boolean | undefined>>
  }
  if (typeof pkc.getClientCapabilities === 'function') {
    try {
      const caps = await pkc.getClientCapabilities()
      const prf = caps['extension:prf']
      if (prf === true) return 'yes'
      if (prf === false) return 'no'
    } catch {
      // API есть, но упал — не блокируем, считаем неизвестным.
    }
  }
  return 'unknown'
}

export type EnrollBiometricResult =
  | 'ok'
  | 'wrong_pin' // PIN не подошёл — UI решает про счётчик попыток/lockout
  | 'no_vault' // на устройстве нет envelope (PIN этапа 0) — сначала бэкфилл
  | 'prf_unsupported' // passkey создался, но PRF не дал — см. комментарий ниже
  | 'cancelled' // юзер закрыл системный шит
  | 'failed'

/**
 * Включить биометрию: PIN → сырые байты DEK → passkey → PRF → обёртка.
 *
 * PIN обязателен по двум причинам сразу: (1) подтверждение владельца перед
 * добавлением нового способа входа; (2) в памяти сессии DEK лежит
 * non-extractable — сырые байты для новой обёртки достаются только
 * разворачиванием PIN-обёртки.
 *
 * UX: системный шит биометрии покажется ДВАЖДЫ (create + get) — PRF-вывод
 * браузер отдаёт только на get(). Предупредить в UI до старта.
 *
 * ВАЖНО (для UI дроби 2): при 'wrong_pin' вызывающий должен уважать ту же
 * lockout-механику, что экран входа (PinStorage.incrementFailedAttempts и
 * т.д.) — иначе диалог включения биометрии станет обходом перебора PIN.
 *
 * При 'prf_unsupported' passkey уже мог создаться, а удалить его программно
 * WebAuthn не позволяет — он останется в системном менеджере паролей
 * бесполезным (ничего не гейтит). Копи в UI: удалить можно в настройках ОС.
 */
export async function enrollBiometric(pin: string): Promise<EnrollBiometricResult> {
  const unwrapped = await unwrapDekRawWithPin(pin)
  if (unwrapped === 'wrong') return 'wrong_pin'
  if (unwrapped === 'no_vault') return 'no_vault'

  // user.id Supabase как стабильный user.id passkey: повторное включение
  // ПЕРЕЗАПИСЫВАЕТ старый passkey этого аккаунта в iCloud, а не плодит новые.
  // UUID случайный, ничего личного в системный менеджер паролей не утекает.
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return 'failed'

  try {
    const credential = (await navigator.credentials.create({
      publicKey: {
        rp: { name: 'Numia' }, // rp.id по умолчанию = текущий домен
        user: {
          id: new TextEncoder().encode(user.id) as BufferSource,
          name: 'Numia',
          displayName: 'Numia',
        },
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 }, // ES256
          { type: 'public-key', alg: -257 }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform', // только встроенная биометрия
          residentKey: 'required',
          userVerification: 'required', // биометрия и есть гейт
        },
        extensions: { prf: {} } as PrfInputs,
        attestation: 'none',
        timeout: WEBAUTHN_TIMEOUT_MS,
      },
    })) as PublicKeyCredential | null
    if (!credential) return 'failed'

    const created = credential.getClientExtensionResults() as PrfCreateOutputs
    if (!created.prf?.enabled) return 'prf_unsupported'

    // Сразу assertion — PRF-вывод доступен только на get(). Второй шит.
    const prfSalt = crypto.getRandomValues(new Uint8Array(PRF_SALT_BYTES))
    const prfOutput = await evalPrf(credential.rawId, prfSalt)
    if (!prfOutput) return 'prf_unsupported'

    const kek = await deriveBioKek(prfOutput)
    const wrapped = await wrapDek(kek, unwrapped.raw)

    await PinStorage.writeBioVault({
      credentialIdB64: bytesToBase64(new Uint8Array(credential.rawId)),
      prfSaltB64: bytesToBase64(prfSalt),
      wrappedDekB64: wrapped,
    })
    return 'ok'
  } catch (e) {
    if (isUserCancel(e)) return 'cancelled'
    console.error('biometric enroll failed:', e)
    return 'failed'
  }
}

export type BiometricUnlockResult =
  | { status: 'ok'; dek: Dek }
  | { status: 'no_bio' | 'cancelled' | 'failed' }

/**
 * Разблокировка биометрией: passkey-assertion → PRF → развернуть DEK →
 * пометить сессию. Возвращает Dek С СЫРЫМИ БАЙТАМИ — как recoverWithPhrase:
 * поток «не помню PIN, но Face ID работает» (дробь 3) сразу переворачивает
 * DEK под новый PIN через setLocalPin. Обычный unlock байты игнорирует.
 *
 * Вызывать только из обработчика тапа (user gesture — требование WebAuthn).
 * 'failed' при живом bio-наборе — повод предложить выключить/включить
 * биометрию заново (например, passkey удалили из системных настроек).
 */
export async function unlockWithBiometric(): Promise<BiometricUnlockResult> {
  const vault = await PinStorage.readBioVault()
  if (!vault) return { status: 'no_bio' }

  try {
    const prfOutput = await evalPrf(
      base64ToBytes(vault.credentialIdB64) as BufferSource,
      base64ToBytes(vault.prfSaltB64),
    )
    if (!prfOutput) return { status: 'failed' }

    const kek = await deriveBioKek(prfOutput)
    // Битая/чужая обёртка → AES-GCM бросит по тегу → catch → 'failed'.
    const raw = await unwrapDekRaw(kek, vault.wrappedDekB64)
    const key = await importDek(raw)
    markUnlocked(key)
    return { status: 'ok', dek: { key, raw } }
  } catch (e) {
    if (isUserCancel(e)) return { status: 'cancelled' }
    console.error('biometric unlock failed:', e)
    return { status: 'failed' }
  }
}

/**
 * Выключить биометрию: снести локальный bio-набор. Сам passkey из iCloud /
 * системного менеджера программно не удалить (WebAuthn не даёт API) — он
 * остаётся там безвредным: без локальной обёртки он ничего не гейтит.
 * Копи в UI: удалить запись можно в Настройки → Пароли.
 */
export async function disableBiometric(): Promise<void> {
  await PinStorage.clearBio()
}

/** Включена ли биометрия на ЭТОМ устройстве (есть ли полный bio-набор). */
export async function isBiometricEnrolled(): Promise<boolean> {
  return (await PinStorage.readBioVault()) !== null
}

// ── внутренности ────────────────────────────────────────────────────────────

/** Assertion с PRF-eval: биометрия → 32 байта PRF-вывода (или null). */
async function evalPrf(
  credentialId: BufferSource,
  salt: Uint8Array,
): Promise<ArrayBuffer | null> {
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: 'public-key', id: credentialId }],
      userVerification: 'required',
      extensions: { prf: { eval: { first: salt as BufferSource } } } as PrfInputs,
      timeout: WEBAUTHN_TIMEOUT_MS,
    },
  })) as PublicKeyCredential | null
  if (!assertion) return null

  const results = assertion.getClientExtensionResults() as PrfGetOutputs
  return results.prf?.results?.first ?? null
}

/** PRF-вывод → AES-GCM KEK через HKDF (соль не нужна: вход уже равномерный). */
async function deriveBioKek(prfOutput: ArrayBuffer): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', prfOutput, 'HKDF', false, [
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0) as BufferSource,
      info: new TextEncoder().encode(BIO_KEK_INFO) as BufferSource,
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** Юзер закрыл системный шит / таймаут — не ошибка, а отмена. */
function isUserCancel(e: unknown): boolean {
  return (
    e instanceof DOMException &&
    (e.name === 'NotAllowedError' || e.name === 'AbortError')
  )
}
