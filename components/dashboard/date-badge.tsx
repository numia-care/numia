'use client'

import { useState } from 'react'

// Бейдж сегодняшней даты — ЗАМЕР эталона today.jpg: тёмная пилюля 94.8×23.9,
// r:12, заливка #262626 (= --brand-ink), внутри «23/09/26» одной строкой
// пиксельным Bitcount (--font-numeric, уже подключён в layout.tsx).
// Глифы 8.6 высотой → кегль ~13, боковой паддинг 12.6.
//
// Прежний бейдж (96×105, радиальный градиент, крупное число дня + месяц
// словом) был собран по раннему фрейму — финальный макет заменил его целиком.
//
// Дата локальная, считается в инициализаторе: на SSR значения нет, после
// гидрации появляется реальное — расхождение гасим suppressHydrationWarning,
// как в Greeting.
//
// БЕЗ aria-hidden, в отличие от старого бейджа: длинную дату из приветствия
// («среда, 29 июля») мы убрали, и теперь это единственная дата на экране —
// спрятать её от скринридера значило бы просто её потерять.

const fmt = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
})

export function DateBadge() {
  const [d] = useState(() => {
    if (typeof window === 'undefined') return { text: '', iso: '' }
    const now = new Date()
    return {
      // ru-RU 2-digit даёт «23.09.26» — в макете разделитель косой.
      text: fmt.format(now).replace(/\./g, '/'),
      iso: now.toISOString().slice(0, 10),
    }
  })

  return (
    <time
      suppressHydrationWarning
      dateTime={d.iso}
      className="font-numeric inline-flex h-[24px] items-center justify-center rounded-[12px] px-[13px] text-[13px] leading-none text-background"
      style={{ backgroundColor: 'var(--brand-ink)' }}
    >
      {d.text}
    </time>
  )
}
