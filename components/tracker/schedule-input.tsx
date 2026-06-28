'use client'

import { format } from 'date-fns'
import { useTranslations } from 'next-intl'
import { useFormContext } from 'react-hook-form'

import { Button } from '@/components/ui/button'
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

import type { MedicationFormValues } from './medication-form-schema'
import { TimeSelect } from './time-select'

export function ScheduleInput() {
  const t = useTranslations('tracker.schedule')
  const form = useFormContext<MedicationFormValues>()
  const kind = form.watch('schedule.kind')

  const switchTo = (next: 'daily' | 'interval') => {
    if (next === kind) return
    // Переносим основное (первое) время между расписаниями — время единое,
    // смена «каждый день ↔ интервал» его не сбрасывает. Доп. времена daily при
    // переходе в interval теряются (у интервала приём один) — это ожидаемо.
    const current = form.getValues('schedule')
    const primary =
      (current.kind === 'daily' ? current.times?.[0] : current.time) ?? '09:00'
    if (next === 'daily') {
      form.setValue(
        'schedule',
        { kind: 'daily', times: [primary] },
        { shouldValidate: false, shouldDirty: true },
      )
    } else {
      form.setValue(
        'schedule',
        {
          kind: 'interval',
          every_days: 7,
          time: primary,
          anchor_date: format(new Date(), 'yyyy-MM-dd'),
        },
        { shouldValidate: false, shouldDirty: true },
      )
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <Label>{t('label')}</Label>
        <div
          role="tablist"
          aria-label={t('label')}
          className="mt-2 inline-flex rounded-lg bg-muted p-1"
        >
          <SegmentButton
            active={kind === 'daily'}
            onClick={() => switchTo('daily')}
          >
            {t('daily')}
          </SegmentButton>
          <SegmentButton
            active={kind === 'interval'}
            onClick={() => switchTo('interval')}
          >
            {t('interval')}
          </SegmentButton>
        </div>
      </div>

      {kind === 'daily' ? <DailyFields /> : <IntervalFields />}
    </div>
  )
}

function SegmentButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

function DailyFields() {
  const t = useTranslations('tracker.schedule')
  const form = useFormContext<MedicationFormValues>()
  const times = (form.watch('schedule.times') ?? []) as string[]

  const setTime = (idx: number, value: string) => {
    const next = [...times]
    next[idx] = value
    form.setValue('schedule.times', next, {
      shouldValidate: true,
      shouldDirty: true,
    })
  }
  const addTime = () => {
    form.setValue('schedule.times', [...times, '12:00'], {
      shouldValidate: false,
      shouldDirty: true,
    })
  }
  const removeTime = (idx: number) => {
    form.setValue(
      'schedule.times',
      times.filter((_, i) => i !== idx),
      { shouldValidate: true, shouldDirty: true },
    )
  }

  // Первый приём (times[0]) живёт в базовом слое формы — единый источник.
  // Здесь только ДОПОЛНИТЕЛЬНЫЕ времена (со второго) + кнопка добавления.
  return (
    <FormField
      control={form.control}
      name="schedule.times"
      render={() => (
        <FormItem>
          <FormLabel className="text-sm text-muted-foreground">
            {t('moreTimes')}
          </FormLabel>
          {times.length > 1 && (
            <div className="space-y-2">
              {times.slice(1).map((time, i) => {
                const idx = i + 1
                return (
                  <div key={idx} className="flex items-center gap-2">
                    <TimeSelect value={time} onChange={(v) => setTime(idx, v)} />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeTime(idx)}
                      className="text-muted-foreground"
                    >
                      {t('removeTime')}
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={addTime}
            className="mt-2"
            disabled={times.length >= 12}
          >
            {t('addTime')}
          </Button>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

function IntervalFields() {
  const t = useTranslations('tracker.schedule')
  const form = useFormContext<MedicationFormValues>()
  // Время приёма у интервала — то же базовое поле формы (single source), здесь
  // НЕ дублируем. «Точка отсчёта» тоже не поле: цикл считается от «Даты начала»
  // (schedule.anchor_date = start_date на сабмите).
  return (
    <FormField
      control={form.control}
      name="schedule.every_days"
      render={({ field }) => (
        <FormItem>
          <FormLabel className="text-sm text-muted-foreground">
            {t('everyDaysLabel')}
          </FormLabel>
          <FormControl>
            <Input
              type="number"
              min={1}
              max={180}
              {...field}
              onChange={(e) => field.onChange(e.target.valueAsNumber)}
              value={field.value ?? ''}
              className="max-w-32"
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
