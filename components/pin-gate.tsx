'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PinStorage } from '@/lib/crypto/storage'
import {
  clearHidden,
  getCryptoKey,
  hiddenDurationMs,
  LOCK_GRACE_MS,
  lock,
  noteHidden,
} from '@/lib/crypto/session'

// Клиентский гейт для защищённых страниц. Проверяет:
//   1. Есть ли PIN на этом устройстве — если нет, шлём в /pin/setup.
//   2. Есть ли DEK в памяти сессии — если нет (холодный старт / reload), в /pin.
//
// Грейс-период по фону: короткий уход в фон НЕ лочит. При возврате на передний
// план просим PIN только если приложение пробыло в фоне дольше LOCK_GRACE_MS
// (по умолчанию 2 минуты). Это убирает агрессивный лок «PIN при каждом сворачивании
// на пару секунд», сохраняя защиту при долгом фоне и холодном старте.
//
// ВАЖНО: это второй слой ПОВЕРХ server-side auth check в layout. Сам по себе
// PinGate ничего не гарантирует — кто-то может выпилить его из бандла. Реальная
// защита данных — RLS на стороне Supabase и E2E-шифрование. PIN защищает от
// «телефон попал в чужие руки», а не от продвинутого взлома.

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
      // Нет DEK в памяти → холодный старт или reload: расшифровать нечем,
      // нужен PIN, чтобы заново развернуть ключ.
      if (!getCryptoKey()) {
        router.replace('/pin')
        return
      }

      setReady(true)
    }

    check()

    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        // Уходим в фон — запоминаем момент, на возврате решим, лочить ли.
        noteHidden()
        return
      }

      // Вернулись на передний план.
      if (hiddenDurationMs() > LOCK_GRACE_MS) {
        // Были в фоне дольше грейс-периода → лочим и просим PIN.
        lock()
        setReady(false)
        router.replace('/pin')
      } else {
        // Короткий уход — остаёмся разблокированными, сбрасываем маркер.
        clearHidden()
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
      <div className="flex flex-1 items-center justify-center bg-background">
        <span className="text-2xl text-foreground">✦</span>
      </div>
    )
  }

  return <>{children}</>
}
