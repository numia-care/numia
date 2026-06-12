'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

import { Card } from '@/components/ui/card'

import { EnablePushButton } from './enable-push-button'

/**
 * Карточка-приглашение на /tracker. Показывается только если:
 *   - браузер поддерживает push
 *   - Notification.permission === 'default' (ещё не запрошен)
 *   - подписки в pushManager ещё нет
 *
 * После granted/denied — скрывается. После reload страницы тоже не покажется,
 * потому что Notification.permission уже granted/denied.
 *
 * Рендерится только когда есть активные препараты (parent передаёт условие).
 */
export function PushPromptCard() {
  const t = useTranslations('push')
  const [shouldShow, setShouldShow] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      return
    }
    if (Notification.permission !== 'default') return

    // Дополнительно: если subscription уже есть (например, юзер granted
    // в прошлый раз но мы потеряли запись в БД — редко, но возможно) —
    // не показываем. EnablePushButton сам разберётся при нажатии.
    navigator.serviceWorker.ready.then((reg) =>
      reg.pushManager.getSubscription().then((sub) => {
        if (!sub) setShouldShow(true)
      }),
    )
  }, [])

  if (!shouldShow) return null

  return (
    <Card className="mb-6 flex flex-col gap-3 p-5">
      <div>
        <h3 className="font-heading text-lg text-foreground">{t('promptTitle')}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t('promptText')}</p>
      </div>
      <EnablePushButton onSubscribed={() => setShouldShow(false)} />
    </Card>
  )
}
