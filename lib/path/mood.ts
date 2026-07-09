// Визуальный язык шкалы настроения — единый для ввода (MoodScale) и ленты
// (DiaryCard), поэтому вынесен из компонентов в данные.
//
// Метафора: ✦ на пастельном переходе «тяжело → прекрасно». Цвет идёт от
// приглушённого серо-лавандового (закрытое, тяжёлое) к тёплому розовому акценту
// из концепции Figma (лёгкое, сияющее). Размером не кодируем — только цветом,
// чтобы направление шкалы читалось сразу, а точки не сливались.

import type { MoodLevel } from './entries'

export const MOOD_LEVELS: readonly MoodLevel[] = [1, 2, 3, 4, 5]

// Пастельный ramp Кая (Figma «как ты?», сведение 2026-07-09): холодный
// голубой → лаванда → сиреневый → розовый. Переход «тяжело→прекрасно»
// монотонный и читается сразу.
export const MOOD_COLOR: Record<MoodLevel, string> = {
  1: '#B6CBDF', // приглушённый голубой — «тяжело»
  2: '#C9C5E4', // лаванда — «так себе»
  3: '#E8BAF7', // сирень — «нормально»
  4: '#FBABFF', // тёплый лиловый — «хорошо»
  5: '#FFA7D7', // розовый — «прекрасно»
}

// Обводка ячейки ступени (светлее ✦) и цвет подписи (темнее ✦) — из макета.
// Нужны шкале ввода и карточкам, когда доедет вёрстка концепции.
export const MOOD_BORDER: Record<MoodLevel, string> = {
  1: '#C1D5E8',
  2: '#DDD9F7',
  3: '#EBCEFF',
  4: '#FDD6FF',
  5: '#FFD0EA',
}

export const MOOD_TEXT: Record<MoodLevel, string> = {
  1: '#9EB6CB',
  2: '#A9A4C3',
  3: '#CEA1DE',
  4: '#EA91EE',
  5: '#F37CBD',
}

// Цвет ступени с прозрачностью — для фоновой заливки/сияния выбранной ступени.
// #RRGGBB → rgba(r,g,b,alpha).
export function moodRgba(level: MoodLevel, alpha: number): string {
  const hex = MOOD_COLOR[level]
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
