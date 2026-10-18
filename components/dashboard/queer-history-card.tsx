'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { ShareIcon } from '@/components/icons'
import { pickQueerFact } from '@/lib/dashboard/queer-history'

// Карточка квир-истории дня. Факт выбираем по локальной дате: совпадение
// дня/месяца → заголовок «В этот день ✦»; иначе ротация по дню года → «Из
// квир-истории ✦» БЕЗ даты в заголовке (иначе «Сегодня в истории» + факт от
// другого числа читается как ошибка). Дата/год события остаётся в теле
// (fact.label). Считаем в инициализаторе useState; near-midnight расхождение
// SSR(UTC)/клиент(локаль) гасим suppressHydrationWarning — после гидрации
// показывается факт по локальной дате.
//
// Вёрстка — ЗАМЕР эталона today.jpg: карточка БЕЛАЯ (#FBFBF9, не жёлтая — та
// была из раннего фрейма), ширина по колонке контента (края 26.5 и 363.5),
// радиус ~12–15 → --radius-md. Две колонки: слева дата и кнопка «поделиться»
// (белый кружок d≈41 у нижней кромки), справа текст факта с x≈137.5.
// Кегль даты и текста ~13, шаг строк ~15.5.
export function QueerHistoryCard() {
  const t = useTranslations('dashboard')
  const [picked] = useState(() => pickQueerFact(new Date()))

  // Поделиться фактом: системный шит, где есть; иначе — копия в буфер.
  // Личного тут нет (публичный исторический факт), наружу уходит только он.
  async function onShare() {
    const text = `${picked.fact.label} ${picked.fact.text}`
    try {
      if (navigator.share) {
        await navigator.share({ text })
        return
      }
      await navigator.clipboard.writeText(text)
      toast.success(t('historyCopied'))
    } catch {
      // Юзер закрыл системный шит — это не ошибка, молчим.
    }
  }

  return (
    <div
      suppressHydrationWarning
      className="rounded-md bg-card p-4 shadow-card"
    >
      <div className="flex gap-3">
        {/* Левая колонка: дата события сверху, кнопка «поделиться» снизу. */}
        <div className="flex w-[100px] shrink-0 flex-col justify-between">
          <p className="text-[13px] font-medium text-foreground">
            {picked.fact.label}
            {!picked.onThisDay && (
              <span className="block font-normal text-foreground/60">
                {t('historyTitle')}
              </span>
            )}
          </p>
          <button
            type="button"
            onClick={onShare}
            aria-label={t('historyShare')}
            title={t('historyShare')}
            className="shadow-soft mt-3 flex size-[38px] items-center justify-center rounded-full bg-white text-foreground transition-colors hover:bg-secondary"
          >
            <ShareIcon className="size-[18px]" />
          </button>
        </div>

        {/* Правая колонка: сам факт. Текст и подбор не трогаем. */}
        <p className="min-w-0 flex-1 text-[13px] leading-[1.45] text-foreground">
          {picked.fact.text}
        </p>
      </div>
    </div>
  )
}
