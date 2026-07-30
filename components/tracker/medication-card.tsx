'use client'

import { ChevronDownIcon, SquarePenIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import Link from 'next/link'

import { formatNextIntake, nextIntakeLocal } from '@/lib/tracker/next-intake'
import type { MedicationRow } from '@/lib/tracker/queries'
import type { Schedule } from '@/lib/tracker/schedule'
import { formatDoseWithUnit } from '@/lib/tracker/units'
import { cn } from '@/lib/utils'

import { MedFormIcon } from './med-form-icon'
import { MedicationDeleteButton } from './medication-delete-button'

// Карточка препарата — ЗАМЕР эталона преппараты2:
//   [название … доза] [белый круг-шеврон]
// Заливка — фирменный градиент белый→бледно-голубой (--kai-grad-med, токен).
// Свёрнуто 53.7 (полная пилюля), развёрнуто 93.5 при r:27, зазор между
// карточками 4 (замер 3.3–4.6).
// Разворот: иконка формы слева, расписание и ближайший приём, справа — две
// пилюли-действия: белая с карандашом и розовая с корзиной (в макете это
// иконки, а не текстовые «Изменить»/«Убрать»).
export function MedicationCard({ med }: { med: MedicationRow }) {
  const t = useTranslations('tracker')
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      className={cn(
        'shadow-card transition-[border-radius] duration-200',
        expanded ? 'rounded-[27px]' : 'rounded-full',
      )}
      // Градиент — из токена-примитива (тема может переопределить --kai-grad-med).
      style={{ backgroundImage: 'var(--kai-grad-med)' }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex min-h-[52px] w-full items-center gap-3 py-2 pr-2 pl-5 text-left"
      >
        <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-foreground">
          {med.name}
        </span>
        <span className="shrink-0 text-xs text-foreground/70">
          {formatDoseWithUnit(med.dose_amount, med.dose_unit)}
        </span>
        {/* Белый круг с шевроном — контрол разворота (по фрейму). */}
        <span className="shadow-soft flex size-8 shrink-0 items-center justify-center rounded-full bg-card">
          <ChevronDownIcon
            className={cn(
              'size-4 text-foreground/70 transition-transform',
              expanded && 'rotate-180',
            )}
          />
        </span>
      </button>

      {expanded && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 pb-4">
          {/* Иконка формы слева от описания — по макету. */}
          <div className="flex min-w-0 items-center gap-3">
            <MedFormIcon form={med.form} className="size-5 shrink-0 text-foreground" />
            <div className="min-w-0">
              <p className="text-[11px] leading-snug text-foreground/70">
                {formatSchedule(med.schedule, t)}
              </p>
              <NextIntakeLine med={med} />
              <KindBadge kind={med.kind} />
            </div>
          </div>

          {/* Пилюли-действия 47×29, r:14 (замер). Подписи ушли в aria-label —
              в макете это иконки без текста. */}
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href={`/tracker/${med.id}/edit`}
              aria-label={t('card.editButton')}
              title={t('card.editButton')}
              className="shadow-soft flex h-[29px] w-[47px] items-center justify-center rounded-full bg-card text-foreground transition-colors hover:bg-white"
            >
              <SquarePenIcon className="size-[18px]" strokeWidth={1.8} />
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
    <p className="mt-0.5 text-[11px] font-medium leading-snug text-foreground">
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
    other: 'border-border bg-white/60 text-[#5A5A5A]',
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
