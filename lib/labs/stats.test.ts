import { describe, expect, it } from 'vitest'

import { getAnalyte } from './catalog'
import {
  computeLabDelta,
  computeLabTrend,
  positionInRange,
  type MeasuredPoint,
} from './stats'

// Тесты на медбезопасность расчётов: несопоставимые единицы нельзя вычитать и
// сравнивать, коридор задаёт только юзер, границы включительно.
//
// Почему именно эти кейсы: цена ошибки тут не «кривая вёрстка», а неверное
// число рядом со словом «эстрадиол». convertValue из каталога при невозможности
// перевода молча возвращает исходное значение (catalog.ts:140) — то есть
// разность посчиталась бы как будто единицы совпадают. Всё, что ниже, проверяет
// вторую линию: convertStrict в stats.ts, который в таких случаях отдаёт null.

const e2 = getAnalyte('estradiol')!
const other = getAnalyte('other')!

describe('computeLabDelta — смешанные единицы', () => {
  it('приводит обе точки к displayUnit перед вычитанием', () => {
    const delta = computeLabDelta(
      { value: 300, unit: 'pmol_l', measured_at: '2026-08-01' },
      { value: 80, unit: 'pg_ml', measured_at: '2026-05-01' },
      'pmol_l',
      e2,
    )

    // 80 пг/мл = 293.59999999999997 пмоль/л, значит 300 − 293.6 ≈ 6.4.
    // Именно toBeCloseTo: точного 6.4 в двоичной плавающей запятой не
    // получится, реальный результат 6.400000000000034. Проверка на toBe(6.4)
    // была бы красной при верном расчёте.
    expect(delta).toBeCloseTo(6.4, 10)
  })

  it('НЕ вычитает сырые значения (иначе вышло бы 220)', () => {
    const delta = computeLabDelta(
      { value: 300, unit: 'pmol_l', measured_at: '2026-08-01' },
      { value: 80, unit: 'pg_ml', measured_at: '2026-05-01' },
      'pmol_l',
      e2,
    )

    // Контроль к предыдущему кейсу. Без приведения единиц получилось бы
    // 300 − 80 = 220 — ровно та ошибка, ради которой существует convertStrict.
    expect(300 - 80).toBe(220)
    expect(delta).not.toBe(220)
  })
})

describe('positionInRange — коридор юзера', () => {
  // Границы, «назначенные врачом». Функция их не вычисляет и вычислять не
  // должна: коридор всегда приходит аргументом.
  const range = { min: 100, max: 250, unitCode: 'pmol_l' }

  it('нижняя граница включительно', () => {
    expect(positionInRange(100, 'pmol_l', range, e2)).toBe('inside')
  })

  it('верхняя граница включительно', () => {
    expect(positionInRange(250, 'pmol_l', range, e2)).toBe('inside')
  })

  it('чуть ниже границы — below', () => {
    expect(positionInRange(99.9, 'pmol_l', range, e2)).toBe('below')
  })

  it('чуть выше границы — above', () => {
    expect(positionInRange(250.1, 'pmol_l', range, e2)).toBe('above')
  })

  it('приводит значение к единице коридора: 50 пг/мл = 183.5 пмоль/л → inside', () => {
    expect(positionInRange(50, 'pg_ml', range, e2)).toBe('inside')
  })

  it('приводит значение к единице коридора: 80 пг/мл = 293.6 пмоль/л → above', () => {
    // Без приведения 80 попало бы в коридор 100–250 как below — то есть
    // «мало» вместо «много». Клинически это противоположный вывод.
    expect(positionInRange(80, 'pg_ml', range, e2)).toBe('above')
  })
})

describe("analyte='other' — свободные единицы", () => {
  const d1 = '2026-05-01'
  const d2 = '2026-08-01'

  it('несовпадающие единицы: computeLabDelta → null, не число', () => {
    const delta = computeLabDelta(
      { value: 30, unit: 'нг/мл', measured_at: d2 },
      { value: 12, unit: 'мкг/л', measured_at: d1 },
      'нг/мл',
      other,
    )

    // Коэффициента между произвольными строками мы не знаем и выдумывать не
    // будем. Ответ «18» здесь был бы хуже отсутствия ответа.
    expect(delta).toBeNull()
    expect(delta).not.toBe(18)
  })

  it('несовпадающие единицы: computeLabTrend → null', () => {
    const trend = computeLabTrend(
      [
        { value: 12, unit: 'мкг/л', measured_at: d1 },
        { value: 30, unit: 'нг/мл', measured_at: d2 },
      ],
      other,
    )

    // Точка в чужой единице отбрасывается, остаётся одна — тренда нет.
    expect(trend).toBeNull()
  })

  it('несовпадающие единицы: positionInRange → null', () => {
    const position = positionInRange(
      30,
      'нг/мл',
      { min: 0, max: 100, unitCode: 'мкг/л' },
      other,
    )

    expect(position).toBeNull()
  })

  it('совпадающие после trim ("мкг/л " vs "мкг/л") — считает нормально', () => {
    // Контроль к трём кейсам выше: строгость не должна превращаться в отказ
    // считать вообще. Лишний пробел — не повод молчать.
    const delta = computeLabDelta(
      { value: 30, unit: 'мкг/л', measured_at: d2 },
      { value: 12, unit: 'мкг/л ', measured_at: d1 },
      'мкг/л',
      other,
    )
    expect(delta).toBe(18)

    const position = positionInRange(
      30,
      'мкг/л ',
      { min: 0, max: 100, unitCode: 'мкг/л' },
      other,
    )
    expect(position).toBe('inside')

    const trend = computeLabTrend(
      [
        { value: 12, unit: 'мкг/л ', measured_at: d1 },
        { value: 30, unit: 'мкг/л', measured_at: d2 },
      ],
      other,
    )
    expect(trend).toEqual({ direction: 'up', streak: 1 })
  })
})

