'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PinInput } from '@/components/pin-input'
import { RecoveryKeyCard } from '@/components/recovery-key-card'
import { RecoveryEntryForm } from '@/components/recovery-entry-form'
import {
  generateSalt,
  hashPin,
  bytesToBase64,
} from '@/lib/crypto/pin'
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

      // Соль для верификации хранится с хэшем — это не секрет.
      const verifySalt = generateSalt()
      const hash = await hashPin(pin, verifySalt)
      await PinStorage.writePin(bytesToBase64(hash), bytesToBase64(verifySalt))

      // Envelope: генерим DEK + recovery-фразу, оборачиваем DEK под PIN
      // (локально) и под фразой (серверный якорь), кладём ключ в память сессии.
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

        {/* TODO (этап позже): биометрия Face ID / Touch ID для ежедневного входа.
            Теперь архитектура это вмещает легко — envelope encryption (envelope.ts)
            позволяет добавить ЕЩЁ ОДНУ обёртку DEK, помимо PIN и recovery-фразы:

              dek_wrapped_bio = AES-GCM(KEK_bio, DEK)

            KEK_bio берём из WebAuthn PRF-расширения (navigator.credentials.get
            с extensions.prf) — платформенный аутентификатор (Face/Touch ID)
            отдаёт стабильный секрет ТОЛЬКО после биопроверки. Из него деривируем
            KEK_bio и оборачиваем DEK. Хранить обёртку — локально (как PIN), не на
            сервере: биопривязка к устройству. На unlock: PRF → KEK_bio → unwrapDek
            → DEK, без ввода PIN. PIN и фраза остаются как fallback. Отдельная
            задача (WebAuthn PRF поддержан не везде — нужен graceful fallback). */}
      </main>
    </div>
  )
}
