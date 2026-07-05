'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import { pickQueerFact } from '@/lib/dashboard/queer-history'

// Карточка квир-истории дня. Факт выбираем по локальной дате: совпадение
// дня/месяца → заголовок «В этот день ✦»; иначе ротация по дню года → «Из
// квир-истории ✦» БЕЗ даты в заголовке (иначе «Сегодня в истории» + факт от
// другого числа читается как ошибка). Дата/год события остаётся в теле
// (fact.label). Считаем в инициализаторе useState; near-midnight расхождение
// SSR(UTC)/клиент(локаль) гасим suppressHydrationWarning — после гидрации
// показывается факт по локальной дате.
export function QueerHistoryCard() {
  const t = useTranslations('dashboard')
  const [picked] = useState(() => pickQueerFact(new Date()))

  return (
    <div
      suppressHydrationWarning
      className="rounded-2xl bg-card p-5 ring-1 ring-border"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-moss">
        {picked.onThisDay ? t('historyToday') : t('historyTitle')}
      </p>
      <p className="mt-2 text-sm text-foreground/55">{picked.fact.label}</p>
      <p className="mt-1 leading-relaxed text-foreground/90">{picked.fact.text}</p>
    </div>
  )
}
