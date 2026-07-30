'use client'

import { useTranslations } from 'next-intl'

import type { MoodLevel } from '@/lib/path/entries'
import { MOOD_LEVELS } from '@/lib/path/mood'
import { cn } from '@/lib/utils'
import { MoodBadge } from './mood-badge'

// Шкала настроения 1–5. Два варианта раскладки, поведение и разметка выбора
// (radiogroup, ступени, состояния) — общие:
//
//   'row' — эталон «путь новая запись текст»: белые плитки r:18 в ряд, подписи
//           под плитками, позади мягкое градиентное свечение. Форма дневника.
//   'arc' — эталон дашборда today.jpg: пять плиток 48×48 ДУГОЙ (крайние выше,
//           центральная ниже на 20), без подписей и без свечения — фон даёт
//           сама карточка. Смещения замерены: 0 / 11.9 / 19.9 / 11.9 / 0.
//
// Варианты, а не отдельный компонент: макеты расходятся только геометрией,
// а логика выбора должна остаться одна на оба экрана.

interface Props {
  value: MoodLevel | null
  onChange: (mood: MoodLevel) => void
  disabled?: boolean
  className?: string
  layout?: 'row' | 'arc'
}

// Насколько плитка опущена относительно самой верхней (замер эталона).
const ARC_OFFSET: Record<number, number> = { 1: 0, 2: 12, 3: 20, 4: 12, 5: 0 }
const ARC_MAX = 20

export function MoodScale({ value, onChange, disabled, className, layout = 'row' }: Props) {
  const t = useTranslations('path.mood')
  const isArc = layout === 'arc'

  if (isArc) {
    return (
      <div
        role="radiogroup"
        aria-label={t('groupLabel')}
        // items-start + индивидуальный сдвиг сверху = дуга. Высота контейнера
        // задана самой высокой плиткой плюс максимальный сдвиг.
        className={cn('flex items-start justify-center gap-2', className)}
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
              // Верхний отступ даёт дугу, нижний добирает до одинаковой высоты
              // бокса у всех плиток (48 + 20). Без него ряд «весит» вниз:
              // высоту задавала самая опущенная плитка, и дуга прижималась к
              // нижней кромке карточки вместо центра.
              style={{
                marginTop: ARC_OFFSET[lvl],
                marginBottom: ARC_MAX - ARC_OFFSET[lvl],
              }}
              className={cn(
                'shadow-chip flex size-12 shrink-0 items-center justify-center rounded-[18px] transition-all',
                'disabled:cursor-not-allowed disabled:opacity-60',
                active ? 'bg-lavender-soft' : 'bg-card',
                dimmed && 'opacity-45',
              )}
            >
              <MoodBadge level={lvl} size={30} />
            </button>
          )
        })}
      </div>
    )
  }

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
