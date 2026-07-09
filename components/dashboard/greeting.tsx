'use client'

import { useState } from 'react'

import { pickGreeting } from '@/lib/dashboard/greetings'
import { getAddressForm, getDisplayName } from '@/lib/profile/local'

// Приветствие на дашборде: «Привет, [имя] ✦» + дата + тёплая фраза с учётом
// рода обращения. Имя/род читаем из локального профиля (localStorage), время —
// текущее. Всё это клиентское: на сервере значений нет, поэтому считаем в
// инициализаторе useState (на SSR → запасной «Привет ✦»), а несовпадение
// гидрации на этом блоке гасим suppressHydrationWarning. После гидрации
// показываются реальные имя/фраза/дата.

const dateFmt = new Intl.DateTimeFormat('ru-RU', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
})

export function Greeting() {
  const [data] = useState(() => {
    if (typeof window === 'undefined') {
      return { name: null as string | null, phrase: '', date: '' }
    }
    const now = new Date()
    return {
      name: getDisplayName(),
      phrase: pickGreeting(getAddressForm(), now),
      date: dateFmt.format(now),
    }
  })

  return (
    // По фрейму Кая: заголовок 30px без ✦ (звезда теперь в шапке страницы),
    // letter-spacing слегка ужат, тёплая фраза под ним.
    <div suppressHydrationWarning>
      <h1 className="text-3xl tracking-[-0.03em] text-foreground">
        Привет{data.name ? `, ${data.name}` : ''}
      </h1>
      {data.phrase && (
        <p className="mt-2 text-base text-[#242424]">{data.phrase}</p>
      )}
      {data.date && (
        <p className="mt-1 text-sm text-muted-foreground">{data.date}</p>
      )}
    </div>
  )
}
