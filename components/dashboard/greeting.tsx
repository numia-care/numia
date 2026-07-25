'use client'

import { useEffect, useState } from 'react'

import { pickGreeting } from '@/lib/dashboard/greetings'
import { getAddressForm, getDisplayName } from '@/lib/profile/local'
import { PROFILE_SYNCED_EVENT } from '@/lib/profile/sync'

// Приветствие на дашборде: «Привет, [имя] ✦» + дата + тёплая фраза с учётом
// рода обращения. Имя/род читаем из локального кэша профиля (localStorage),
// время — текущее. Всё это клиентское: на сервере значений нет, поэтому
// считаем в инициализаторе useState (на SSR → запасной «Привет ✦»), а
// несовпадение гидрации на этом блоке гасим suppressHydrationWarning.
//
// Кэш может обновиться ПОСЛЕ первого рендера: ProfileSync тянет расшифрованную
// серверную копию (новое устройство / переустановка PWA — локально пусто,
// имя приезжает через секунду). Подписываемся на событие синка и перечитываем —
// иначе имя появилось бы только при следующем открытии.

const dateFmt = new Intl.DateTimeFormat('ru-RU', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
})

function readGreeting() {
  if (typeof window === 'undefined') {
    return { name: null as string | null, phrase: '', date: '' }
  }
  const now = new Date()
  return {
    name: getDisplayName(),
    phrase: pickGreeting(getAddressForm(), now),
    date: dateFmt.format(now),
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
    // По фрейму Кая: заголовок 30px без ✦ (звезда теперь в шапке страницы),
    // letter-spacing слегка ужат, тёплая фраза под ним.
    <div suppressHydrationWarning>
      <h1 className="text-3xl tracking-[-0.03em] text-foreground">
        Привет{data.name ? `, ${data.name}` : ''}
      </h1>
      {data.phrase && (
        <p className="mt-2 text-base text-foreground">{data.phrase}</p>
      )}
      {data.date && (
        <p className="mt-1 text-sm text-muted-foreground">{data.date}</p>
      )}
    </div>
  )
}
