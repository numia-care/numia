'use client'

import { useState } from 'react'

import { PinInput } from '@/components/pin-input'
import type { Dek } from '@/lib/crypto/envelope'
import { bytesToBase64, generateSalt, hashPin } from '@/lib/crypto/pin'
import { isValidRecoveryPhrase } from '@/lib/crypto/recovery'
import { PinStorage } from '@/lib/crypto/storage'
import { recoverWithPhrase, setLocalPin } from '@/lib/crypto/vault'

// Экран восстановления доступа по ключу (12 слов). Завершает recovery-фичу:
// делает правдой обещание «забыл PIN → вернёшь ключом».
//
// Поток: ввод фразы → новый PIN → успех.
//   1. Фраза проверяется BIP39-checksum'ом ДО сети (ловит опечатки), затем
//      recoverWithPhrase разворачивает ТОТ ЖЕ DEK из серверного якоря.
//   2. Новый локальный PIN: пишем и верификационный хэш (writePin — иначе
//      будущие unlock не пройдут), и envelope-обёртку (setLocalPin, тот же DEK
//      → весь контент остаётся читаемым).
//
// Тон тёплый: аудитория тревожная, момент «забыл PIN» — стрессовый.

type Step = 'phrase' | 'pin' | 'done'

interface Props {
  // Восстановление прошло, новый PIN задан → уводим в приложение.
  onSuccess: () => void
  // «← Назад» к промежуточному экрану.
  onBack: () => void
}

export function RecoveryEntryForm({ onSuccess, onBack }: Props) {
  const [step, setStep] = useState<Step>('phrase')

  // Введённый ключ НЕ теряем при ошибке — переписывать 12 слов мучительно.
  const [phrase, setPhrase] = useState('')
  // Развёрнутый DEK живёт между шагами «фраза» и «новый PIN».
  const [dek, setDek] = useState<Dek | null>(null)

  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmitPhrase() {
    setError(null)

    // Локальная проверка checksum — ловит опечатку без обращения к серверу.
    if (!isValidRecoveryPhrase(phrase)) {
      setError('Проверь ключ — похоже, опечатка в одном из слов.')
      return
    }

    setBusy(true)
    try {
      // Разворачивает DEK из серверного якоря (profiles.dek_wrapped_recovery)
      // и помечает сессию разблокированной. Неверная фраза → бросит.
      const recovered = await recoverWithPhrase(phrase)
      setDek(recovered)
      setBusy(false)
      setStep('pin')
    } catch (e) {
      setBusy(false)
      const msg = e instanceof Error ? e.message : ''
      if (msg.includes('no_recovery_anchor')) {
        setError('Для этого аккаунта ключ восстановления не найден.')
      } else {
        setError('Не получилось открыть этим ключом. Проверь слова и попробуй ещё раз.')
      }
    }
  }

  async function onSubmitPin() {
    setError(null)
    if (newPin.length !== 6) {
      setError('Введи 6 цифр')
      return
    }
    if (newPin !== confirmPin) {
      setError('PIN-коды не совпадают')
      setConfirmPin('')
      return
    }
    if (!dek) {
      // Подстраховка: без DEK сюда попасть нельзя, но если вдруг — назад к фразе.
      setStep('phrase')
      return
    }

    setBusy(true)
    try {
      // 1. Верификационный хэш нового PIN (для будущих unlock на устройстве).
      const verifySalt = generateSalt()
      const hash = await hashPin(newPin, verifySalt)
      await PinStorage.writePin(bytesToBase64(hash), bytesToBase64(verifySalt))

      // 2. Envelope-обёртка под новым PIN поверх ТОГО ЖЕ DEK — контент цел.
      await setLocalPin(dek, newPin)

      // Ключ заведомо у юзера (только что вошёл им) — баннер-напоминание не нужен.
      await PinStorage.setRecoveryAck(true)

      setBusy(false)
      setStep('done')
    } catch (e) {
      console.error('recovery setLocalPin failed:', e)
      setBusy(false)
      setError('Не получилось сохранить новый PIN. Попробуй ещё раз.')
    }
  }

  // ── Успех ──────────────────────────────────────────────────────────────────
  if (step === 'done') {
    return (
      <>
        <h1 className="mb-1 text-2xl font-medium text-[#3A3A3A]">
          Доступ восстановлен ✦
        </h1>
        <p className="mb-6 text-sm leading-relaxed text-[#7A7A7A]">
          Записи на месте. Новый PIN сохранён на этом устройстве — дальше входи
          с ним.
        </p>
        <button
          type="button"
          onClick={onSuccess}
          className="w-full rounded-xl bg-[#5A6B4A] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-[#4A5A3A] focus:outline-none focus:ring-2 focus:ring-[#C9B6E4]/60"
        >
          Войти
        </button>
      </>
    )
  }

  // ── Новый PIN ────────────────────────────────────────────────────────────────
  if (step === 'pin') {
    return (
      <>
        <h1 className="mb-1 text-2xl font-medium text-[#3A3A3A]">Новый PIN</h1>
        <p className="mb-6 text-sm text-[#7A7A7A]">
          Придумай новый 6-значный PIN для входа на этом устройстве.
        </p>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            onSubmitPin()
          }}
        >
          <div className="space-y-2">
            <span className="block text-sm text-[#3A3A3A]">Новый PIN</span>
            <PinInput value={newPin} onChange={setNewPin} autoFocus disabled={busy} />
          </div>
          <div className="space-y-2">
            <span className="block text-sm text-[#3A3A3A]">Повтори PIN</span>
            <PinInput value={confirmPin} onChange={setConfirmPin} disabled={busy} />
          </div>

          {error && <p className="text-sm text-rose-600">{error}</p>}

          <button
            type="submit"
            disabled={newPin.length !== 6 || confirmPin.length !== 6 || busy}
            className="w-full rounded-xl bg-[#5A6B4A] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-[#4A5A3A] disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#C9B6E4]/60"
          >
            {busy ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </form>
      </>
    )
  }

  // ── Ввод фразы ────────────────────────────────────────────────────────────────
  return (
    <>
      <h1 className="mb-1 text-2xl font-medium text-[#3A3A3A]">
        Ключ восстановления
      </h1>
      <p className="mb-5 text-sm leading-relaxed text-[#7A7A7A]">
        Введи 12 слов ключа — можно вставить целиком или по одному, через пробел.
        Порядок слов важен.
      </p>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          onSubmitPhrase()
        }}
      >
        <textarea
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          placeholder="слово1 слово2 слово3 …"
          rows={3}
          autoFocus
          disabled={busy}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="w-full resize-none rounded-xl border border-[#E8E2D8] bg-white px-4 py-3 font-mono text-[#3A3A3A] outline-none placeholder:font-sans placeholder:text-[#B8B0A4] focus:border-[#9CAF88] focus:ring-2 focus:ring-[#C9B6E4]/40 disabled:opacity-60"
        />

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-[#5A6B4A] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-[#4A5A3A] disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#C9B6E4]/60"
        >
          {busy ? 'Проверяем…' : 'Продолжить'}
        </button>
      </form>

      <button
        type="button"
        onClick={onBack}
        disabled={busy}
        className="mt-4 block w-full text-center text-sm text-[#7A7A7A] underline-offset-4 hover:text-[#5A6B4A] hover:underline disabled:opacity-50"
      >
        ← Назад
      </button>
    </>
  )
}
