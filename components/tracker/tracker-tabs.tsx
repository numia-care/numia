'use client'

import { CircleIcon, HistoryIcon, TrendingUpIcon } from 'lucide-react'

import { TodayIcon } from '@/components/icons'
import { cn } from '@/lib/utils'

import type { TabKey } from '@/lib/tracker/tab-key'

import { useTrackerTab } from './tracker-tab-context'

// Табы экрана «Препараты» — ЗАМЕР эталонов преппараты1/2/3:
//   пилюля 62×57, радиус ~16, зазор 9 (замер 8.6–9.9), прижаты ВЛЕВО;
//   активный таб залит своим цветом (--brand-tab-*, замер из центра пилюли).
//
// Раньше пилюли были на flex-1 и растягивались на всю ширину (~110 каждая) —
// это и было главное расхождение с макетом, цвета вторичны.
//
// Круглый «+» (тогда d=47, ныне 52) ЖИЛ ЗДЕСЬ, справа в этом же ряду через ml-auto. С
// появлением четвёртой вкладки он переехал в строку заголовка (page.tsx).
// Причина — арифметика: 4×62 + 4×9 + 47 = 331px, а поле страницы даёт
// 319px на 375px-экране и 304px на 360px — «плюс» обрезался бы (все
// элементы shrink-0, родитель overflow-hidden). Из вариантов «сузить
// пилюлю», «сузить зазор» и «увести плюс» выбран последний: он
// единственный не трогает ни одного замеренного числа. Ряд из четырёх
// пилюль — 4×62 + 3×9 = 275px, влезает с запасом 44px даже на 375.
//
// Панели приходят готовыми server-компонентами (рендерятся на сервере, клиент
// переключает видимую) — данные для всех вкладок уже в разметке.
//
// Активная вкладка живёт в TrackerTabProvider, а не в локальном useState:
// её же читает круглый «+» из строки заголовка, чтобы вести на добавление
// анализа с «Анализов» и препарата — с остальных вкладок.

interface TabDef {
  key: TabKey
  label: string
  icon: (props: { className?: string }) => React.ReactNode
  active: string // класс заливки активного таба (замер макета)
}

export function TrackerTabs({
  today,
  all,
  analyses,
  history,
  labels,
}: {
  today: React.ReactNode
  all: React.ReactNode
  analyses: React.ReactNode
  history: React.ReactNode
  labels: { today: string; all: string; analyses: string; history: string }
}) {
  const { tab, setTab } = useTrackerTab()

  const panels: Record<TabKey, React.ReactNode> = {
    today,
    all,
    analyses,
    history,
  }

  const tabs: TabDef[] = [
    {
      key: 'today',
      label: labels.today,
      // ✦ из набора — ровно та иконка, что в макете.
      icon: (p) => <TodayIcon {...p} />,
      active: 'bg-tab-today',
    },
    {
      key: 'all',
      label: labels.all,
      // TODO: заменить на иконку набора — в локальном наборе исходников кружка пока нет.
      icon: (p) => <CircleIcon {...p} strokeWidth={2.4} />,
      active: 'bg-tab-all',
    },
    {
      key: 'analyses',
      label: labels.analyses,
      // TODO: заменить на иконку набора — в локальном наборе исходников графика пока нет.
      icon: (p) => <TrendingUpIcon {...p} strokeWidth={2.4} />,
      active: 'bg-tab-analyses',
    },
    {
      key: 'history',
      label: labels.history,
      // TODO: заменить на иконку набора — в локальном наборе исходников истории пока нет,
      // как и у двух соседей выше. Временно lucide.
      icon: (p) => <HistoryIcon {...p} strokeWidth={2.4} />,
      active: 'bg-tab-history',
    },
  ]

  return (
    <>
      {/* Зазор 9 — среднее замера (8.6 и 9.9 между тремя пилюлями). */}
      <div className="mb-6 flex items-center gap-[9px]">
        {tabs.map((tabDef) => {
          const isActive = tab === tabDef.key
          return (
            <button
              key={tabDef.key}
              type="button"
              onClick={() => setTab(tabDef.key)}
              aria-pressed={isActive}
              className={cn(
                // 62×57 и r:16 — замер пилюли; НЕ flex-1, ширина фиксированная.
                'shadow-card flex h-[57px] w-[62px] shrink-0 flex-col items-center justify-center gap-1 rounded-[16px] text-[11px] font-semibold transition-colors',
                isActive
                  ? tabDef.active + ' text-foreground'
                  : 'bg-card text-foreground/70 hover:text-foreground',
              )}
            >
              {tabDef.icon({ className: 'size-[15px]' })}
              {tabDef.label}
            </button>
          )
        })}
      </div>

      {panels[tab]}
    </>
  )
}
