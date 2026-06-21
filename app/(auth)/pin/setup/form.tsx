'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PinInput } from '@/components/pin-input'
import {
  generateSalt,
  hashPin,
  bytesToBase64,
} from '@/lib/crypto/pin'
import { PinStorage } from '@/lib/crypto/storage'
import { deriveCryptoKey } from '@/lib/crypto/key'
import { markUnlocked } from '@/lib/crypto/session'

type Step = 'enter' | 'confirm'

export function PinSetupForm() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('enter')
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      // Соль для верификации хранится с хэшем — это не секрет.
      const verifySalt = generateSalt()
      const hash = await hashPin(pin, verifySalt)
      await PinStorage.writePin(bytesToBase64(hash), bytesToBase64(verifySalt))

      // Отдельная соль для будущей деривации crypto-ключа (E2E этап 2+).
      // Сейчас деривируем чтобы сразу положить ключ в память — когда E2E
      // подключим, не придётся менять флоу setup.
      const cryptoSalt = generateSalt()
      await PinStorage.writeCryptoSalt(bytesToBase64(cryptoSalt))
      const key = await deriveCryptoKey(pin, cryptoSalt)

      markUnlocked(key)
      router.replace('/')
    } catch (e) {
      console.error('PIN setup failed:', e)
      setError('Не получилось сохранить PIN. Попробуй ещё раз.')
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-[#FAF6F0] px-6 py-16">
      <main className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm ring-1 ring-black/[0.04]">
        <div className="mb-6 flex items-center gap-2 text-[#5A6B4A]">
          <span className="text-2xl">✦</span>
          <span className="text-sm uppercase tracking-widest">Numia</span>
        </div>

        {step === 'enter' ? (
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
              Важно: если забудешь PIN, восстановить его нельзя — придётся
              выйти из аккаунта. Зашифрованные записи (дневник, фото — когда
              появятся) будут потеряны. Это by design: даже команда Numia не
              может их расшифровать.
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

        {/* TODO (этап позже): биометрия через WebAuthn как опциональная замена PIN.
            На этом экране — чекбокс "Использовать Face ID / Touch ID вместо PIN".
            Если включён: navigator.credentials.create({ publicKey: { ... } }) с
            authenticatorAttachment="platform", сохраняем credentialId в IndexedDB.
            На unlock — navigator.credentials.get → если success, помечаем unlocked
            БЕЗ необходимости вводить PIN. Однако crypto-ключ всё равно деривируется
            из PIN — поэтому для E2E полей биометрия одна не подойдёт, нужен либо
            "biometric-secured PIN" (шифруем PIN на WebAuthn-выводе), либо отдельный
            ключ. Требует архитектурного расширения, делаем отдельной задачей. */}
      </main>
    </div>
  )
}
