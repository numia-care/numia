'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { subscribeToPush } from '@/lib/push/actions'

type PermissionState = 'unsupported' | 'default' | 'granted' | 'denied'

interface Props {
  onSubscribed?: () => void
}

/**
 * Кнопка включения web push.
 *
 * Состояния:
 *   unsupported — браузер без Push API (старые версии, некоторые embedded WebView)
 *   default     — permission ещё не запрошен → кнопка «Включить»
 *   granted     — подписаны → текст «Включены ✦»
 *   denied      — юзер отказал → мягкое объяснение, как разблокировать в браузере
 *
 * Поток включения:
 *   1. Notification.requestPermission() — system prompt
 *   2. Если granted → serviceWorker.ready → pushManager.subscribe(...)
 *   3. Отдаём PushSubscription.toJSON() в server action
 *   4. Обновляем локальное состояние
 */
export function EnablePushButton({ onSubscribed }: Props) {
  const t = useTranslations('push')
  const [state, setState] = useState<PermissionState>('default')
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      setState('unsupported')
      return
    }
    setState(Notification.permission as PermissionState)
  }, [])

  const enable = async () => {
    setError(null)
    setIsPending(true)
    try {
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') {
        setState(perm as PermissionState)
        return
      }

      const registration = await navigator.serviceWorker.ready
      // Если уже есть подписка — повторно используем; если новая — создаём.
      const existing = await registration.pushManager.getSubscription()
      const sub =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToBuffer(
            process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '',
          ),
        }))

      const result = await subscribeToPush(sub.toJSON())
      if (!result.ok) {
        setError(t('subscribeError'))
        return
      }
      setState('granted')
      onSubscribed?.()
    } catch {
      setError(t('subscribeError'))
    } finally {
      setIsPending(false)
    }
  }

  if (state === 'unsupported') {
    return <p className="text-sm text-muted-foreground">{t('unsupportedText')}</p>
  }
  if (state === 'denied') {
    return <p className="text-sm text-muted-foreground">{t('deniedText')}</p>
  }
  if (state === 'granted') {
    return <p className="text-sm text-foreground/80">{t('enabledBadge')}</p>
  }

  // default
  return (
    <div>
      <Button onClick={enable} disabled={isPending} size="lg">
        {isPending ? t('enabling') : t('enableButton')}
      </Button>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  )
}

/**
 * Web Push API ждёт BufferSource (ArrayBuffer). VAPID-public key — base64url-строка;
 * разворачиваем её в чистый ArrayBuffer (а не Uint8Array, чтобы tsc-strict
 * не цеплял ArrayBufferLike vs ArrayBuffer).
 */
function urlBase64ToBuffer(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const buf = new ArrayBuffer(raw.length)
  const view = new Uint8Array(buf)
  for (let i = 0; i < raw.length; i += 1) view[i] = raw.charCodeAt(i)
  return buf
}
