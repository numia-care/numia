import { getTranslations } from 'next-intl/server'
import Link from 'next/link'

import { Card } from '@/components/ui/card'
import type { MedicationRow } from '@/lib/tracker/queries'
import type { Schedule } from '@/lib/tracker/schedule'
import { formatDoseWithUnit } from '@/lib/tracker/units'

import { MedicationDeleteButton } from './medication-delete-button'

export async function MedicationCard({ med }: { med: MedicationRow }) {
  const t = await getTranslations('tracker')

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-heading text-lg leading-tight text-foreground">
            {med.name}
          </h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {formatDoseWithUnit(med.dose_amount, med.dose_unit)} ·{' '}
            {t(`medForm.${med.form}`)}
          </p>
        </div>
        <KindBadge kind={med.kind} />
      </div>

      <p className="text-sm text-foreground/80">
        {formatSchedule(med.schedule, t)}
      </p>

      <div className="-mb-1 -mr-1 flex justify-end gap-1 pt-1">
        <Link
          href={`/tracker/${med.id}/edit`}
          className="rounded-md px-2.5 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {t('card.editButton')}
        </Link>
        <MedicationDeleteButton id={med.id} name={med.name} />
      </div>
    </Card>
  )
}

type TranslateFunc = Awaited<ReturnType<typeof getTranslations<'tracker'>>>

async function KindBadge({ kind }: { kind: MedicationRow['kind'] }) {
  const t = await getTranslations('tracker')
  const palette: Record<MedicationRow['kind'], string> = {
    estrogen: 'bg-fairy/30 text-[#5A4A6B]',
    antiandrogen: 'bg-sage/25 text-moss',
    progesterone: 'bg-lavender/30 text-[#5A4A6B]',
    testosterone: 'bg-[#E5DCC5] text-[#7A6438]',
    other: 'bg-muted text-muted-foreground',
  }
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${palette[kind]}`}
    >
      {t(`kind.${kind}`)}
    </span>
  )
}

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
