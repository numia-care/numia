// Визуальный язык шкалы настроения — единый для ввода (MoodScale), ленты
// (MoodBadge на карточках) и форм, поэтому вынесен из компонентов в данные.
//
// Палитра — точно по PNG-эталонам макета:
// лаванда (тяжело) → голубой → мята (нормально) → зелёный → лайм (прекрасно).
// Форма бейджа тоже кодирует ступень (см. MOOD_SHAPE + mood-badge.tsx):
// колючая звезда → мягкий зубчатый цветок → круг → цветок → шестерёнка.

import type { MoodLevel } from './entries'

export const MOOD_LEVELS: readonly MoodLevel[] = [1, 2, 3, 4, 5]

export const MOOD_COLOR: Record<MoodLevel, string> = {
  1: '#C9B4EA', // лаванда — «тяжело»
  2: '#A3C0EE', // голубой — «так себе»
  3: '#7EDAC5', // мята — «нормально»
  4: '#6EDC85', // зелёный — «хорошо»
  5: '#A9E25E', // лайм — «прекрасно»
}

// Обводка ячейки (светлее) и цвет подписи (темнее) — производные ступени.
export const MOOD_BORDER: Record<MoodLevel, string> = {
  1: '#DFD2F3',
  2: '#C8D9F5',
  3: '#B4EBDF',
  4: '#B0EDBD',
  5: '#D4F0A5',
}

export const MOOD_TEXT: Record<MoodLevel, string> = {
  1: '#8F76B5',
  2: '#6E8DC0',
  3: '#37A78E',
  4: '#38AC57',
  5: '#74A32B',
}

// Параметры формы бейджа: число лепестков и глубина волны (0 = круг).
// Отдельные силуэты на ступень — как в эталоне (star/scallop/circle/flower/gear).
export const MOOD_SHAPE: Record<MoodLevel, { petals: number; depth: number }> = {
  1: { petals: 8, depth: 0.2 },
  2: { petals: 8, depth: 0.11 },
  3: { petals: 1, depth: 0 },
  4: { petals: 10, depth: 0.1 },
  5: { petals: 12, depth: 0.14 },
}

// Кривизна рта: -1 грусть … 0 ровно … 1 улыбка.
export const MOOD_MOUTH: Record<MoodLevel, number> = {
  1: -1,
  2: -0.5,
  3: 0,
  4: 0.7,
  5: 1,
}

// Цвет ступени с прозрачностью — для заливок/сияний. #RRGGBB → rgba().
export function moodRgba(level: MoodLevel, alpha: number): string {
  const hex = MOOD_COLOR[level]
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
