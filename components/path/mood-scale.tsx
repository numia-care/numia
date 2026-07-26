'use client'

import { useTranslations } from 'next-intl'

import type { MoodLevel } from '@/lib/path/entries'
import { MOOD_LEVELS } from '@/lib/path/mood'
import { cn } from '@/lib/utils'
import { MoodBadge } from './mood-badge'

// Шкала настроения 1–5 по PNG-эталону «путь новая запись текст»: белые плитки
// r:18 с цветными «цветками»-лицами, подписи под плитками, позади ряда мягкое
// градиентное свечение (лаванда → голубой → зелень). Выбранная плитка — на
// мягкой лаванде. Переиспользуется формой дневника и быстрым входом дашборда.

interface Props {
  value: MoodLevel | null
  onChange: (mood: MoodLevel) => void
  disabled?: boolean
  className?: string
}

export function MoodScale({ value, onChange, disabled, className }: Props) {
  const t = useTranslations('path.mood')

  return (
    <div className={cn('relative', className)}>
      {/* Свечение позади ряда — градиент палитры ступеней, размытый. */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-14 rounded-full opacity-60 blur-2xl"
        style={{
          background:
            'linear-gradient(90deg, #C9B4EA 0%, #A3C0EE 30%, #7EDAC5 55%, #6EDC85 75%, #A9E25E 100%)',
        }}
      />

      <div
        role="radiogroup"
        aria-label={t('groupLabel')}
        className="relative flex justify-between gap-1.5"
      >
        {MOOD_LEVELS.map((lvl) => {
          const active = value === lvl
          const dimmed = value !== null && !active
          return (
            <button
              key={lvl}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={t(`level.${lvl}`)}
              disabled={disabled}
              onClick={() => onChange(lvl)}
              className={cn(
                'flex min-w-0 flex-1 flex-col items-center gap-1.5 transition-opacity',
                'disabled:cursor-not-allowed disabled:opacity-60',
                dimmed && 'opacity-45',
              )}
            >
              <span
                className={cn(
                  'shadow-chip flex aspect-square w-full max-w-[56px] items-center justify-center rounded-[18px] transition-colors',
                  active ? 'bg-lavender-soft' : 'bg-card',
                )}
              >
                <MoodBadge level={lvl} size={34} />
              </span>
              <span className="w-full text-center text-[10px] leading-none text-foreground">
                {t(`level.${lvl}`)}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
