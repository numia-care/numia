'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { BiometricEnrollDialog } from '@/components/settings/biometric-enroll-dialog'
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
  isBiometricEnrolled,
} from '@/lib/crypto/biometric'

/**
 * Тумблер «Вход по Face ID / Touch ID» в настройках безопасности.
 *
 * Включение — через общий диалог с вводом PIN (BiometricEnrollDialog, он же
 * используется однократным предложением после входа).
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
  const [busy, setBusy] = useState(false)

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
            if (checked) setDialog('enroll')
            else setDialog('disable')
          }}
        />
      )}

      {/* ── Диалог включения: PIN + предупреждение про двойной запрос ── */}
      <BiometricEnrollDialog
        open={dialog === 'enroll'}
        onClose={() => setDialog('none')}
        onEnrolled={() => setEnrolled(true)}
        onPrfUnsupported={() => setSupport('no')}
      />

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
