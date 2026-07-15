'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { BiometricEnrollDialog } from '@/components/settings/biometric-enroll-dialog'
import {
  detectBiometricSupport,
  isBiometricEnrolled,
} from '@/lib/crypto/biometric'
import { PinStorage } from '@/lib/crypto/storage'

// Однократное предложение включить биометрию — дискаверабилити: тумблер в
// настройках сам никто не найдёт. После успешного входа по PIN (если
// устройство точно умеет, а биометрия ещё не включена) показываем мягкий
// тост «Входить по Face ID / Touch ID?». Не модалка, ничего не блокирует.
//
// Маркер «только что вошли по PIN» — sessionStorage: его ставит экран
// разблокировки перед редиректом, а мы потребляем при монтировании layout'а
// защищённой зоны. Флаг «уже показывали» — локальный, в IndexedDB
// (PinStorage.bio_offer_shown): показ ровно один раз, даже если проигнорили.
const OFFER_PENDING = 'numia_bio_offer_pending'

/** Вызывает экран PIN после успешного входа — «момент предложить биометрию». */
export function noteBioOfferPending(): void {
  if (typeof window !== 'undefined')
    sessionStorage.setItem(OFFER_PENDING, '1')
}

export function BiometricOffer() {
  const t = useTranslations('settings.biometric')
  const [dialogOpen, setDialogOpen] = useState(false)

  useEffect(() => {
    // Маркер читаем и снимаем синхронно, до первого await — так даже двойной
    // mount в React StrictMode не покажет тост дважды. Отмены по cleanup нет
    // сознательно: тост глобальный (sonner), а не состояние компонента.
    if (sessionStorage.getItem(OFFER_PENDING) !== '1') return
    sessionStorage.removeItem(OFFER_PENDING)
    ;(async () => {
      if (await PinStorage.getBioOfferShown()) return
      if (await isBiometricEnrolled()) return
      // Только уверенное 'yes' — на 'unknown' не зовём: предложение, которое
      // упрётся в «не поддерживается», хуже чем никакого.
      if ((await detectBiometricSupport()) !== 'yes') return

      await PinStorage.setBioOfferShown()
      toast(t('offerTitle'), {
        description: t('offerBody'),
        duration: 15_000,
        action: {
          label: t('offerEnable'),
          onClick: () => setDialogOpen(true),
        },
        cancel: {
          label: t('offerLater'),
          onClick: () => {},
        },
      })
    })()
  }, [t])

  // Тот же enroll-флоу с PIN-диалогом, что и у тумблера в настройках.
  return (
    <BiometricEnrollDialog
      open={dialogOpen}
      onClose={() => setDialogOpen(false)}
    />
  )
}
