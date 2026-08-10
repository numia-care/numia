'use client'

import { useTranslations } from 'next-intl'

import type { RangePosition } from '@/lib/labs/stats'

/**
 * Положение замера относительно персонального коридора: «в коридоре» /
 * «ниже коридора» / «выше коридора».
 *
 * Приложение НЕ оценивает значение. Коридор задал сам человек, и пилюля
 * говорит только то, где число относительно его же границ, — это факт, а не
 * суждение. Отсюда два следствия, которые менять нельзя:
 *   • формулировки описательные: ни «в норме», ни «хорошо», ни «плохо»;
 *   • все три состояния ОДНОГО цвета. Светофор превратил бы «выше коридора» в
 *     «плохо», а для эстрадиола и тестостерона это означало бы прямо
 *     противоположное.
 *
 * Само положение считает positionInRange (stats.ts) — компонент ничего не
 * вычисляет, только показывает. Приходит null (коридора нет либо единицы
 * несопоставимы) — пилюли нет вовсе.
 *
 * Клиентский только ради useTranslations; вызывается и из серверной карточки
 * показателя, и откуда угодно ещё.
 */
export function LabPositionPill({
  position,
}: {
  position: RangePosition | null
}) {
  const t = useTranslations('labs.range')
  if (!position) return null

  return (
    <span className="bg-lavender-soft shrink-0 rounded-full px-2.5 py-1 text-xs font-medium text-foreground/80">
      {t(POSITION_KEY[position])}
    </span>
  )
}

const POSITION_KEY = {
  below: 'posBelow',
  inside: 'posInside',
  above: 'posAbove',
} as const
