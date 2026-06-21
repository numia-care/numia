'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { markSkipped, markTaken, undoIntake } from '@/lib/tracker/intake'

/**
 * Кнопки «Принято» / «Пропустить» под слотом upcoming.
 * После клика — Sonner-тост с действием «Отменить» на 5 секунд.
 */
export function SlotActions({
  id,
  medName,
  timeStr,
}: {
  id: string
  medName: string
  timeStr: string
}) {
  const t = useTranslations('tracker.slot')
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

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
        onClick={() => handle(markTaken, t('takenBadge'))}
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
