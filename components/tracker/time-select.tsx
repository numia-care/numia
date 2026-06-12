'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

interface Props {
  /** HH:mm */
  value: string
  onChange: (hhmm: string) => void
  className?: string
}

/**
 * Замена нативного <input type="time">. Два селекта подряд:
 * часы 00-23 и минуты с шагом 5.
 *
 * Зачем: нативный time picker в iOS PWA нестабилен (показывает 12h
 * формат если у юзера в системе English, иногда вообще не открывается
 * в standalone-режиме). Selectы — гарантированно одинаково везде.
 *
 * Шаг 5 минут — компромисс точности и UX (60 опций в минутном селекте
 * — это листать в Safari неудобно). Для редких «приняла в 09:23» —
 * через backfill с произвольным временем.
 */
export function TimeSelect({ value, onChange, className }: Props) {
  const [hhPart, mmPart] = (value || '00:00').split(':')
  // Округляем минуты к ближайшим 5 для отображения в селекте
  // (если в БД лежит 09:23 — покажем 09:25, а не пусто).
  const hh = normalizeHour(hhPart)
  const mm = normalizeMinute(mmPart)

  return (
    <div className={cn('inline-flex items-center gap-1', className)}>
      <Select
        value={hh}
        onValueChange={(v) => onChange(`${v}:${mm}`)}
      >
        <SelectTrigger className="w-[5.5rem]">
          <SelectValue>{(v) => v ?? hh}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {HOURS.map((h) => (
            <SelectItem key={h} value={h}>
              {h}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-muted-foreground" aria-hidden>
        :
      </span>
      <Select
        value={mm}
        onValueChange={(v) => onChange(`${hh}:${v}`)}
      >
        <SelectTrigger className="w-[5.5rem]">
          <SelectValue>{(v) => v ?? mm}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {MINUTES.map((m) => (
            <SelectItem key={m} value={m}>
              {m}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

const HOURS: string[] = Array.from({ length: 24 }, (_, i) =>
  i.toString().padStart(2, '0'),
)

const MINUTES: string[] = Array.from({ length: 12 }, (_, i) =>
  (i * 5).toString().padStart(2, '0'),
)

function normalizeHour(raw: string | undefined): string {
  const n = Number.parseInt(raw ?? '', 10)
  if (Number.isNaN(n) || n < 0 || n > 23) return '09'
  return n.toString().padStart(2, '0')
}

function normalizeMinute(raw: string | undefined): string {
  const n = Number.parseInt(raw ?? '', 10)
  if (Number.isNaN(n) || n < 0 || n > 59) return '00'
  // Округление к ближайшим 5
  const rounded = Math.round(n / 5) * 5
  const clamped = rounded === 60 ? 55 : rounded
  return clamped.toString().padStart(2, '0')
}
