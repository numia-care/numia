'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { PinInput } from '@/components/pin-input'
import { RecoveryKeyCard } from '@/components/recovery-key-card'
import {
  base64ToBytes,
  constantTimeEqual,
  hashPin,
} from '@/lib/crypto/pin'
import { PinStorage } from '@/lib/crypto/storage'
import { setupVault, unlockWithPin } from '@/lib/crypto/vault'
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
  // 'recovery' — показываем ключ восстановления после ленивого бэкфилла
  // (старый PIN без envelope получает DEK+фразу на первом unlock).
  const [step, setStep] = useState<'unlock' | 'recovery'>('unlock')
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
      const got = await hashPin(pin, salt)

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
        // Ленивый бэкфилл: PIN создан до E2E-фичи, envelope ещё нет. Заводим
        // DEK + recovery-фразу под тем же PIN и показываем ключ один раз.
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
    // Подтверждение — это destructive action. В будущем заменим на красивый
    // модальный диалог, для этапа 0 обычный confirm() ок.
    const ok = window.confirm(
      'Выход из аккаунта и удаление PIN с этого устройства. Зашифрованные записи (когда появятся) будут потеряны. Продолжить?',
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
            onClick={onForgot}
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
