'use client'

import { useState } from 'react'

// Бейдж сегодняшней даты — фан-элемент концепции Кая (фрейм «сегодня»):
// сочный радиальный градиент (#FF6600 → #FF66B0 → #00CDF6), крупное число
// дня шрифтом Bitcount, месяц под ним. r:40. Дата локальная, считается в
// инициализаторе (SSR отдаёт пусто, после гидрации — реальная дата;
// расхождение гасим suppressHydrationWarning, как в Greeting).

const monthFmt = new Intl.DateTimeFormat('ru-RU', { month: 'long' })

export function DateBadge() {
  const [d] = useState(() => {
    if (typeof window === 'undefined') return { day: '', month: '' }
    const now = new Date()
    return { day: String(now.getDate()), month: monthFmt.format(now) }
  })

  return (
    <div
      suppressHydrationWarning
      aria-hidden
      // w-24 (96px): на 390px-экранах карточке «Как ты?» рядом нужен каждый
      // пиксель — 103px из макета (402px) ужаты пропорционально.
      className="flex h-[105px] w-24 shrink-0 flex-col items-center justify-center rounded-3xl text-white"
      style={{
        background:
          'radial-gradient(120% 120% at 20% 15%, #FF6600 10%, #FF66B0 55%, #00CDF6 100%)',
      }}
    >
      <span className="font-numeric text-[44px] leading-none">{d.day}</span>
      <span className="mt-1 text-sm font-semibold text-background">{d.month}</span>
    </div>
  )
}
