'use client'

import { ChevronDownIcon } from 'lucide-react'
import { useState } from 'react'

import { cn } from '@/lib/utils'

/**
 * Аккордеон показателей: раскрыт один, остальные — свёрнутые заголовки.
 *
 * Свёрнутая строка информативна: название, границы коридора, последнее
 * значение и дельта — чтобы не разворачивать показатель ради одной цифры.
 * Собирается на сервере и приходит сюда готовым узлом (см. summary ниже).
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
  /** Заголовок раскрытого показателя — одно название, без цифр. */
  title: string
  /**
   * Свёрнутая строка целиком, собранная на сервере: название, границы
   * коридора, последнее значение и дельта. Клиент её только показывает и
   * дорисовывает шеврон — ни чтения БД, ни расчётов сюда не переезжает.
   */
  summary: React.ReactNode
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
                className="flex w-full items-center gap-3 py-2 text-left transition-colors"
              >
                {/* Раскрытый показывает только название: цифры уже стоят
                    крупно в карточке под ним, дубль был бы шумом. Свёрнутый
                    несёт всю строку — название, границы, значение, дельту.

                    Внутри <button> допустим только phrasing content, поэтому
                    вся раскладка на span с flex/block-классами, а не на div:
                    вложенный div сделал бы разметку невалидной. */}
                <span className="min-w-0 flex-1">
                  {isOpen ? (
                    <span className="font-heading text-xl text-foreground">
                      {item.title}
                    </span>
                  ) : (
                    item.summary
                  )}
                </span>

                <ChevronDownIcon
                  className={cn(
                    'size-5 shrink-0 text-foreground/40 transition-transform',
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
