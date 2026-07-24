'use client'

import { ChevronDownIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import Link from 'next/link'

import { formatNextIntake, nextIntakeLocal } from '@/lib/tracker/next-intake'
import type { MedicationRow } from '@/lib/tracker/queries'
import type { Schedule } from '@/lib/tracker/schedule'
import { formatDoseWithUnit } from '@/lib/tracker/units'
import { cn } from '@/lib/utils'

import { MedicationDeleteButton } from './medication-delete-button'

// Препарат в списке — строка-пилюля по фрейму Кая (серая, r:40 свёрнутая):
//   имя … «доза • форма» [шеврон]
// Разворот: расписание + бейдж типа + действия (Изменить / Убрать).
// Клиентский: разворот — локальный state.
export function MedicationCard({ med }: { med: MedicationRow }) {
  const t = useTranslations('tracker')
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      className={cn(
        'border border-[#D4D4D4] bg-[#EDEBE9] shadow-card transition-[border-radius] duration-200',
        // Свёрнуто — фиксированные 26px (= половина высоты 52px, выглядит как
        // пилюля), НЕ rounded-full. rounded-full = 9999px: при развороте карточка
        // мгновенно становится высокой, и пока transition тянет радиус вниз, на
        // высоком элементе он читается как «капсула» с радиусом в полвысоты —
        // отсюда эффект «сдавливается, потом расправляется». 26px→25px незаметно.
        expanded ? 'rounded-[25px]' : 'rounded-[26px]',
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left"
      >
        <span className="min-w-0 flex-1 truncate text-sm text-[#1F1F1F]">
          {med.name}
        </span>
        <span className="shrink-0 text-xs text-[#1F1F1F]/80">
          {formatDoseWithUnit(med.dose_amount, med.dose_unit)} •{' '}
          {t(`medForm.${med.form}`)}
        </span>
        <ChevronDownIcon
          className={cn(
            'size-4 shrink-0 text-[#1F1F1F]/70 transition-transform',
            expanded && 'rotate-180',
          )}
        />
      </button>

      {expanded && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-3">
          <div className="min-w-0">
            <p className="text-[11px] leading-snug text-[#1F1F1F]/70">
              {formatSchedule(med.schedule, t)}
            </p>
            <NextIntakeLine med={med} />
            <KindBadge kind={med.kind} />
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Link
              href={`/tracker/${med.id}/edit`}
              className="rounded-full px-3 py-1.5 text-xs text-[#1F1F1F]/70 transition-colors hover:bg-white/50 hover:text-[#1F1F1F]"
            >
              {t('card.editButton')}
            </Link>
            <MedicationDeleteButton id={med.id} name={med.name} />
          </div>
        </div>
      )}
    </div>
  )
}

// «следующий: чт, 23:00» — избавляет от счёта в уме, когда следующий приём
// у интервального расписания (фидбек беты). Считается в момент разворота
// карточки (компонент рендерится только в expanded), локальным временем
// устройства — SSR его не трогает, гидрации нечему расходиться.
function NextIntakeLine({ med }: { med: MedicationRow }) {
  const t = useTranslations('tracker')
  const slot = nextIntakeLocal(med.schedule, {
    startDate: med.start_date,
    endDate: med.end_date,
  })
  if (!slot) return null
  const when = formatNextIntake(slot, {
    today: t('card.nextToday'),
    tomorrow: t('card.nextTomorrow'),
  })
  return (
    <p className="mt-0.5 text-[11px] font-medium leading-snug text-[#1F1F1F]">
      {t('card.next', { when })}
    </p>
  )
}

// Бейдж типа — пастельные пары концепции.
function KindBadge({ kind }: { kind: MedicationRow['kind'] }) {
  const t = useTranslations('tracker')
  const palette: Record<MedicationRow['kind'], string> = {
    estrogen: 'border-chip-pink-border bg-chip-pink text-[#542E42]',
    antiandrogen: 'border-chip-yellow-border bg-chip-yellow text-[#6B5A1E]',
    progesterone: 'border-[#EBCEFF] bg-[#E8BAF7]/60 text-[#5A3A6B]',
    testosterone: 'border-chip-blue-border bg-chip-blue text-[#2E4A5A]',
    other: 'border-[#D4D4D4] bg-white/60 text-[#5A5A5A]',
  }
  return (
    <span
      className={`mt-1.5 inline-block rounded-full border px-2.5 py-0.5 text-[10px] font-medium ${palette[kind]}`}
    >
      {t(`kind.${kind}`)}
    </span>
  )
}

type TranslateFunc = ReturnType<typeof useTranslations<'tracker'>>

function formatSchedule(schedule: Schedule, t: TranslateFunc): string {
  if (schedule.kind === 'daily') {
    const times = [...schedule.times].sort().join(', ')
    return t('schedule.dailySummary', { times })
  }
  const n = schedule.every_days
  const days = daysWord(n, t)
  return t('schedule.intervalSummary', { count: n, days, time: schedule.time })
}

function daysWord(n: number, t: TranslateFunc): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 14) return t('schedule.daysMany')
  if (mod10 === 1) return t('schedule.daysOne')
  if (mod10 >= 2 && mod10 <= 4) return t('schedule.daysFew')
  return t('schedule.daysMany')
}
