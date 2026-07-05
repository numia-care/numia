'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { markSkipped, markTaken, undoIntake } from '@/lib/tracker/intake'
import { playIntakeSparks } from '@/lib/tracker/spark'

/**
 * Кнопки «Принято» / «Пропустить» под слотом upcoming.
 * После клика — Sonner-тост с действием «Отменить» на 5 секунд.
 *
 * «Принято» — праздничное событие: вспышка ✦ из точки тапа + мягкий пульс
 * карточки (isLast → вспышка щедрее, это был последний приём дня).
 * «Пропустить» — намеренно нейтрально, без анимации и без негативной окраски:
 * пропуск — это данные, не вина.
 */
export function SlotActions({
  id,
  medName,
  timeStr,
  isLast = false,
}: {
  id: string
  medName: string
  timeStr: string
  isLast?: boolean
}) {
  const t = useTranslations('tracker.slot')
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // Отметка «Принято»: сперва рисуем вспышку из точки тапа (мгновенно, до
  // серверного round-trip), потом обычный markTaken + refresh.
  const onTaken = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (isPending) return
    const rect = e.currentTarget.getBoundingClientRect()
    // Координаты тапа; при активации с клавиатуры clientX/Y = 0 → центр кнопки.
    const x = e.clientX || rect.left + rect.width / 2
    const y = e.clientY || rect.top + rect.height / 2
    playIntakeSparks(x, y, isLast)

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (!reduce) {
      const card = e.currentTarget.closest('[data-slot-card]')
      if (card) {
        card.classList.add('slot-pulse')
        window.setTimeout(() => card.classList.remove('slot-pulse'), 600)
      }
    }

    handle(markTaken, t('takenBadge'))
  }

  const onUndo = () => {
    startTransition(async () => {
      await undoIntake(id)
      router.refresh()
      toast.message(t('undone'))
    })
  }

  const handle = (
    action: typeof markTaken,
    successText: string,
  ) => {
    startTransition(async () => {
      const result = await action(id)
      if (!result.ok) return
      router.refresh()
      toast.success(successText, {
        description: `${timeStr} · ${medName}`,
        action: {
          label: t('undo'),
          onClick: onUndo,
        },
        duration: 5000,
      })
    })
  }

  return (
    <div className="flex gap-2">
      <Button
        type="button"
        size="sm"
        className="flex-1"
        disabled={isPending}
        onClick={onTaken}
      >
        {t('markTaken')}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="flex-1"
        disabled={isPending}
        onClick={() => handle(markSkipped, t('skippedBadge'))}
      >
        {t('markSkipped')}
      </Button>
    </div>
  )
}
