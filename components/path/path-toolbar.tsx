'use client'

import {
  ArrowUpDownIcon,
  CameraIcon,
  FeatherIcon,
  FilterIcon,
  LayoutGridIcon,
  MicIcon,
  PlusIcon,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'

import { cn } from '@/lib/utils'

export type TypeFilter = 'photo' | 'voice' | 'diary' | null
export type PathView = 'path' | 'grid'

// Тулбар «Пути» по PNG-эталонам «путь1/2/3»:
//   [⇅ сортировка] [воронка]                    [+]   — свёрнуто (путь1)
//   [⇅] [ пилюля: (воронка·лаванда) 📷 🎙 🪶 ]  [+]   — воронка раскрыта (путь2)
// Тап по воронке раскрывает/сворачивает пилюлю фильтров по типу; тап по типу
// фильтрует ленту (повторный — снимает). Переключатель вида (дорожка/мозаика) —
// ПЛАВАЮЩАЯ круглая кнопка слева внизу (лаванда, когда активна мозаика, путь3).

export function PathToolbar({
  activeType,
  onSelectType,
  sortDesc,
  onToggleSort,
  view,
  onToggleView,
  addHref,
}: {
  activeType: TypeFilter
  onSelectType: (type: TypeFilter) => void
  sortDesc: boolean
  onToggleSort: () => void
  view: PathView
  onToggleView: () => void
  addHref: string
}) {
  const t = useTranslations('path.toolbar')
  const [expanded, setExpanded] = useState(false)

  function toggleFunnel() {
    // Сворачивание воронки снимает фильтр — свёрнутый тулбар показывает всё.
    if (expanded) onSelectType(null)
    setExpanded((v) => !v)
  }

  const typeBtn = (
    type: Exclude<TypeFilter, null>,
    Icon: typeof CameraIcon,
    label: string,
  ) => (
    <button
      type="button"
      onClick={() => onSelectType(activeType === type ? null : type)}
      aria-label={label}
      aria-pressed={activeType === type}
      title={label}
      className={cn(
        'flex size-11 items-center justify-center rounded-full transition-colors',
        activeType === type
          ? 'bg-accent text-foreground'
          : 'text-foreground/80 hover:text-foreground',
      )}
    >
      <Icon className="size-[22px]" strokeWidth={1.8} />
    </button>
  )

  return (
    <>
      <div className="mb-7 flex items-center gap-2.5">
        {/* Сортировка */}
        <button
          type="button"
          onClick={onToggleSort}
          aria-label={sortDesc ? t('sort') : t('sortAsc')}
          title={sortDesc ? t('sort') : t('sortAsc')}
          className="shadow-card flex size-[52px] shrink-0 items-center justify-center rounded-full bg-card text-foreground transition-colors hover:bg-secondary"
        >
          <ArrowUpDownIcon className="size-[22px]" strokeWidth={1.8} />
        </button>

        {/* Воронка: свёрнута — отдельный круг; раскрыта — пилюля с типами. */}
        {expanded ? (
          <div className="shadow-card flex h-[52px] items-center gap-1 rounded-full bg-card px-1.5">
            <button
              type="button"
              onClick={toggleFunnel}
              aria-label={t('all')}
              aria-expanded
              className="flex size-11 items-center justify-center rounded-full bg-accent text-foreground"
            >
              <FilterIcon className="size-[22px]" strokeWidth={1.8} />
            </button>
            {typeBtn('photo', CameraIcon, t('photo'))}
            {typeBtn('voice', MicIcon, t('audio'))}
            {typeBtn('diary', FeatherIcon, t('diary'))}
          </div>
        ) : (
          <button
            type="button"
            onClick={toggleFunnel}
            aria-label={t('all')}
            aria-expanded={false}
            className="shadow-card flex size-[52px] shrink-0 items-center justify-center rounded-full bg-card text-foreground transition-colors hover:bg-secondary"
          >
            <FilterIcon className="size-[22px]" strokeWidth={1.8} />
          </button>
        )}

        {/* Добавить запись */}
        <Link
          href={addHref}
          aria-label={t('add')}
          className="shadow-card ml-auto flex size-[52px] shrink-0 items-center justify-center rounded-full bg-card text-foreground transition-colors hover:bg-secondary"
        >
          <PlusIcon className="size-[22px]" strokeWidth={1.8} />
        </Link>
      </div>

      {/* Плавающий переключатель вида — слева над навигацией (по эталону). */}
      <button
        type="button"
        onClick={onToggleView}
        aria-label={view === 'path' ? t('viewGrid') : t('viewPath')}
        aria-pressed={view === 'grid'}
        title={view === 'path' ? t('viewGrid') : t('viewPath')}
        className={cn(
          'shadow-card fixed bottom-[calc(6.2rem+env(safe-area-inset-bottom))] left-5 z-30 flex size-[52px] items-center justify-center rounded-full transition-colors',
          view === 'grid' ? 'bg-accent text-foreground' : 'bg-card text-foreground',
        )}
      >
        <LayoutGridIcon className="size-[22px]" strokeWidth={1.8} />
      </button>
    </>
  )
}
