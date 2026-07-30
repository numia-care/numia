'use client'

import { useEffect, useState } from 'react'

import { pickGreeting } from '@/lib/dashboard/greetings'
import { getAddressForm, getDisplayName } from '@/lib/profile/local'
import { PROFILE_SYNCED_EVENT } from '@/lib/profile/sync'

// Приветствие на дашборде: «Привет,» / имя + тёплая фраза с учётом рода
// обращения. Имя/род читаем из локального кэша профиля (localStorage),
// время — текущее. Всё это клиентское: на сервере значений нет, поэтому
// считаем в инициализаторе useState (на SSR → запасной «Привет ✦»), а
// несовпадение гидрации на этом блоке гасим suppressHydrationWarning.
//
// Кэш может обновиться ПОСЛЕ первого рендера: ProfileSync тянет расшифрованную
// серверную копию (новое устройство / переустановка PWA — локально пусто,
// имя приезжает через секунду). Подписываемся на событие синка и перечитываем —
// иначе имя появилось бы только при следующем открытии.

function readGreeting() {
  if (typeof window === 'undefined') {
    return { name: null as string | null, phrase: '' }
  }
  return {
    name: getDisplayName(),
    phrase: pickGreeting(getAddressForm(), new Date()),
  }
}

export function Greeting() {
  const [data, setData] = useState(readGreeting)

  useEffect(() => {
    const refresh = () => setData(readGreeting())
    window.addEventListener(PROFILE_SYNCED_EVENT, refresh)
    return () => window.removeEventListener(PROFILE_SYNCED_EVENT, refresh)
  }, [])

  return (
    // ЗАМЕР эталона today.jpg: заголовок ПО ЦЕНТРУ, в две строки
    // («Привет,» / имя), высота прописных 24 → кегль 33, шаг строк 28.6
    // (плотный, ~0.87). Длинной даты («среда, 29 июля») здесь больше нет —
    // её заменил пиксельный бейдж под фразой (DateBadge в page.tsx).
    //
    // Фраза с ротацией (pickGreeting) — осознанное отступление от макета
    // (решение 2026-07-30): в эталоне её нет, но она даёт экрану голос.
    // Кегля для неё в макете нет, поэтому взят обычный мелкий текст.
    <div suppressHydrationWarning className="text-center">
      <h1 className="text-[33px] leading-[0.87] tracking-[-0.03em] text-foreground">
        {data.name ? (
          <>
            Привет,
            <br />
            {data.name}
          </>
        ) : (
          'Привет'
        )}
      </h1>
      {data.phrase && (
        <p className="mt-3 text-sm text-foreground/70">{data.phrase}</p>
      )}
    </div>
  )
}
