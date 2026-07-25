'use client'

import { BookOpenIcon } from 'lucide-react'
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
    // По заполненному фрейму Кая: мягкая жёлтая карточка (r:20, стекло),
    // в шапке — иконка книжки + дата события жирным 13px, ниже текст 13px.
    // Режим ротации помечаем мягким суффиксом (в макете его нет, но без него
    // факт от чужой даты читается как ошибка — решение от 2026-07-06).
    <div
      suppressHydrationWarning
      className="rounded-lg border border-chip-yellow-border/60 bg-chip-yellow/70 p-5 shadow-card backdrop-blur-[9px]"
    >
      <p className="flex items-center gap-2 text-[13px] font-medium text-foreground">
        <BookOpenIcon className="size-4 shrink-0" aria-hidden />
        {picked.fact.label}
        {!picked.onThisDay && (
          <span className="font-normal text-foreground/60">
            · {t('historyTitle')}
          </span>
        )}
      </p>
      <p className="mt-2 text-[13px] leading-relaxed text-foreground">
        {picked.fact.text}
      </p>
    </div>
  )
}
