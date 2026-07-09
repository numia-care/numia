'use client'

import { ChevronDownIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { markSkipped, markTaken, undoIntake } from '@/lib/tracker/intake'
import { playIntakeSparks } from '@/lib/tracker/spark'
import { cn } from '@/lib/utils'

import { SlotBackfillDialog } from './slot-backfill-dialog'

// Слот приёма — строка-пилюля по фрейму Кая «препараты»:
//   [чекбокс] имя … «HH:MM • доза» [шеврон]
//
// Чекбокс слева — и есть «Принято»: белый кружок, по тапу — ТЁМНАЯ ТОЧКА
// #262626 (цвет строго по фрейму, не «зелёная галочка по логике») + вспышка ✦.
// Цвет пилюли: два ближайших приёма — голубая и розовая (как чипы дашборда),
// остальные — тёплый серый. Шеврон разворачивает детали (форма, «Пропустить» —
// нейтрально, без негативной окраски).
//
// Прошлые слоты (taken/skipped/missed) — строка целиком открывает backfill-
// диалог (поменять время / передумать), как и раньше.

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
  // Порядковый номер среди upcoming (0 → голубая, 1 → розовая, прочие серые).
  colorIndex?: number
}

// Классы пилюли по цветовому индексу — пары заливка+обводка из фрейма.
function pillClass(colorIndex: number | undefined, isUpcoming: boolean): string {
  if (!isUpcoming) return 'border-[#D4D4D4] bg-[#EDEBE9]'
  if (colorIndex === 0) return 'border-chip-blue-border bg-chip-blue'
  if (colorIndex === 1) return 'border-chip-pink-border bg-chip-pink'
  return 'border-[#D4D4D4] bg-[#EDEBE9]'
}

export function SlotCard(props: SlotCardProps) {
  const t = useTranslations('tracker.slot')
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [expanded, setExpanded] = useState(false)

  const {
    status, id, scheduledIso, timeStr, takenTimeStr,
    medName, doseStr, formStr, timezone, isLast, colorIndex,
  } = props

  const isUpcoming = status === 'upcoming'
  const isTaken = status === 'taken'

  const onUndo = () => {
    startTransition(async () => {
      await undoIntake(id)
      router.refresh()
      toast.message(t('undone'))
    })
  }

  const act = (action: typeof markTaken, successText: string) => {
    startTransition(async () => {
      const result = await action(id)
      if (!result.ok) return
      router.refresh()
      toast.success(successText, {
        description: `${timeStr} · ${medName}`,
        action: { label: t('undo'), onClick: onUndo },
        duration: 5000,
      })
    })
  }

  // Тап по чекбоксу: вспышка ✦ из точки тапа (мгновенно) + отметка.
  const onCheck = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (isPending) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX || rect.left + rect.width / 2
    const y = e.clientY || rect.top + rect.height / 2
    playIntakeSparks(x, y, isLast)

    if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      const card = e.currentTarget.closest('[data-slot-card]')
      if (card) {
        card.classList.add('slot-pulse')
        window.setTimeout(() => card.classList.remove('slot-pulse'), 600)
      }
    }
    act(markTaken, t('takenBadge'))
  }

  const checkbox = (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[#FEFEFD] shadow-sm">
      {/* Принято — тёмная точка (цвет из фрейма); пропуск — приглушённая. */}
      {isTaken && <span className="size-3 rounded-full bg-[#262626]" />}
      {(status === 'skipped' || status === 'missed') && (
        <span className="size-3 rounded-full bg-[#8F8F8F]/50" />
      )}
    </span>
  )

  const row = (
    <div className="flex min-h-[52px] items-center gap-3 px-4 py-2">
      {isUpcoming ? (
        // Тач-зона больше видимого кружка (size-9 вокруг size-5).
        <button
          type="button"
          onClick={onCheck}
          disabled={isPending}
          aria-label={t('markTaken')}
          className="-m-2 flex size-9 shrink-0 items-center justify-center disabled:opacity-60"
        >
          {checkbox}
        </button>
      ) : (
        checkbox
      )}

      <span className="min-w-0 flex-1 truncate text-sm text-[#1F1F1F]">
        {medName}
      </span>

      <span className="shrink-0 text-xs text-[#1F1F1F]/80">
        {timeStr} • {doseStr}
      </span>

      {isUpcoming && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? t('collapse') : t('expand')}
          aria-expanded={expanded}
          className="-m-1.5 flex size-8 shrink-0 items-center justify-center"
        >
          <ChevronDownIcon
            className={cn('size-4 text-[#1F1F1F]/70 transition-transform', expanded && 'rotate-180')}
          />
        </button>
      )}
    </div>
  )

  const pill = (
    <div
      data-slot-card=""
      className={cn(
        'border shadow-card transition-[border-radius] duration-200',
        expanded ? 'rounded-[25px]' : 'rounded-full',
        pillClass(colorIndex, isUpcoming),
        !isUpcoming && 'cursor-pointer opacity-80 transition-opacity hover:opacity-100',
      )}
    >
      {row}

      {/* Разворот (только upcoming): детали + нейтральное «Пропустить». */}
      {isUpcoming && expanded && (
        <div className="flex items-center justify-between gap-3 px-4 pb-3 pl-12">
          <span className="text-[11px] leading-snug text-[#1F1F1F]/70">
            {doseStr} · {formStr}
          </span>
          <button
            type="button"
            disabled={isPending}
            onClick={() => act(markSkipped, t('skippedBadge'))}
            className="shrink-0 rounded-full px-3 py-1.5 text-xs text-[#1F1F1F]/70 transition-colors hover:bg-white/50 hover:text-[#1F1F1F] disabled:opacity-60"
          >
            {t('markSkipped')}
          </button>
        </div>
      )}

      {/* Принято в другое время — тихая пометка в строке разворота нет,
          показываем в самой строке подсказкой через title. */}
      {isTaken && takenTimeStr && takenTimeStr !== timeStr && (
        <div className="px-4 pb-2 pl-12 text-[11px] text-[#1F1F1F]/60">
          {t('takenAtBadge', { time: takenTimeStr })}
        </div>
      )}
    </div>
  )

  // Прошлые слоты — вся пилюля открывает backfill (изменить время/передумать).
  if (!isUpcoming) {
    return (
      <SlotBackfillDialog
        id={id}
        scheduledIso={scheduledIso}
        defaultTimeStr={takenTimeStr ?? timeStr}
        timezone={timezone}
        currentStatus={status}
      >
        {pill}
      </SlotBackfillDialog>
    )
  }

  return pill
}
