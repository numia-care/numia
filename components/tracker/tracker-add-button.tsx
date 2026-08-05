'use client'

import { PlusIcon } from 'lucide-react'
import Link from 'next/link'

import { useTrackerTab } from './tracker-tab-context'

/**
 * Круглый «+» d=52 в строке заголовка «Препаратов». Диаметр — из единой
 * системы размеров (полировка, заход 2): 52 у действий уровня экрана, 38 у
 * действий внутри карточек. Замер Кая давал здесь 47 — переопределён
 * осознанно, ради того чтобы круглых диаметров в приложении было два, а не
 * девять.
 *
 * Контекстный: на вкладке «Анализы» ведёт на добавление анализа, на
 * «Сегодня» и «Все» — препарата. Раньше href был захардкожен на
 * /tracker/new, и с «Анализов» кнопка добавляла препарат.
 *
 * На «Истории» кнопки нет: добавить прошлый приём вручную нельзя — слоты
 * порождает расписание, а отмечают их тапом по строке. Кнопка «добавить»
 * там обещала бы действие, которого нет. Строка заголовка держит высоту
 * (min-h-[52px]), поэтому при скрытии ничего не схлопывается.
 *
 * Переводы приходят пропсами: компонент клиентский, а словарь читается на
 * сервере — так же устроены labels у TrackerTabs.
 */
export function TrackerAddButton({
  medicationLabel,
  labLabel,
}: {
  medicationLabel: string
  labLabel: string
}) {
  const { tab } = useTrackerTab()

  if (tab === 'history') return null

  const isLabs = tab === 'analyses'

  return (
    <Link
      href={isLabs ? '/labs/new' : '/tracker/new'}
      aria-label={isLabs ? labLabel : medicationLabel}
      className="shadow-card absolute right-0 flex size-[52px] items-center justify-center rounded-full bg-card text-foreground transition-colors hover:bg-secondary"
    >
      <PlusIcon className="size-5" />
    </Link>
  )
}
