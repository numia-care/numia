'use client'

import { format, parse } from 'date-fns'
import { ru } from 'date-fns/locale'
import { CalendarIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

interface Props {
  value: string
  onChange: (ymd: string) => void
  className?: string
  // Запретить выбор будущих дат (today включительно ок). Нужно для анализов:
  // measured_at не может быть позже сегодня. Трекер этот проп не передаёт —
  // его поведение не меняется.
  disableFuture?: boolean
}

export function DatePicker({ value, onChange, className, disableFuture }: Props) {
  const t = useTranslations('datePicker')
  const [open, setOpen] = useState(false)

  const selected = value ? parse(value, 'yyyy-MM-dd', new Date()) : undefined
  const displayText = selected
    ? format(selected, 'd MMMM yyyy', { locale: ru })
    : t('placeholder')

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            className={cn(
              'w-auto justify-start gap-2 text-left font-normal',
              !value && 'text-muted-foreground',
              className,
            )}
          />
        }
      >
        <CalendarIcon className="size-4 text-muted-foreground" />
        {displayText}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(day) => {
            if (day) {
              onChange(format(day, 'yyyy-MM-dd'))
              setOpen(false)
            }
          }}
          locale={ru}
          weekStartsOn={1}
          captionLayout="dropdown"
          // Будущие дни недоступны и не навигируются (endMonth ограничивает
          // выпадашку месяцев/лет текущим месяцем).
          disabled={disableFuture ? { after: new Date() } : undefined}
          endMonth={disableFuture ? new Date() : undefined}
        />
      </PopoverContent>
    </Popover>
  )
}
