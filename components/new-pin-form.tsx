'use client'

import { useState } from 'react'

import { PinInput } from '@/components/pin-input'
import type { Dek } from '@/lib/crypto/envelope'
import { setLocalPin } from '@/lib/crypto/vault'

// Шаг «задай новый PIN» поверх УЖЕ развёрнутого DEK. Общий для двух потоков
// возврата доступа: по recovery-фразе (RecoveryEntryForm) и по биометрии
// («не помню PIN, но Face ID работает» — app/(auth)/pin/form.tsx).
//
// setLocalPin пишет весь локальный набор (verify-хэш + envelope-обёртка,
// атомарно) поверх того же DEK → контент читаем, счётчики попыток обнуляются
// самой записью набора (writeLocalVault).

interface Props {
  // Развёрнутый DEK (с сырыми байтами) — от recoverWithPhrase или
  // unlockWithBiometric.
  dek: Dek
  // Новый PIN сохранён. Может быть async (например, проставить recovery_ack).
  onSaved: () => void | Promise<void>
}

export function NewPinForm({ dek, onSaved }: Props) {
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit() {
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

    setBusy(true)
    try {
      await setLocalPin(dek, newPin)
      await onSaved()
    } catch (e) {
      console.error('setLocalPin failed:', e)
      setBusy(false)
      setError('Не получилось сохранить новый PIN. Попробуй ещё раз.')
    }
  }

  return (
    <>
      <h1 className="mb-1 text-2xl font-medium text-foreground">Новый PIN</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Придумай новый 6-значный PIN для входа на этом устройстве.
      </p>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit()
        }}
      >
        <div className="space-y-2">
          <span className="block text-sm text-foreground">Новый PIN</span>
          <PinInput value={newPin} onChange={setNewPin} autoFocus disabled={busy} />
        </div>
        <div className="space-y-2">
          <span className="block text-sm text-foreground">Повтори PIN</span>
          <PinInput value={confirmPin} onChange={setConfirmPin} disabled={busy} />
        </div>

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <button
          type="submit"
          disabled={newPin.length !== 6 || confirmPin.length !== 6 || busy}
          className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-ring/60"
        >
          {busy ? 'Сохраняем…' : 'Сохранить'}
        </button>
      </form>
    </>
  )
}
