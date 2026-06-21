'use client'

import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { backfillTaken } from '@/lib/tracker/intake'

import { TimeSelect } from './time-select'

interface Props {
  id: string
  scheduledIso: string
  defaultTimeStr: string // HH:mm
  timezone: string
  currentStatus: 'taken' | 'skipped' | 'missed' | 'upcoming'
  children: React.ReactNode // карточка слота-триггер
}

/**
 * Диалог backfill — «приняла в [время]». Открывается тапом по карточке
 * прошлого слота (taken / skipped / missed).
 *
 * Логика времени:
 *   - YMD берём из scheduled_at в tz юзера (день слота).
 *   - HH:mm — то что ввёл юзер.
 *   - Собираем wall-clock '{ymd}T{hh:mm}:00' и конвертим в UTC через
 *     fromZonedTime — это даёт корректный ISO для backfillTaken.
 *
 * Зачем YMD из scheduled (а не today): юзер может открыть карточку
 * вчерашнего слота через несколько дней. День приёма — это день слота,
 * не сегодня.
 */
export function SlotBackfillDialog({
  id,
  scheduledIso,
  defaultTimeStr,
  timezone,
  currentStatus,
  children,
}: Props) {
  const t = useTranslations('tracker.slot')
  const tc = useTranslations('common')
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [time, setTime] = useState(defaultTimeStr)
  const [isPending, startTransition] = useTransition()

  const ymd = formatInTimeZone(new Date(scheduledIso), timezone, 'yyyy-MM-dd')

  const onConfirm = () => {
    // Валидация HH:mm на клиенте (Zod на сервере страхует).
    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(time)) return

    const takenIso = fromZonedTime(`${ymd}T${time}:00`, timezone).toISOString()
    startTransition(async () => {
      const result = await backfillTaken(id, takenIso)
      if (result.ok) {
        router.refresh()
        toast.success(t('takenAtBadge', { time }))
        setOpen(false)
      }
    })
  }

  // Если уже taken и юзер открыл диалог снова — даём изменить время.
  // Если skipped/missed — даём отметить как taken.
  void currentStatus // оставлено для возможной расширенной логики

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<div />}>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('backfillTitle')}</DialogTitle>
          <DialogDescription>{t('backfillDescription')}</DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <Label>{t('backfillTimeLabel')}</Label>
          <div className="mt-2">
            <TimeSelect value={time} onChange={setTime} />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            {tc('cancel')}
          </Button>
          <Button onClick={onConfirm} disabled={isPending}>
            {t('backfillConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
