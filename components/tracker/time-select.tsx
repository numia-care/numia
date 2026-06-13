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
 * часы 00-23 и минуты 00-59 (шаг 1).
 *
 * Зачем: нативный time picker в iOS PWA нестабилен (показывает 12h
 * формат если у юзера в системе English, иногда вообще не открывается
 * в standalone-режиме). Selectы — гарантированно одинаково везде.
 *
 * Шаг 1 минута — юзер должен мочь указать точное время приёма
 * (особенно в backfill-диалоге, где реальное время может быть любым).
 */
export function TimeSelect({ value, onChange, className }: Props) {
  const [hhPart, mmPart] = (value || '00:00').split(':')
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

const MINUTES: string[] = Array.from({ length: 60 }, (_, i) =>
  i.toString().padStart(2, '0'),
)

function normalizeHour(raw: string | undefined): string {
  const n = Number.parseInt(raw ?? '', 10)
  if (Number.isNaN(n) || n < 0 || n > 23) return '09'
  return n.toString().padStart(2, '0')
}

function normalizeMinute(raw: string | undefined): string {
  const n = Number.parseInt(raw ?? '', 10)
  if (Number.isNaN(n) || n < 0 || n > 59) return '00'
  return n.toString().padStart(2, '0')
}
