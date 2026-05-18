'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PinStorage } from '@/lib/crypto/storage'
import { isUnlocked } from '@/lib/crypto/session'

// Клиентский гейт для защищённых страниц. Проверяет:
//   1. Есть ли PIN на этом устройстве — если нет, шлём в /pin/setup.
//   2. Разблокировано ли сейчас (sessionStorage + TTL) — если нет, в /pin.
//
// Слушает visibilitychange: при возврате PWA из фона через TTL — снова в /pin.
//
// ВАЖНО: это второй слой защиты ПОВЕРХ server-side auth check в layout.
// Сам по себе PinGate ничего не гарантирует — кто-то может выпилить его из
// бандла и обойти. Реальная защита данных — RLS на стороне Supabase. PIN
// защищает от "телефон попал в чужие руки", а не от продвинутого взлома.

export function PinGate({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function check() {
      const hasPin = await PinStorage.hasPin()
      if (cancelled) return

      if (!hasPin) {
        router.replace('/pin/setup')
        return
      }
      if (!isUnlocked()) {
        router.replace('/pin')
        return
      }

      setReady(true)
    }

    check()

    // Возврат из фона: если TTL истёк — снова локаем и шлём в /pin.
    // visibilitychange срабатывает и на смену вкладки, и на разворачивание PWA.
    function onVisibilityChange() {
      if (document.visibilityState === 'visible' && !isUnlocked()) {
        setReady(false)
        router.replace('/pin')
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [router])

  if (!ready) {
    // Сплеш на время проверки — не даём вспышку защищённого контента
    // в момент между server-render и client-side проверкой.
    return (
      <div className="flex flex-1 items-center justify-center bg-[#FAF6F0]">
        <span className="text-2xl text-[#5A6B4A]">✦</span>
      </div>
    )
  }

  return <>{children}</>
}
