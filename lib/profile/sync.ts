// E2E-синхронизация профиля (имя + форма обращения) с сервером.
//
// Схема (миграция 20260715120000):
//   • profiles.profile_ciphertext — base64(iv‖ct): JSON профиля, зашифрованный
//     тем же DEK, что дневник и «Путь» (encryptText). Сервер видит шифроблок.
//   • localStorage (lib/profile/local.ts) — локальный КЭШ для мгновенного
//     приветствия. Источник правды — серверная копия.
//
// Потоки:
//   saveProfileLocal() — изменение в профиле: кэш + dirty-флаг, синхронно.
//     Вызывающий потом дёргает flushProfile (можно с дебаунсом — имя
//     печатается по букве, пушить каждый keystroke незачем).
//   flushProfile()     — если висит dirty: зашифровать и поднять на сервер.
//   syncProfile()      — после разблокировки: серверный блоб → расшифровать →
//     кэш (+ событие PROFILE_SYNCED_EVENT — уже отрисованное приветствие
//     обновится на живую). Если серверного нет, а локальный есть — мягкая
//     миграция: тихо поднимаем (юзеры со времён «профиль только в localStorage»).
//
// Оффлайн/сбой сети: пока dirty-флаг висит, syncProfile НЕ затирает кэш
// серверной (более старой) копией, а наоборот — допихивает локальную на
// сервер. Так правка, сделанная оффлайн, не теряется. Конфликты между
// устройствами не страшны: last-write-wins, это имя и одна опция.
//
// Только клиент: нужен DEK в памяти сессии (session.ts) и localStorage.

import { decryptText, encryptText } from '@/lib/crypto/envelope'
import { getCryptoKey } from '@/lib/crypto/session'
import { createClient } from '@/lib/supabase/client'

import {
  getAddressForm,
  getDisplayName,
  hasLocalProfile,
  setAddressForm,
  setDisplayName,
  type AddressForm,
} from './local'

// Висящая незапушенная локальная правка (оффлайн / сбой сети).
const DIRTY_KEY = 'numia_profile_dirty'

// Кэш обновлён из серверной копии — подписчики (приветствие на дашборде)
// перечитывают localStorage, не дожидаясь следующего рендера страницы.
export const PROFILE_SYNCED_EVENT = 'numia:profile-synced'

// Форма расшифрованного JSON. Объект (не голая строка) — чтобы будущие поля
// профиля не ломали старые записи (тот же приём, что EntryContent в lib/path).
interface ProfileContent {
  name?: string
  addressForm?: AddressForm
}

/**
 * Записать правку профиля в кэш (приветствие обновляется мгновенно) и пометить
 * dirty. На сервер само не пушит — вызывающий дёргает flushProfile, когда
 * правка «отстоялась» (дебаунс). Даже если flush не случится (вкладку закрыли),
 * правка не потеряна: dirty-флаг допушит её при следующем syncProfile.
 */
export function saveProfileLocal(p: {
  name: string
  addressForm: AddressForm
}): void {
  setDisplayName(p.name)
  setAddressForm(p.addressForm)
  localStorage.setItem(DIRTY_KEY, '1')
}

/** Допушить на сервер висящую локальную правку (no-op, если dirty нет). */
export async function flushProfile(): Promise<void> {
  if (typeof window === 'undefined') return
  if (!localStorage.getItem(DIRTY_KEY)) return
  if (await pushLocalProfile()) localStorage.removeItem(DIRTY_KEY)
}

/**
 * Синхронизация после разблокировки (DEK уже в памяти):
 *   1. Висит dirty-флаг → сначала допихиваем локальную правку на сервер
 *      (серверная копия старее, тянуть её поверх было бы потерей).
 *   2. Серверный блоб есть → расшифровать → обновить кэш → событие.
 *   3. Серверного нет, локальный есть → мягкая миграция: поднять на сервер.
 * Все исходы тихие: профиль — не критичный путь, при любом сбое приветствие
 * просто работает со старым кэшем. Без DEK (нет разблокировки) — no-op.
 */
export async function syncProfile(): Promise<void> {
  if (typeof window === 'undefined' || !getCryptoKey()) return

  try {
    if (localStorage.getItem(DIRTY_KEY)) {
      await flushProfile()
      return
    }

    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return

    const { data, error } = await supabase
      .from('profiles')
      .select('profile_ciphertext')
      .eq('id', user.id)
      .maybeSingle()
    if (error) return

    const ciphertext = data?.profile_ciphertext as string | null | undefined
    if (!ciphertext) {
      // Серверной копии ещё нет — мягкая миграция локального профиля, тихо.
      if (hasLocalProfile()) await pushLocalProfile()
      return
    }

    const dek = getCryptoKey()
    if (!dek) return
    let content: ProfileContent
    try {
      content = JSON.parse(await decryptText(dek, ciphertext)) as ProfileContent
    } catch {
      // Блоб не разворачивается текущим DEK — он от старого vault'а (юзер
      // делал «Сбросить всё»: DEK новый, серверный профиль остался от
      // прежнего). Самолечение: перезаписываем локальным под текущим DEK.
      if (hasLocalProfile()) await pushLocalProfile()
      return
    }

    // Серверная копия — источник правды: кладём в кэш (защитно валидируя:
    // JSON пришёл из шифроблоба, но форму всё равно сужаем до известных).
    setDisplayName(typeof content.name === 'string' ? content.name : '')
    const f = content.addressForm
    setAddressForm(f === 'she' || f === 'he' || f === 'they' ? f : 'neutral')
    window.dispatchEvent(new Event(PROFILE_SYNCED_EVENT))
  } catch (e) {
    // Сеть/прочее — не мешаем работе, кэш остаётся как был.
    console.error('profile sync failed:', e)
  }
}

// ── внутренности ─────────────────────────────────────────────────────────────

/** Зашифровать текущий локальный профиль и записать на сервер. false = не вышло. */
async function pushLocalProfile(): Promise<boolean> {
  const dek = getCryptoKey()
  if (!dek) return false

  try {
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return false

    const content: ProfileContent = {
      name: getDisplayName() ?? undefined,
      addressForm: getAddressForm(),
    }
    const ciphertext = await encryptText(dek, JSON.stringify(content))

    const { error } = await supabase
      .from('profiles')
      .update({ profile_ciphertext: ciphertext })
      .eq('id', user.id)
    if (error) {
      console.error('profile push failed:', error.message)
      return false
    }
    return true
  } catch (e) {
    console.error('profile push failed:', e)
    return false
  }
}
