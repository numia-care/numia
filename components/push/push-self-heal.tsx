'use client'

import { useEffect, useRef } from 'react'

import { subscribeToPush } from '@/lib/push/actions'
import { urlBase64ToBuffer } from '@/lib/push/vapid'

/**
 * Невидимый компонент в (app) layout (рядом с TimezoneSync). На каждом заходе
 * в приложение тихо поддерживает push-подписку живой — без всякого UI.
 *
 * Зачем: push-подписки протухают (браузер ротирует endpoint, push-сервис
 * отдаёт 410, мы удаляем мёртвую запись из БД). Юзер один раз нажал
 * «Включить напоминания» — дальше система сама пересоздаёт подписку.
 *
 * Логика (только если разрешение уже granted — сами разрешение НЕ просим):
 *   - нет подписки в браузере → создаём заново через pushManager.subscribe;
 *   - есть → всё равно upsert'им в БД (идемпотентно по endpoint) — это лечит
 *     случай «подписка в браузере есть, а в нашей БД её нет/протухла» и
 *     обновляет last_seen_at.
 *
 * NB: в dev service worker не регистрируется (см. SwRegister) — тогда
 * getRegistration вернёт undefined и мы тихо выходим. Фича рабочая в проде
 * (или при `pnpm build && pnpm start`).
 */
export function PushSelfHeal() {
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    ran.current = true

    void (async () => {
      try {
        if (
          !('Notification' in window) ||
          !('serviceWorker' in navigator) ||
          !('PushManager' in window)
        ) {
          return
        }
        // Сами разрешение не запрашиваем — только поддерживаем уже выданное.
        if (Notification.permission !== 'granted') return

        const reg = await navigator.serviceWorker.getRegistration('/')
        if (!reg) return // SW не зарегистрирован (например, dev) — лечить нечего

        let sub = await reg.pushManager.getSubscription()
        if (!sub) {
          const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
          if (!key) return
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToBuffer(key),
          })
        }

        // Идемпотентный upsert по endpoint: если эндпоинта нет в БД — запишет,
        // если есть — обновит last_seen_at.
        await subscribeToPush(sub.toJSON())
      } catch (e) {
        console.error('push self-heal failed:', e)
      }
    })()
  }, [])

  return null
}
