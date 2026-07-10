'use client'

import { useTranslations } from 'next-intl'

import type { MoodLevel } from '@/lib/path/entries'
import { MOOD_BORDER, MOOD_COLOR, MOOD_LEVELS, MOOD_TEXT, moodRgba } from '@/lib/path/mood'
import { cn } from '@/lib/utils'

// Шкала настроения 1–5 — вёрстка по фрейму Кая «как ты?»: белые квадратные
// ячейки (r:15) с обводкой цвета ступени, внутри ✦ цветом ступени и подпись
// оттенком той же ступени. Переиспользуется формой дневника и быстрым входом
// на дашборде (там она лежит на градиентной подложке).
//
// Выбранная ступень: заливка цветом ступени (мягкая) + сияние ✦.
// Невыбранные при наличии выбора приглушаются.

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
      className={cn('flex justify-between gap-1', className)}
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
            // min-w-0 + фиксированная высота вместо aspect-square: на 390px
            // ячейки ~38px, квадрат зажимал бы подпись под ✦ (баг «налезает»).
            className={cn(
              'flex min-h-[52px] min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-md border bg-white/80 px-0.5 transition-all',
              'disabled:cursor-not-allowed disabled:opacity-60',
              dimmed && 'opacity-50',
            )}
            style={{
              borderColor: MOOD_BORDER[lvl],
              backgroundColor: active ? moodRgba(lvl, 0.25) : undefined,
            }}
          >
            <span
              aria-hidden
              className="text-base leading-none"
              style={{
                color: MOOD_COLOR[lvl],
                textShadow: active ? `0 0 10px ${moodRgba(lvl, 0.8)}` : 'none',
              }}
            >
              ✦
            </span>
            <span
              className="w-full text-center text-[9px] font-medium leading-none tracking-tight"
              style={{ color: MOOD_TEXT[lvl] }}
            >
              {t(`level.${lvl}`)}
            </span>
          </button>
        )
      })}
    </div>
  )
}
