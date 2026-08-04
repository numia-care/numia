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
import { backfillTaken, unmarkIntake } from '@/lib/tracker/intake'

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
 * Диалог отметки прошлого слота. Открывается тапом по карточке слота со
 * статусом taken / skipped / missed.
 *
 * ДВА СОСТОЯНИЯ, переключаются в обе стороны:
 *   не принят (missed/skipped/upcoming) → выбор времени + «Отметить принятым»
 *   принят (taken)                      → «Не принято», отметка снимается
 *
 * Раньше действие было одно — «Отметить». Из-за этого диалог выглядел
 * неработающим ровно там, где по нему чаще всего кликают: у слота, который
 * УЖЕ taken, единственная кнопка переписывала статус на тот же самый, и на
 * экране не менялось ничего. Обратного хода не было вовсе.
 *
 * Логика времени (состояние «не принят»):
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

  const isTaken = currentStatus === 'taken'

  const onMarkTaken = () => {
    // Валидация HH:mm на клиенте (Zod на сервере страхует).
    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(time)) {
      toast.error(t('invalidTime'))
      return
    }

    const takenIso = fromZonedTime(`${ymd}T${time}:00`, timezone).toISOString()
    startTransition(async () => {
      const result = await backfillTaken(id, takenIso)
      // Раньше ветки !ok не было вовсе: при ошибке диалог молча оставался
      // открытым, и это было неотличимо от «кнопка не нажалась».
      if (!result.ok) {
        toast.error(t('actionFailed'))
        return
      }
      router.refresh()
      toast.success(t('takenAtBadge', { time }))
      setOpen(false)
    })
  }

  const onUnmark = () => {
    startTransition(async () => {
      const result = await unmarkIntake(id)
      if (!result.ok) {
        toast.error(t('actionFailed'))
        return
      }
      // router.refresh() перерисовывает серверные панели — и список Истории,
      // и шапку статистики над ним: они считаются из одного набора слотов,
      // так что обе обновляются одним запросом.
      router.refresh()
      toast.message(t('unmarked'))
      setOpen(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<div />}>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isTaken ? t('unmarkTitle') : t('backfillTitle')}
          </DialogTitle>
          <DialogDescription>
            {isTaken
              ? t('unmarkDescription', { time: defaultTimeStr })
              : t('backfillDescription')}
          </DialogDescription>
        </DialogHeader>

        {/* Выбор времени нужен только когда отмечаем принятым. У снятия
            отметки времени нет — снимать нечего, кроме самого факта. */}
        {!isTaken && (
          <div className="py-2">
            <Label>{t('backfillTimeLabel')}</Label>
            <div className="mt-2">
              <TimeSelect value={time} onChange={setTime} />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            {tc('cancel')}
          </Button>
          <Button onClick={isTaken ? onUnmark : onMarkTaken} disabled={isPending}>
            {isTaken ? t('unmark') : t('backfillConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
