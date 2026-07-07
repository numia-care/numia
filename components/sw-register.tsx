'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

// Регистрация service worker + баннер обновления.
//
// Регистрация — только в production: в dev SW кеширует ответы и ломает
// hot-reload. Протестировать локально: `pnpm build && pnpm start`.
//
// Update flow (вежливый, критично для беты — тестеры должны получать фиксы):
//   1. Браузер нашёл новый sw.js → install → новый SW висит в waiting
//      (skipWaiting в install убран, см. public/sw.js).
//   2. Мы это замечаем (reg.waiting / updatefound) → тонкий баннер внизу.
//   3. Тап «Обновить» → postMessage(SKIP_WAITING) → новый SW активируется →
//      controllerchange → reload. Без тапа ничего не дёргается.
export function SwRegister() {
  const t = useTranslations('common')
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null)

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (!('serviceWorker' in navigator)) return

    let cancelled = false

    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        if (cancelled) return

        // Обновление могло быть найдено ещё до этой загрузки страницы.
        if (reg.waiting) setWaiting(reg.waiting)

        // Или найдётся позже (браузер проверяет sw.js на каждой навигации).
        reg.addEventListener('updatefound', () => {
          const fresh = reg.installing
          if (!fresh) return
          fresh.addEventListener('statechange', () => {
            // installed при живом controller = новый SW готов и ждёт.
            // (Без controller это самая первая установка — баннер не нужен.)
            if (fresh.state === 'installed' && navigator.serviceWorker.controller) {
              if (!cancelled) setWaiting(fresh)
            }
          })
        })
      })
      .catch((err) => {
        console.error('SW registration failed:', err)
      })

    // Новый SW взял контроль (после SKIP_WAITING) → перезагружаемся на новую
    // версию. Гвард от двойного reload (событие может стрельнуть повторно).
    let reloaded = false
    const onControllerChange = () => {
      if (reloaded) return
      reloaded = true
      window.location.reload()
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)

    return () => {
      cancelled = true
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
    }
  }, [])

  if (!waiting) return null

  return (
    // Тонкий баннер внизу, в эстетике тостов: не модалка, не перекрывает
    // навигацию (выше BottomNav за счёт отступа), исчезает после обновления.
    <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 flex justify-center px-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-center gap-3 rounded-2xl bg-card px-4 py-2.5 shadow-lg ring-1 ring-border">
        <span className="text-sm text-foreground/85">{t('updateAvailable')}</span>
        <button
          type="button"
          onClick={() => waiting.postMessage('SKIP_WAITING')}
          className="rounded-full bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {t('updateAction')}
        </button>
      </div>
    </div>
  )
}
