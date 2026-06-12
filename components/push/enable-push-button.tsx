'use client'

import { useTranslations } from 'next-intl'
import { useState, useSyncExternalStore } from 'react'

import { Button } from '@/components/ui/button'
import { subscribeToPush } from '@/lib/push/actions'

type PermissionState = 'unsupported' | 'default' | 'granted' | 'denied'

// ─── Чтение browser permission через useSyncExternalStore ───────────────────
//
// Notification.permission — внешнее по отношению к React состояние, причём
// на сервере (SSR) его не существует. Прямолинейные способы его прочитать
// ломаются:
//   - setState в useEffect → ошибка линта react-hooks/set-state-in-effect
//   - чтение в useState-инициализаторе → hydration mismatch: сервер отрендерил
//     кнопку ('default'), а клиент с уже выданным разрешением сразу рендерит
//     бейдж ('granted') — React 19 ругается ошибкой в консоль
//
// useSyncExternalStore — штатный React-хук ровно для этого случая. Три аргумента:
//   subscribe          — как подписаться на изменения значения. Браузер не
//                        эмитит событий при смене Notification.permission,
//                        подписываться не на что → no-op (но функция обязана
//                        вернуть unsubscribe-колбэк)
//   getSnapshot        — текущее значение на клиенте
//   getServerSnapshot  — что считать значением при SSR и в момент гидрации
// React сам делает до-рендер после гидрации, когда снапшоты различаются, —
// это не считается mismatch'ем.
//
// Функции вынесены на уровень модуля: они должны быть стабильными между
// рендерами (новая subscribe-функция на каждый рендер = переподписка).

const subscribeNoop = () => () => {}

function getPermissionSnapshot(): PermissionState {
  if (
    !('Notification' in window) ||
    !('serviceWorker' in navigator) ||
    !('PushManager' in window)
  ) {
    return 'unsupported'
  }
  return Notification.permission as PermissionState
}

// На сервере Push API недоступен в принципе — рендерим нейтральное 'default'
// (кнопку), клиент уточнит сразу после гидрации.
const getServerSnapshot = (): PermissionState => 'default'

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
  // Что определилось из браузера (см. блок useSyncExternalStore выше)...
  const detected = useSyncExternalStore(
    subscribeNoop,
    getPermissionSnapshot,
    getServerSnapshot,
  )
  // ...и что мы узнали сами по ходу действий юзера (requestPermission,
  // успешная подписка). override приоритетнее: setState в обработчике
  // события — легально, а detected сам по себе не обновится (no-op subscribe).
  const [override, setOverride] = useState<PermissionState | null>(null)
  const state = override ?? detected

  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const enable = async () => {
    setError(null)
    setIsPending(true)
    try {
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') {
        setOverride(perm as PermissionState)
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
      setOverride('granted')
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
