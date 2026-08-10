'use client'

import { ChevronDownIcon } from 'lucide-react'
import { useState } from 'react'

import { cn } from '@/lib/utils'

/**
 * Аккордеон показателей: раскрыт один, остальные — свёрнутые заголовки.
 *
 * Каркас, шаг 3.1. Содержимое панелей пока прежнее (коридор, график, список
 * замеров) — крупное значение, тренд и период приедут следующими шагами, а
 * свёрнутая строка обрастёт последним значением и дельтой в 3.3.
 *
 * Устроено по образцу TrackerTabs: ПАНЕЛИ ПРИХОДЯТ ГОТОВЫМИ УЗЛАМИ, собранными
 * на сервере. Так LabsHistory остаётся серверным компонентом и продолжает
 * делать своё — listLabRangesServer, getTranslations, группировку и дельты, —
 * а клиент отвечает ровно за одно: какая панель видима. Ни один серверный
 * запрос сюда не переезжает.
 *
 * Состояние — ЛОКАЛЬНЫЙ useState, а не контекст. TrackerTabProvider живёт
 * только на /tracker (page.tsx:60), а история рендерится ещё и на /labs, где
 * провайдера нет: useTrackerTab там бросил бы «вызван вне
 * TrackerTabProvider». Локальное состояние работает на обоих экранах и ни от
 * чего не зависит.
 *
 * Следствие оттуда же, о котором стоит помнить: TrackerTabs держит в разметке
 * ТОЛЬКО активную вкладку ({panels[tab]}), так что при уходе на «Сегодня» и
 * возврате поддерево «Анализов» пересоздаётся и выбор показателя сбрасывается
 * на дефолтный. Для каркаса это приемлемо; понадобится сохранять — поднимем
 * состояние на уровень страницы отдельным заходом.
 */
export interface AccordionItem {
  /** Ключ группы из groupByAnalyte: код показателя либо other:<название>. */
  key: string
  title: string
  /** Готовый серверный узел с содержимым группы. */
  panel: React.ReactNode
}

export function LabsAccordion({
  items,
  initialKey,
}: {
  items: AccordionItem[]
  /** Какой показатель раскрыт при первом рендере. */
  initialKey: string | null
}) {
  const [openKey, setOpenKey] = useState<string | null>(initialKey)

  return (
    <div className="space-y-4">
      {items.map((item) => {
        const isOpen = item.key === openKey
        return (
          <section key={item.key}>
            {/* Заголовок остаётся h2 — кнопка внутри, а не вместо. Иначе
                структура заголовков экрана рассыпалась бы для скринридера. */}
            <h2>
              <button
                type="button"
                onClick={() => setOpenKey(isOpen ? null : item.key)}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between gap-3 py-2 text-left font-heading text-xl text-foreground/70 transition-colors hover:text-foreground"
              >
                {item.title}
                <ChevronDownIcon
                  className={cn(
                    'size-5 shrink-0 transition-transform',
                    isOpen && 'rotate-180',
                  )}
                  strokeWidth={1.8}
                />
              </button>
            </h2>

            {/* Свёрнутая панель не рендерится вовсе, а не прячется классом:
                в ней живут графики и E2E-компоненты (LabNote, LabPhoto), и
                держать шесть таких поддеревьев в DOM ради анимации незачем. */}
            {isOpen && <div className="mt-2">{item.panel}</div>}
          </section>
        )
      })}
    </div>
  )
}
