'use client'

import { ChevronDownIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { markSkipped, markTaken, undoIntake } from '@/lib/tracker/intake'
import type { MedicationRow } from '@/lib/tracker/queries'
import { playIntakeSparks } from '@/lib/tracker/spark'
import { cn } from '@/lib/utils'

import { MedFormIcon } from './med-form-icon'
import { SlotBackfillDialog } from './slot-backfill-dialog'

// Слот приёма — строка-пилюля по эталону преппараты1:
//   [чекбокс] имя … «HH:MM • доза» [шеврон]
//
// Заливка — ЛАЙМОВЫЙ ГРАДИЕНТ у ВСЕХ строк (--kai-grad-slot, замер эталона).
// Прежнее выделение двух ближайших приёмов голубой и розовой пилюлями снято:
// в макете такого разделения нет, все строки одинаковые.
//
// Чекбокс слева — и есть «Принято»: скруглённый КВАДРАТ 17px (замер), белый;
// по тапу заливается зелёным --kai-slot-check + вспышка ✦. Шеврон разворачивает
// детали (форма, «Пропустить» — нейтрально, без негативной окраски).
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
  // Сырая форма препарата — для MedFormIcon (formStr это уже перевод).
  form?: MedicationRow['form']
  status: 'upcoming' | 'taken' | 'skipped' | 'missed'
  timezone: string
  // true, если это последний upcoming-слот дня → щедрее вспышка при отметке.
  isLast?: boolean
}

export function SlotCard(props: SlotCardProps) {
  const t = useTranslations('tracker.slot')
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [expanded, setExpanded] = useState(false)

  const {
    status, id, scheduledIso, timeStr, takenTimeStr,
    medName, doseStr, formStr, form, timezone, isLast,
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

  // Квадрат 17px, r:6 — замер эталона. Отмечено → сплошная зелёная заливка
  // (в макете именно заливка, не галочка и не точка).
  const checkbox = (
    <span
      className={cn(
        'size-[17px] shrink-0 rounded-[6px] shadow-sm',
        isTaken
          ? ''
          : status === 'skipped' || status === 'missed'
            ? 'bg-muted-foreground/30'
            : 'bg-card',
      )}
      style={isTaken ? { backgroundColor: 'var(--kai-slot-check)' } : undefined}
    />
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

      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
        {medName}
      </span>

      <span className="shrink-0 text-xs text-foreground/80">
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
            className={cn('size-4 text-foreground/70 transition-transform', expanded && 'rotate-180')}
          />
        </button>
      )}
    </div>
  )

  const pill = (
    <div
      data-slot-card=""
      className={cn(
        'shadow-card transition-[border-radius] duration-200',
        expanded ? 'rounded-[27px]' : 'rounded-full',
        !isUpcoming && 'cursor-pointer opacity-80 transition-opacity hover:opacity-100',
      )}
      // Лаймовый градиент — у всех строк одинаковый (замер эталона).
      style={{ backgroundImage: 'var(--kai-grad-slot)' }}
    >
      {row}

      {/* Разворот (только upcoming): детали + нейтральное «Пропустить».
          Иконка формы слева — тот же MedFormIcon, что в карточке «Все». */}
      {isUpcoming && expanded && (
        <div className="flex items-center justify-between gap-3 px-4 pb-3 pl-5">
          <span className="flex min-w-0 items-center gap-3 text-[11px] leading-snug text-foreground/70">
            {form && <MedFormIcon form={form} className="size-5 shrink-0 text-foreground" />}
            <span className="min-w-0 truncate">
              {doseStr} · {formStr}
            </span>
          </span>
          <button
            type="button"
            disabled={isPending}
            onClick={() => act(markSkipped, t('skippedBadge'))}
            className="shrink-0 rounded-full px-3 py-1.5 text-xs text-foreground/70 transition-colors hover:bg-white/50 hover:text-foreground disabled:opacity-60"
          >
            {t('markSkipped')}
          </button>
        </div>
      )}

      {/* Принято в другое время — тихая пометка в строке разворота нет,
          показываем в самой строке подсказкой через title. */}
      {isTaken && takenTimeStr && takenTimeStr !== timeStr && (
        <div className="px-4 pb-2 pl-12 text-[11px] text-foreground/60">
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
