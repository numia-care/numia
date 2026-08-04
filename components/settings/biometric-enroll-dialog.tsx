'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { PinInput } from '@/components/pin-input'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { enrollBiometric } from '@/lib/crypto/biometric'
import {
  readLockoutSeconds,
  registerFailedPinAttempt,
} from '@/lib/crypto/lockout'
import { PinStorage } from '@/lib/crypto/storage'

/**
 * Диалог включения биометрии: ввод PIN + предупреждение про двойной системный
 * запрос. Общий для тумблера в настройках (biometric-toggle) и однократного
 * предложения после входа (biometric-offer).
 *
 * PIN здесь — и подтверждение владельца, и технически единственный путь к
 * сырым байтам DEK для новой обёртки (см. enrollBiometric). Диалог уважает
 * ТУ ЖЕ lockout-механику, что экран входа (lib/crypto/lockout.ts) — иначе он
 * был бы обходом защиты от перебора PIN.
 */
export function BiometricEnrollDialog({
  open,
  onClose,
  onEnrolled,
  onPrfUnsupported,
}: {
  open: boolean
  onClose: () => void
  /** Биометрия включена — вызывающий обновляет своё состояние (тумблер). */
  onEnrolled?: () => void
  /** Устройство не умеет PRF — вызывающий может спрятать тумблер. */
  onPrfUnsupported?: () => void
}) {
  const t = useTranslations('settings.biometric')
  const tc = useTranslations('common')

  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lockoutLeft, setLockoutLeft] = useState(0)

  // При каждом открытии — чистый лист + актуальная пауза lockout из IDB.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      const left = await readLockoutSeconds()
      if (cancelled) return
      setPin('')
      setError(null)
      setLockoutLeft(left)
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  // Отсчёт паузы lockout — как на экране входа.
  useEffect(() => {
    if (lockoutLeft <= 0) return
    const id = setInterval(() => {
      setLockoutLeft((s) => (s > 1 ? s - 1 : 0))
    }, 1000)
    return () => clearInterval(id)
  }, [lockoutLeft])

  async function onEnroll() {
    if (pin.length !== 6 || busy) return
    // Пауза активна → PIN не проверяем вообще (state + подстраховка из IDB).
    if (lockoutLeft > 0) return
    const left = await readLockoutSeconds()
    if (left > 0) {
      setLockoutLeft(left)
      return
    }

    setBusy(true)
    setError(null)
    try {
      const result = await enrollBiometric(pin)
      switch (result) {
        case 'ok':
          // PIN был верный — сбрасываем счётчик неудачных попыток, как вход.
          await PinStorage.resetFailedAttempts()
          toast.success(t('successOn'))
          onEnrolled?.()
          onClose()
          break
        case 'wrong_pin': {
          const failed = await registerFailedPinAttempt()
          if (failed.lockoutSeconds > 0) setLockoutLeft(failed.lockoutSeconds)
          setError(t('wrongPin'))
          setPin('')
          break
        }
        case 'prf_unsupported':
          // Устройство/браузер не умеет PRF. Passkey мог уже создаться —
          // честно говорим, что запись в системных «Паролях» безвредна.
          onPrfUnsupported?.()
          setError(t('prfUnsupported'))
          break
        case 'cancelled':
          // Юзер закрыл системный шит — не ошибка, просто ничего не делаем.
          break
        default:
          // 'failed' | 'no_vault' — vault к этому моменту уже должен быть.
          setError(t('failed'))
      }
    } catch (e) {
      console.error('biometric enroll dialog failed:', e)
      setError(t('failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !busy) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('dialogTitle')}</DialogTitle>
          <DialogDescription>{t('dialogIntro')}</DialogDescription>
        </DialogHeader>

        {/* Двойной системный запрос биометрии — так надо, предупреждаем
            заранее, чтобы второй шит не выглядел сбоем. */}
        <p className="rounded-xl bg-fairy/15 px-4 py-3 text-xs leading-relaxed text-foreground/80">
          {t('doublePromptWarning')}
        </p>

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            void onEnroll()
          }}
        >
          <PinInput
            value={pin}
            onChange={setPin}
            autoFocus
            disabled={busy || lockoutLeft > 0}
            name="bio-enroll-pin"
          />
          {lockoutLeft > 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('lockout', { seconds: lockoutLeft })}
            </p>
          ) : (
            error && <p className="text-sm text-destructive">{error}</p>
          )}
        </form>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {tc('cancel')}
          </Button>
          <Button
            onClick={() => void onEnroll()}
            disabled={pin.length !== 6 || busy || lockoutLeft > 0}
          >
            {busy ? t('enabling') : t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
