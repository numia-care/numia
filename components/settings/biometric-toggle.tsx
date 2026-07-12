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
import { Switch } from '@/components/ui/switch'
import {
  detectBiometricSupport,
  disableBiometric,
  enrollBiometric,
  isBiometricEnrolled,
} from '@/lib/crypto/biometric'
import {
  readLockoutSeconds,
  registerFailedPinAttempt,
} from '@/lib/crypto/lockout'
import { PinStorage } from '@/lib/crypto/storage'

/**
 * Тумблер «Вход по Face ID / Touch ID» в настройках безопасности.
 *
 * Включение — через диалог с вводом PIN: это и подтверждение владельца, и
 * технически единственный путь к сырым байтам DEK для новой обёртки (см.
 * enrollBiometric). Диалог уважает ТУ ЖЕ lockout-механику, что экран входа
 * (lib/crypto/lockout.ts) — иначе он был бы обходом защиты от перебора PIN.
 *
 * Сам тумблер — контролируемый строго состоянием enrolled: тап не
 * переключает его, а открывает диалог; переключение случается только после
 * успешного включения/выключения.
 */
export function BiometricToggle() {
  const t = useTranslations('settings.biometric')
  const tc = useTranslations('common')

  // 'pending' — ещё детектим; 'no' — прячем тумблер, показываем «недоступно».
  const [support, setSupport] = useState<'pending' | 'yes' | 'no' | 'unknown'>(
    'pending',
  )
  const [enrolled, setEnrolled] = useState(false)
  const [dialog, setDialog] = useState<'none' | 'enroll' | 'disable'>('none')

  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lockoutLeft, setLockoutLeft] = useState(0)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [detected, isEnrolled] = await Promise.all([
        detectBiometricSupport(),
        isBiometricEnrolled(),
      ])
      if (cancelled) return
      setSupport(detected)
      setEnrolled(isEnrolled)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Отсчёт паузы lockout — как на экране входа.
  useEffect(() => {
    if (lockoutLeft <= 0) return
    const id = setInterval(() => {
      setLockoutLeft((s) => (s > 1 ? s - 1 : 0))
    }, 1000)
    return () => clearInterval(id)
  }, [lockoutLeft])

  async function openEnrollDialog() {
    setPin('')
    setError(null)
    setLockoutLeft(await readLockoutSeconds())
    setDialog('enroll')
  }

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
          setEnrolled(true)
          setDialog('none')
          toast.success(t('successOn'))
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
          setSupport('no')
          setError(t('prfUnsupported'))
          break
        case 'cancelled':
          // Юзер закрыл системный шит — не ошибка, просто ничего не делаем.
          break
        default:
          // 'failed' | 'no_vault' — на экране настроек vault уже должен быть.
          setError(t('failed'))
      }
    } catch (e) {
      console.error('biometric enroll dialog failed:', e)
      setError(t('failed'))
    } finally {
      setBusy(false)
    }
  }

  async function onDisable() {
    setBusy(true)
    try {
      await disableBiometric()
      setEnrolled(false)
      setDialog('none')
      toast.success(t('successOff'))
    } finally {
      setBusy(false)
    }
  }

  const unavailable = support === 'no' && !enrolled

  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4">
      <div className="min-w-0">
        <p className={unavailable ? 'text-foreground/50' : 'text-foreground'}>
          {t('label')}
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          {unavailable ? t('unavailableHint') : t('hint')}
        </p>
      </div>

      {unavailable ? (
        <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
          {t('unavailable')}
        </span>
      ) : (
        <Switch
          checked={enrolled}
          disabled={support === 'pending' || busy}
          aria-label={t('label')}
          onCheckedChange={(checked) => {
            if (checked) void openEnrollDialog()
            else setDialog('disable')
          }}
        />
      )}

      {/* ── Диалог включения: PIN + предупреждение про двойной запрос ── */}
      <Dialog
        open={dialog === 'enroll'}
        onOpenChange={(open) => {
          if (!open && !busy) setDialog('none')
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
            ✦ {t('doublePromptWarning')}
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
            <Button
              variant="ghost"
              onClick={() => setDialog('none')}
              disabled={busy}
            >
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

      {/* ── Диалог выключения ── */}
      <Dialog
        open={dialog === 'disable'}
        onOpenChange={(open) => {
          if (!open && !busy) setDialog('none')
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('disableTitle')}</DialogTitle>
            <DialogDescription>{t('disableBody')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDialog('none')}
              disabled={busy}
            >
              {tc('cancel')}
            </Button>
            <Button onClick={() => void onDisable()} disabled={busy}>
              {t('disableConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
