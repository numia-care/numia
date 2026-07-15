'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PinInput } from '@/components/pin-input'
import { RecoveryKeyCard } from '@/components/recovery-key-card'
import { RecoveryEntryForm } from '@/components/recovery-entry-form'
import { PinStorage } from '@/lib/crypto/storage'
import { hasRemoteVault, setupVault } from '@/lib/crypto/vault'

// 'recovery' — показ нового ключа (RecoveryKeyCard, при первом setup).
// 'recover'  — ввод существующего ключа (RecoveryEntryForm, кросс-девайс).
type Step = 'enter' | 'confirm' | 'recovery' | 'recover'

export function PinSetupForm() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('enter')
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [phrase, setPhrase] = useState('')
  // Пока не проверили серверный якорь — держим сплеш (см. эффект ниже).
  const [checked, setChecked] = useState(false)

  // Кросс-девайс / переустановка PWA: якорь восстановления проверяем СРАЗУ,
  // до показа «Придумай PIN». Иначе юзер дважды вводит новый PIN, а форма
  // потом всё равно уводит на ввод фразы, выбросив введённое (баг с живого
  // прогона 2026-07-15). Есть якорь → сразу recovery-флоу: фраза → новый PIN,
  // один раз.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const remote = await hasRemoteVault()
        if (cancelled) return
        if (remote) setStep('recover')
      } catch (e) {
        // Сеть/сервер недоступны — не блокируем setup вечным сплешем.
        // Страховка от осиротения контента остаётся: onCreate перед
        // setupVault проверяет якорь ещё раз, и там ошибка = стоп.
        console.error('recovery anchor pre-check failed:', e)
      }
      if (!cancelled) setChecked(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function onCreate() {
    setError(null)
    if (pin.length !== 6) {
      setError('Введи 6 цифр')
      return
    }
    if (pin !== confirm) {
      setError('PIN-коды не совпадают')
      setConfirm('')
      return
    }

    setBusy(true)
    try {
      // Кросс-девайс: если на сервере УЖЕ есть якорь восстановления, vault
      // настраивался на другом устройстве. Новый DEK генерить нельзя — он
      // перезапишет якорь и осиротит весь E2E-контент. Ведём на ввод
      // существующего ключа (там же зададим локальный PIN). PIN-хэш ещё НЕ
      // пишем — его запишет RecoveryEntryForm под новый PIN после восстановления.
      if (await hasRemoteVault()) {
        setBusy(false)
        setStep('recover')
        return
      }

      // Envelope: генерим DEK + recovery-фразу, оборачиваем DEK под PIN
      // (локально) и под фразой (серверный якорь), кладём ключ в память сессии.
      // Verify-хэш PIN setupVault пишет сам — весь локальный набор атомарно.
      // Возвращённую фразу показываем на следующем шаге ровно один раз.
      const recoveryPhrase = await setupVault(pin)
      setPhrase(recoveryPhrase)
      setBusy(false)
      setStep('recovery')
    } catch (e) {
      console.error('PIN setup failed:', e)
      setError('Не получилось сохранить PIN. Попробуй ещё раз.')
      setBusy(false)
    }
  }

  // Юзер сохранил ключ (или решил позже) — отмечаем и уходим в приложение.
  async function finishRecovery(acknowledged: boolean) {
    await PinStorage.setRecoveryAck(acknowledged)
    router.replace('/')
  }

  if (!checked) {
    // Сплеш на время проверки якоря — тот же, что на экране разблокировки.
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
            onBack={() => setStep('enter')}
          />
        ) : step === 'enter' ? (
          <>
            <h1 className="mb-1 text-2xl font-medium text-[#3A3A3A]">
              Придумай PIN
            </h1>
            <p className="mb-6 text-sm text-[#7A7A7A]">
              6 цифр. Будем спрашивать при входе и после паузы — даже если
              телефон попадёт в чужие руки, в Numia без PIN не зайдут.
            </p>

            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                if (pin.length !== 6) return
                setError(null)
                setStep('confirm')
              }}
            >
              <PinInput value={pin} onChange={setPin} autoFocus />
              {error && <p className="text-sm text-rose-600">{error}</p>}
              <button
                type="submit"
                disabled={pin.length !== 6}
                className="w-full rounded-xl bg-[#5A6B4A] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-[#4A5A3A] disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#C9B6E4]/60"
              >
                Дальше
              </button>
            </form>

            <p className="mt-6 text-xs leading-relaxed text-[#7A7A7A]">
              Дальше покажем твой ключ восстановления. Сохрани его — это
              страховка: им вернёшь доступ, если забудешь PIN или сменишь
              устройство. Зашифрованные записи (дневник, фото) пропадут навсегда,
              только если потеряешь и PIN, и ключ. Расшифровать их не можем даже
              мы — это by design ✦
            </p>
          </>
        ) : (
          <>
            <h1 className="mb-1 text-2xl font-medium text-[#3A3A3A]">
              Повтори PIN
            </h1>
            <p className="mb-6 text-sm text-[#7A7A7A]">
              Введи те же 6 цифр ещё раз для подтверждения.
            </p>

            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                onCreate()
              }}
            >
              <PinInput
                value={confirm}
                onChange={setConfirm}
                autoFocus
                disabled={busy}
              />
              {error && <p className="text-sm text-rose-600">{error}</p>}
              <button
                type="submit"
                disabled={confirm.length !== 6 || busy}
                className="w-full rounded-xl bg-[#5A6B4A] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-[#4A5A3A] disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#C9B6E4]/60"
              >
                {busy ? 'Сохраняем…' : 'Готово'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setStep('enter')
                  setConfirm('')
                  setError(null)
                }}
                className="block w-full text-center text-sm text-[#7A7A7A] underline-offset-4 hover:text-[#5A6B4A] hover:underline disabled:opacity-50"
              >
                Назад
              </button>
            </form>
          </>
        )}

        {/* Биометрия для ежедневного входа реализована ровно по этой схеме —
            см. lib/crypto/biometric.ts (обёртка dek_wrapped_bio из WebAuthn
            PRF). Включается в настройках после setup, не здесь. */}
      </main>
    </div>
  )
}
