import type { DoseUnit } from './queries'
import { UNIT_LABELS_RU } from './catalog'

/**
 * Склонение единицы дозировки по числу.
 *
 * Несклоняемые: мг, мкг, мл, МЕ — всегда одинаковые.
 * Склоняемые: пшик (1/2-4/5+), кап. (1/2-4/5+).
 *
 * На карточке: "2 мг", "3 пшика", "1 капля".
 */

type PluralForms = [one: string, few: string, many: string]

const UNIT_PLURALS: Partial<Record<DoseUnit, PluralForms>> = {
  puff: ['пшик', 'пшика', 'пшиков'],
  drop: ['капля', 'капли', 'капель'],
  tablet: ['таблетка', 'таблетки', 'таблеток'],
}

/**
 * Русское склонение: выбор формы one/few/many по числу.
 * 1 → one, 2-4 → few, 5-20 → many, 21 → one, 22-24 → few, и т.д.
 */
function pluralIndex(n: number): 0 | 1 | 2 {
  const abs = Math.abs(Math.round(n))
  const mod10 = abs % 10
  const mod100 = abs % 100
  if (mod100 >= 11 && mod100 <= 14) return 2
  if (mod10 === 1) return 0
  if (mod10 >= 2 && mod10 <= 4) return 1
  return 2
}

/**
 * "2 мг", "3 пшика", "1 капля", "100 мкг".
 *
 * Для целых чисел убирает ".0": "2 мг", не "2.0 мг".
 * Для дробных — как есть: "1.5 мг", "3.75 мг".
 */
export function formatDoseWithUnit(amount: number, unit: DoseUnit): string {
  const amountStr = Number.isInteger(amount) ? String(amount) : amount.toString()
  const forms = UNIT_PLURALS[unit]
  if (!forms) return `${amountStr} ${UNIT_LABELS_RU[unit]}`
  return `${amountStr} ${forms[pluralIndex(amount)]}`
}
