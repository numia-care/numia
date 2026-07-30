'use client'

import { CircleIcon, PlusIcon, TrendingUpIcon } from 'lucide-react'
import { useState } from 'react'
import Link from 'next/link'

import { TodayIcon } from '@/components/icons/kai'
import { cn } from '@/lib/utils'

// Табы экрана «Препараты» — ЗАМЕР эталонов преппараты1/2/3:
//   пилюля 62×57, радиус ~16, зазор 9 (замер 8.6–9.9), прижаты ВЛЕВО;
//   круглый «+» d=47 отдельно справа;
//   активный таб залит своим цветом (--kai-tab-*, замер из центра пилюли).
//
// Раньше пилюли были на flex-1 и растягивались на всю ширину (~110 каждая) —
// это и было главное расхождение с макетом, цвета вторичны.
//
// Панели приходят готовыми server-компонентами (рендерятся на сервере, клиент
// переключает видимую) — данные для всех трёх табов уже в разметке.

type TabKey = 'today' | 'all' | 'analyses'

interface TabDef {
  key: TabKey
  label: string
  icon: (props: { className?: string }) => React.ReactNode
  active: string // класс заливки активного таба (замер Кая)
}

export function TrackerTabs({
  today,
  all,
  analyses,
  labels,
  addHref,
  addLabel,
  initial = 'today',
}: {
  today: React.ReactNode
  all: React.ReactNode
  analyses: React.ReactNode
  labels: { today: string; all: string; analyses: string }
  addHref: string
  addLabel: string
  initial?: TabKey
}) {
  const [tab, setTab] = useState<TabKey>(initial)

  const tabs: TabDef[] = [
    {
      key: 'today',
      label: labels.today,
      // ✦ из набора Кая — ровно та иконка, что в макете.
      icon: (p) => <TodayIcon {...p} />,
      active: 'bg-tab-today',
    },
    {
      key: 'all',
      label: labels.all,
      // TODO: заменить на иконку Кая — в наборе /icons кружка пока нет.
      icon: (p) => <CircleIcon {...p} strokeWidth={2.4} />,
      active: 'bg-tab-all',
    },
    {
      key: 'analyses',
      label: labels.analyses,
      // TODO: заменить на иконку Кая — в наборе /icons графика пока нет.
      icon: (p) => <TrendingUpIcon {...p} strokeWidth={2.4} />,
      active: 'bg-tab-analyses',
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

        {/* Круглый «+» d=47 (замер), прижат вправо. */}
        <Link
          href={addHref}
          aria-label={addLabel}
          className="shadow-card ml-auto flex size-[47px] shrink-0 items-center justify-center rounded-full bg-card text-foreground transition-colors hover:bg-secondary"
        >
          <PlusIcon className="size-5" />
        </Link>
      </div>

      {tab === 'today' ? today : tab === 'all' ? all : analyses}
    </>
  )
}
