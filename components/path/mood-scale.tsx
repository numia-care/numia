'use client'

import { useTranslations } from 'next-intl'

import type { MoodLevel } from '@/lib/path/entries'
import { MOOD_COLOR, MOOD_LEVELS, moodRgba } from '@/lib/path/mood'
import { cn } from '@/lib/utils'

// Шкала настроения 1–5 — переиспользуемая (форма дневника + быстрый вход с
// дашборда). Пять крупных зон тапа. Каждая ступень:
//   • ✦ в цвете пастельного перехода «тяжело → прекрасно» (см. lib/path/mood),
//   • подпись под звёздочкой (нейтральная, path.mood.level.*).
// Выбранная ступень — заливка + кольцо цвета ступени + сияние ✦; невыбранные
// приглушены (звезда и подпись бледнее). Размером ничего не кодируем — только
// цветом и состоянием выбора, чтобы шкала читалась однозначно.

interface Props {
  value: MoodLevel | null
  onChange: (mood: MoodLevel) => void
  disabled?: boolean
  className?: string
}

export function MoodScale({ value, onChange, disabled, className }: Props) {
  const t = useTranslations('path.mood')

  return (
    <div
      role="radiogroup"
      aria-label={t('groupLabel')}
      className={cn('flex gap-2', className)}
    >
      {MOOD_LEVELS.map((lvl) => {
        const active = value === lvl
        const color = MOOD_COLOR[lvl]
        return (
          <button
            key={lvl}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={t(`level.${lvl}`)}
            disabled={disabled}
            onClick={() => onChange(lvl)}
            // Крупная зона тапа: звезда + подпись в колонку, min-h + вертикальный
            // паддинг. border вместо ring — чтобы задать цвет ступени инлайном.
            className={cn(
              'flex flex-1 flex-col items-center gap-1.5 rounded-2xl border px-1 py-3 transition-colors',
              'disabled:cursor-not-allowed disabled:opacity-60',
              active ? 'border-transparent' : 'border-border bg-card hover:bg-muted',
            )}
            style={
              active
                ? { backgroundColor: moodRgba(lvl, 0.16), borderColor: color }
                : undefined
            }
          >
            <span
              aria-hidden
              className="text-2xl leading-none transition-opacity"
              style={{
                color,
                opacity: active ? 1 : 0.5,
                // Сияние выбранной ✦ — мягкий ореол цветом ступени.
                textShadow: active ? `0 0 10px ${moodRgba(lvl, 0.7)}` : 'none',
              }}
            >
              ✦
            </span>
            <span
              className={cn(
                'text-center text-[11px] leading-tight',
                active ? 'font-medium text-foreground' : 'text-muted-foreground',
              )}
            >
              {t(`level.${lvl}`)}
            </span>
          </button>
        )
      })}
    </div>
  )
}
