'use client'

import { useState } from 'react'

import { NewPinForm } from '@/components/new-pin-form'
import type { Dek } from '@/lib/crypto/envelope'
import { isValidRecoveryPhrase } from '@/lib/crypto/recovery'
import { PinStorage } from '@/lib/crypto/storage'
import { recoverWithPhrase } from '@/lib/crypto/vault'

// Экран восстановления доступа по ключу (12 слов). Завершает recovery-фичу:
// делает правдой обещание «забыл PIN → вернёшь ключом».
//
// Поток: ввод фразы → новый PIN (общий NewPinForm) → успех.
//   1. Фраза проверяется BIP39-checksum'ом ДО сети (ловит опечатки), затем
//      recoverWithPhrase разворачивает ТОТ ЖЕ DEK из серверного якоря.
//   2. Новый локальный PIN — NewPinForm (setLocalPin поверх того же DEK).
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
      } else if (msg.includes('recovery_anchor_read_failed')) {
        // Сбой сети/сервера — ключ тут ни при чём, не сбиваем с толку.
        setError('Не получилось связаться с сервером. Проверь интернет и попробуй ещё раз.')
      } else {
        setError('Не получилось открыть этим ключом. Проверь слова и попробуй ещё раз.')
      }
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

  // ── Новый PIN (общий шаг, см. components/new-pin-form.tsx) ──────────────────
  if (step === 'pin' && dek) {
    return (
      <NewPinForm
        dek={dek}
        onSaved={async () => {
          // Ключ заведомо у юзера (только что вошёл им) — баннер не нужен.
          await PinStorage.setRecoveryAck(true)
          setStep('done')
        }}
      />
    )
  }

  // ── Ввод фразы ────────────────────────────────────────────────────────────────
  return (
    <>
      <h1 className="mb-1 text-2xl font-medium text-[#3A3A3A]">
        Ключ восстановления
      </h1>
      {/* Частый вопрос тестеров: вход с другого браузера / после переустановки
          выглядит как «новое устройство» (обёртка DEK лежит в IndexedDB, а он
          отдельный на каждый браузер). Объясняем, что это норма и данные целы. */}
      <p className="mb-4 rounded-xl bg-[#EEF2E9] px-4 py-3 text-sm leading-relaxed text-[#5A6B4A]">
        Заходишь из другого браузера или после переустановки? Это нормально — для
        приложения это новое устройство. Введи ключ восстановления, и данные
        будут на месте ✦
      </p>
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
