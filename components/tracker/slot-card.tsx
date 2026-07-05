'use client'

import { CheckIcon, MinusIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

import { SlotActions } from './slot-actions'
import { SlotBackfillDialog } from './slot-backfill-dialog'

export interface SlotCardProps {
  id: string
  scheduledIso: string
  timeStr: string // HH:mm в tz юзера
  takenTimeStr: string | null // HH:mm если taken
  medName: string
  doseStr: string
  formStr: string
  status: 'upcoming' | 'taken' | 'skipped' | 'missed'
  timezone: string
  // true, если это последний upcoming-слот дня → щедрее вспышка при отметке.
  isLast?: boolean
}

/**
 * Карточка одного слота приёма. Поведение зависит от status:
 *   upcoming → action-кнопки (Принято / Пропустить)
 *   taken    → галочка + время приёма, клик открывает backfill (изменить время)
 *   skipped  → прочерк, клик открывает backfill (передумать, отметить taken)
 *   missed   → как skipped, клик открывает backfill
 *
 * Карточка client, потому что:
 *   - для taken/skipped нужен onClick → Dialog (client)
 *   - useTranslations работает только в client/server-with-config; здесь
 *     удобнее client т.к. интерактив всё равно нужен.
 */
export function SlotCard(props: SlotCardProps) {
  const t = useTranslations('tracker.slot')

  const { status, id, scheduledIso, timeStr, takenTimeStr, medName, doseStr, formStr, timezone, isLast } = props

  const isUpcoming = status === 'upcoming'
  const isTaken = status === 'taken'

  // Для прошлых слотов — карточка кликабельна (открывает backfill).
  // Для upcoming — нет, там только кнопки.
  const wrapInBackfill = !isUpcoming

  const content = (
    <Card
      data-slot-card=""
      className={cn(
        'flex flex-col gap-3 p-4',
        wrapInBackfill && 'cursor-pointer transition-colors hover:bg-muted/30',
        !isUpcoming && 'opacity-70',
      )}
    >
      <div className="flex items-center gap-3">
        <StatusIcon status={status} />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">
            <span className="tabular-nums">{timeStr}</span>
            <span className="mx-1.5 text-muted-foreground">·</span>
            <span>{medName}</span>
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {doseStr} · {formStr}
            {isTaken && takenTimeStr && takenTimeStr !== timeStr && (
              <>
                {' '}
                <span className="text-foreground/70">
                  ({t('takenAtBadge', { time: takenTimeStr })})
                </span>
              </>
            )}
          </p>
        </div>
      </div>

      {isUpcoming && (
        <SlotActions id={id} medName={medName} timeStr={timeStr} isLast={isLast} />
      )}
    </Card>
  )

  if (wrapInBackfill) {
    return (
      <SlotBackfillDialog
        id={id}
        scheduledIso={scheduledIso}
        defaultTimeStr={takenTimeStr ?? timeStr}
        timezone={timezone}
        currentStatus={status}
      >
        {content}
      </SlotBackfillDialog>
    )
  }

  return content
}

function StatusIcon({ status }: { status: SlotCardProps['status'] }) {
  if (status === 'taken') {
    return (
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sage/30 text-moss">
        <CheckIcon className="size-4" />
      </span>
    )
  }
  if (status === 'skipped' || status === 'missed') {
    return (
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <MinusIcon className="size-4" />
      </span>
    )
  }
  // upcoming — пустой круг (placeholder), сигнал что слот ждёт действия
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-full border-2 border-sage/40" />
  )
}