describe('computeLabTrend — замер без даты не участвует', () => {
  // Инвариант держат ДВЕ независимые линии защиты. Ниже по кейсу на каждую.

  it('ЛИНИЯ 1 (тип): measured_at не может быть null', () => {
    const undated: MeasuredPoint = {
      value: 999,
      unit: 'pg_ml',
      // @ts-expect-error — MeasuredPoint.measured_at объявлен как string, а не
      // string | null (в отличие от LabResultRow). Недатированную точку тип
      // просто не собирает.
      //
      // ВАЖНО, как это проверяется: не раннером. `vitest run` снимает типы
      // esbuild'ом без проверки, поэтому красным этот кейс делает `pnpm
      // typecheck` — если measured_at однажды ослабят до nullable, директива
      // станет лишней и tsc упадёт с «Unused '@ts-expect-error' directive».
      // Через `as` было бы молча и бесполезно: as обошёл бы ровно ту проверку,
      // которую мы тут и держим.
      measured_at: null,
    }

    // Рантайм-следствие: даже просочившись, такая точка до арифметики не дойдёт.
    expect(computeLabTrend([undated], e2)).toBeNull()
  })

  it('ЛИНИЯ 2 (рантайм): пустая строка в дате отбрасывается isUsable', () => {
    // Пустая строка — валидный string, тип её пропускает. Это путь для вызова
    // из нетипизированного места (JS, непроверенный JSON): ловит уже isUsable.
    const trend = computeLabTrend(
      [
        { value: 40, unit: 'pg_ml', measured_at: '' },
        { value: 95, unit: 'pg_ml', measured_at: '2026-08-01' },
      ],
      e2,
    )

    // Годной осталась одна точка из двух — тренда нет.
    expect(trend).toBeNull()
  })
})

describe('computeLabTrend — направление и серия', () => {
  it('три точки вверх (единицы смешаны) → up, streak 2', () => {
    const trend = computeLabTrend(
      [
        { value: 40, unit: 'pg_ml', measured_at: '2026-03-01' },
        // 220 пмоль/л ≈ 59.95 пг/мл — между 40 и 95, серия не рвётся.
        { value: 220, unit: 'pmol_l', measured_at: '2026-05-01' },
        { value: 95, unit: 'pg_ml', measured_at: '2026-08-01' },
      ],
      e2,
    )

    // streak считает ПЕРЕХОДЫ, не точки: два подъёма на трёх замерах.
    expect(trend).toEqual({ direction: 'up', streak: 2 })
  })

  it('равенство в конце ряда → flat со streak 1', () => {
    const trend = computeLabTrend(
      [
        { value: 10, unit: 'pg_ml', measured_at: '2026-03-01' },
        { value: 20, unit: 'pg_ml', measured_at: '2026-05-01' },
        { value: 20, unit: 'pg_ml', measured_at: '2026-08-01' },
      ],
      e2,
    )

    expect(trend).toEqual({ direction: 'flat', streak: 1 })
  })

  it('равенство в середине обрывает серию', () => {
    const trend = computeLabTrend(
      [
        { value: 10, unit: 'pg_ml', measured_at: '2026-01-01' },
        { value: 10, unit: 'pg_ml', measured_at: '2026-03-01' },
        { value: 20, unit: 'pg_ml', measured_at: '2026-05-01' },
        { value: 30, unit: 'pg_ml', measured_at: '2026-08-01' },
      ],
      e2,
    )

    // Два подъёма подряд в конце (10→20→30), а переход 10→10 перед ними —
    // равенство, и серию оно не продолжает.
    expect(trend).toEqual({ direction: 'up', streak: 2 })
  })
})

describe('positionInRange — перевёрнутый коридор', () => {
  it('min > max → null, а не догадка о том, что имелось в виду', () => {
    const position = positionInRange(
      150,
      'pmol_l',
      { min: 250, max: 100, unitCode: 'pmol_l' },
      e2,
    )

    expect(position).toBeNull()
  })
})
