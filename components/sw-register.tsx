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
  const [applying, setApplying] = useState(false)

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
    const onControllerChange = () => reloadOnce()
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)

    return () => {
      cancelled = true
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
    }
  }, [])

  // Тап «Обновить». iOS PWA капризен (controllerchange может не дойти),
  // поэтому три канала до reload:
  //   1) controllerchange (обычный путь, слушатель выше);
  //   2) statechange самого waiting-воркера → 'activated';
  //   3) страховка-таймаут: через 2.5с перезагружаемся безусловно — к этому
  //      моменту skipWaiting почти наверняка прошёл, а в худшем случае юзер
  //      просто получит текущую версию и живой баннер снова.
  function applyUpdate() {
    if (!waiting || applying) return
    setApplying(true)

    waiting.addEventListener('statechange', () => {
      if (waiting.state === 'activated') reloadOnce()
    })
    waiting.postMessage('SKIP_WAITING')
    window.setTimeout(reloadOnce, 2500)
  }

  if (!waiting) return null

  return (
    // Тонкий баннер внизу, в эстетике тостов: не модалка, не перекрывает
    // навигацию (выше BottomNav за счёт отступа), исчезает после обновления.
    <div className="fixed inset-x-0 bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-50 flex justify-center px-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-center gap-3 rounded-2xl bg-card px-4 py-2.5 shadow-lg ring-1 ring-border">
        <span className="text-sm text-foreground/85">{t('updateAvailable')}</span>
        <button
          type="button"
          onClick={applyUpdate}
          disabled={applying}
          className="rounded-full bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-70"
        >
          {applying ? '…' : t('updateAction')}
        </button>
      </div>
    </div>
  )
}

// Один reload на все каналы (controllerchange / statechange / таймаут).
let reloadedOnce = false
function reloadOnce() {
  if (reloadedOnce) return
  reloadedOnce = true
  window.location.reload()
}
