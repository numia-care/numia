'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { PinInput } from '@/components/pin-input'
import { RecoveryKeyCard } from '@/components/recovery-key-card'
import { RecoveryEntryForm } from '@/components/recovery-entry-form'
import {
  base64ToBytes,
  constantTimeEqual,
  hashPin,
  LEGACY_KDF_ITERATIONS,
} from '@/lib/crypto/pin'
import { PinStorage } from '@/lib/crypto/storage'
import { hasRemoteVault, setupVault, unlockWithPin } from '@/lib/crypto/vault'
import { lock } from '@/lib/crypto/session'

// После этого числа неудачных попыток — выделяем "Не помню PIN" красным,
// сигналим юзеру что есть выход. Жёсткой блокировки по попыткам не делаем:
// PIN всего 6 цифр и хранится только локально, без серверной составляющей
// аккаунт-локаут не имеет смысла (атакующий с физическим доступом к девайсу
// может просто очистить IndexedDB и сбросить счётчик).
const SOFT_LOCKOUT_AFTER = 5

export function PinUnlockForm() {
  const router = useRouter()
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attempts, setAttempts] = useState(0)
  const [checked, setChecked] = useState(false)
  // Шаги:
  //   unlock   — обычный ввод PIN
  //   forgot   — промежуточный экран «не помнишь PIN?» (ключ vs сброс)
  //   recover  — ввод ключа восстановления (RecoveryEntryForm)
  //   recovery — показ ключа после ленивого бэкфилла (старый PIN без envelope
  //              получает DEK+фразу на первом unlock)
  const [step, setStep] = useState<'unlock' | 'forgot' | 'recover' | 'recovery'>(
    'unlock',
  )
  const [phrase, setPhrase] = useState('')

  // На случай "PIN был удалён из IDB между переходами" — отправляем на setup.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const has = await PinStorage.hasPin()
      if (cancelled) return
      if (!has) {
        router.replace('/pin/setup')
        return
      }
      setAttempts(await PinStorage.getFailedAttempts())
      setChecked(true)
    })()
    return () => {
      cancelled = true
    }
  }, [router])

  async function onUnlock() {
    setError(null)
    if (pin.length !== 6) {
      setError('Введи 6 цифр')
      return
    }

    setBusy(true)
    try {
      const stored = await PinStorage.readPin()
      if (!stored) {
        router.replace('/pin/setup')
        return
      }
      const salt = base64ToBytes(stored.salt)
      const expected = base64ToBytes(stored.hash)
      // Хэш проверяем теми итерациями, которыми он создан (null = legacy
      // 210k). На текущие набор переведёт lazy-апгрейд внутри unlockWithPin.
      const got = await hashPin(pin, salt, stored.iterations ?? LEGACY_KDF_ITERATIONS)

      if (!constantTimeEqual(got, expected)) {
        const n = await PinStorage.incrementFailedAttempts()
        setAttempts(n)
        setError('Неверный PIN')
        setPin('')
        setBusy(false)
        return
      }

      await PinStorage.resetFailedAttempts()

      // PIN верен — разворачиваем DEK из локальной обёртки (envelope).
      const result = await unlockWithPin(pin)
      if (result === 'ok') {
        router.replace('/')
        return
      }
      if (result === 'no_vault') {
        // Локальной обёртки DEK нет. Прежде чем заводить vault — проверяем
        // сервер: если якорь восстановления УЖЕ есть, vault настраивался раньше.
        // Тогда новый DEK генерить нельзя (осиротит E2E-контент) и ключ
        // повторно показывать не нужно — обёртка просто пропала (новое
        // устройство / очищенный стор). Доступ возвращаем по ключу.
        if (await hasRemoteVault()) {
          setBusy(false)
          setStep('recover')
          return
        }
        // Якоря нет — настоящий первый раз (PIN с этапа 0 без envelope). Заводим
        // DEK + recovery-фразу под тем же PIN и показываем ключ РОВНО здесь, один раз.
        const recoveryPhrase = await setupVault(pin)
        setPhrase(recoveryPhrase)
        setBusy(false)
        setStep('recovery')
        return
      }
      // 'wrong': хэш сошёлся, но обёртка не разворачивается (повреждена) —
      // редкий случай рассинхрона хранилищ.
      setError('Не удалось открыть хранилище. Попробуй ещё раз.')
      setBusy(false)
    } catch (e) {
      console.error('PIN unlock failed:', e)
      setError('Что-то пошло не так. Попробуй ещё раз.')
      setBusy(false)
    }
  }

  async function finishRecovery(acknowledged: boolean) {
    await PinStorage.setRecoveryAck(acknowledged)
    router.replace('/')
  }

  async function onForgot() {
    // ЗАПАСНОЙ выход для тех, у кого НЕТ ключа восстановления. Главный путь —
    // «Ввести ключ восстановления» (step 'recover', RecoveryEntryForm), он
    // данные сохраняет. Этот сброс — разрушающий, поэтому за подтверждением.
    // В будущем заменим confirm() на красивый модальный диалог.
    const ok = window.confirm(
      'Сброс на этом устройстве: PIN удалится, и ты выйдешь из аккаунта. ' +
        'Делай это, только если нет ключа восстановления — без него после ' +
        'сброса зашифрованные записи открыть не получится. Продолжить?',
    )
    if (!ok) return

    setBusy(true)
    lock()
    await PinStorage.clearPin()
    const supabase = createClient()
    await supabase.auth.signOut()
    router.replace('/login')
  }

  if (!checked) {
    return (
      <div className="flex flex-1 items-center justify-center bg-[#FAF6F0]">
        <span className="text-2xl text-[#5A6B4A]">✦</span>
      </div>
    )
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-[#FAF6F0] px-6 py-16">
      <main className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm ring-1 ring-black/[0.04]">
        <div className="mb-6 flex items-center gap-2 text-[#5A6B4A]">
          <span className="text-2xl">✦</span>
          <span className="text-sm uppercase tracking-widest">Numia</span>
        </div>

        {step === 'recovery' ? (
          <RecoveryKeyCard
            phrase={phrase}
            onDone={() => finishRecovery(true)}
            onRemindLater={() => finishRecovery(false)}
          />
        ) : step === 'recover' ? (
          <RecoveryEntryForm
            onSuccess={() => router.replace('/')}
            onBack={() => setStep('forgot')}
          />
        ) : step === 'forgot' ? (
          <>
            <h1 className="mb-1 text-2xl font-medium text-[#3A3A3A]">
              Не помнишь PIN?
            </h1>
            <p className="mb-6 text-sm leading-relaxed text-[#7A7A7A]">
              Ничего страшного. Если сохранён ключ восстановления — вернём доступ
              к записям без потерь.
            </p>

            <button
              type="button"
              onClick={() => setStep('recover')}
              className="w-full rounded-xl bg-[#5A6B4A] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-[#4A5A3A] focus:outline-none focus:ring-2 focus:ring-[#C9B6E4]/60"
            >
              Ввести ключ восстановления
            </button>

            {/* Запасной, неприметный выход — для тех, у кого ключа нет. */}
            <div className="mt-8 border-t border-[#E8E2D8] pt-5">
              <button
                type="button"
                disabled={busy}
                onClick={onForgot}
                className="text-sm text-[#7A7A7A] underline-offset-4 hover:text-rose-600 hover:underline disabled:opacity-50"
              >
                Сбросить всё
              </button>
              <p className="mt-1.5 text-xs leading-relaxed text-[#B8B0A4]">
                Удалит PIN и выйдет из аккаунта. Без ключа восстановления
                зашифрованные записи после сброса не вернуть.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setStep('unlock')}
              className="mt-6 block w-full text-center text-sm text-[#7A7A7A] underline-offset-4 hover:text-[#5A6B4A] hover:underline"
            >
              ← Назад
            </button>
          </>
        ) : (
          <>
        <h1 className="mb-1 text-2xl font-medium text-[#3A3A3A]">Введи PIN</h1>
        <p className="mb-6 text-sm text-[#7A7A7A]">
          Те же 6 цифр, что и при первом входе.
        </p>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            onUnlock()
          }}
        >
          <PinInput value={pin} onChange={setPin} autoFocus disabled={busy} />
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <button
            type="submit"
            disabled={pin.length !== 6 || busy}
            className="w-full rounded-xl bg-[#5A6B4A] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-[#4A5A3A] disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#C9B6E4]/60"
          >
            {busy ? 'Проверяем…' : 'Войти'}
          </button>
        </form>

        <div className="mt-6 text-sm">
          <button
            type="button"
            disabled={busy}
            onClick={() => setStep('forgot')}
            className={
              attempts >= SOFT_LOCKOUT_AFTER
                ? 'text-rose-600 underline-offset-4 hover:underline disabled:opacity-50'
                : 'text-[#7A7A7A] underline-offset-4 hover:text-[#5A6B4A] hover:underline disabled:opacity-50'
            }
          >
            Не помню PIN
          </button>
        </div>

          </>
        )}

        {/* TODO (этап позже): биометрия через WebAuthn — см. комментарий в setup/form.tsx */}
      </main>
    </div>
  )
}
