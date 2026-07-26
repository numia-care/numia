'use client'

import {
  ArrowUpDownIcon,
  CameraIcon,
  LayoutGridIcon,
  MicIcon,
  PencilIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  WavesIcon,
  type LucideIcon,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'

import { cn } from '@/lib/utils'

export type TypeFilter = 'photo' | 'voice' | 'diary' | null
export type PathView = 'path' | 'grid'

// Верхний тулбар «Пути» по макету Кая (фрейм 583:155): пять контролов —
// сортировка, «показать все», и три фильтра по типу записи (фото / голос /
// дневник) — плюс переключатель вида (дорожка/мозаика) и круглый «+».
// Активный фильтр подсвечен лавандой (--accent).
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

  return (
    <div className="mb-6 flex items-center gap-1.5">
      {/* Сортировка */}
      <ToolButton
        icon={ArrowUpDownIcon}
        label={sortDesc ? t('sort') : t('sortAsc')}
        onClick={onToggleSort}
      />
      {/* Показать все (сброс фильтра типа) */}
      <ToolButton
        icon={SlidersHorizontalIcon}
        label={t('all')}
        active={activeType === null}
        onClick={() => onSelectType(null)}
      />

      {/* Фильтры по типу — тап переключает (повторный тап снимает). */}
      <ToolButton
        icon={CameraIcon}
        label={t('photo')}
        active={activeType === 'photo'}
        onClick={() => onSelectType(activeType === 'photo' ? null : 'photo')}
      />
      <ToolButton
        icon={MicIcon}
        label={t('audio')}
        active={activeType === 'voice'}
        onClick={() => onSelectType(activeType === 'voice' ? null : 'voice')}
      />
      <ToolButton
        icon={PencilIcon}
        label={t('diary')}
        active={activeType === 'diary'}
        onClick={() => onSelectType(activeType === 'diary' ? null : 'diary')}
      />

      <div className="ml-auto flex items-center gap-1.5">
        {/* Вид: дорожка ↔ мозаика */}
        <ToolButton
          icon={view === 'path' ? LayoutGridIcon : WavesIcon}
          label={view === 'path' ? t('viewGrid') : t('viewPath')}
          onClick={onToggleView}
        />
        {/* Добавить */}
        <Link
          href={addHref}
          aria-label={t('add')}
          className="shadow-card flex size-10 shrink-0 items-center justify-center rounded-full border border-black/10 bg-card text-foreground transition-colors hover:bg-secondary"
        >
          <PlusIcon className="size-5" />
        </Link>
      </div>
    </div>
  )
}

function ToolButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: LucideIcon
  label: string
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cn(
        'shadow-card flex size-10 shrink-0 items-center justify-center rounded-full border border-border transition-colors',
        active
          ? 'bg-accent text-foreground'
          : 'bg-card/80 text-foreground/60 hover:text-foreground',
      )}
    >
      <Icon className="size-[18px]" />
    </button>
  )
}
