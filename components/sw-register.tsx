'use client'

import { useEffect } from 'react'

// Регистрация service worker. Только в production:
// в dev mode SW кеширует ответы и ломает hot-reload — неудобно при разработке.
// Чтобы протестировать SW локально — запусти `pnpm build && pnpm start`.
export function SwRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (!('serviceWorker' in navigator)) return

    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch((err) => {
        console.error('SW registration failed:', err)
      })
  }, [])

  return null
}
