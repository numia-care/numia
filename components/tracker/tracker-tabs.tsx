'use client'

import {
  CalendarDaysIcon,
  LayoutListIcon,
  LineChartIcon,
  PlusIcon,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import Link from 'next/link'

import { cn } from '@/lib/utils'

// Сегмент-контрол экрана препаратов по макету Кая (571:66–74): три таба
// (Сегодня / Все / Анализы) + круглый «+» справа. Активный таб — свой пастельный
// тон (у Кая «Все» голубой, «Анализы» розовый — сохраняем игривость). Панели
// приходят готовыми server-компонентами (рендерятся на сервере, клиент
// переключает видимую) — данные для всех трёх табов уже в разметке.

type TabKey = 'today' | 'all' | 'analyses'

interface TabDef {
  key: TabKey
  label: string
  icon: LucideIcon
  active: string // класс фона активного таба (пастель Кая)
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
    { key: 'today', label: labels.today, icon: CalendarDaysIcon, active: 'bg-chip-blue' },
    { key: 'all', label: labels.all, icon: LayoutListIcon, active: 'bg-cyan-tab' },
    { key: 'analyses', label: labels.analyses, icon: LineChartIcon, active: 'bg-pink-soft' },
  ]

  return (
    <>
      <div className="mb-6 flex items-center gap-2">
        {tabs.map((tabDef) => {
          const Icon = tabDef.icon
          const isActive = tab === tabDef.key
          return (
            <button
              key={tabDef.key}
              type="button"
              onClick={() => setTab(tabDef.key)}
              aria-pressed={isActive}
              className={cn(
                'shadow-card flex flex-1 flex-col items-center gap-1 rounded-[24px] border border-border px-2 py-2.5 text-[11px] font-semibold transition-colors',
                isActive ? tabDef.active + ' text-foreground' : 'bg-card/80 text-foreground/60 hover:text-foreground',
              )}
            >
              <Icon className="size-4" />
              {tabDef.label}
            </button>
          )
        })}

        {/* Круглый «+» — белый с волосяной обводкой (по фрейму). */}
        <Link
          href={addHref}
          aria-label={addLabel}
          className="shadow-card flex size-[50px] shrink-0 items-center justify-center rounded-full border border-black/10 bg-card text-foreground transition-colors hover:bg-secondary"
        >
          <PlusIcon className="size-5" />
        </Link>
      </div>

      {tab === 'today' ? today : tab === 'all' ? all : analyses}
    </>
  )
}
