'use client'

import { useState } from 'react'
import { parse } from 'date-fns'

import { convertValue, defaultUnitCode, getAnalyte, unitLabel } from '@/lib/labs/catalog'
import { convertStrict, type UserRange } from '@/lib/labs/stats'
import { cn } from '@/lib/utils'

// График динамики одного показателя — линия значений во времени плюс полоса
// персонального коридора, если он задан.
//
// Коридор задаёт ЧЕЛОВЕК (lab-range-editor), приложение его не вычисляет.
// Полоса — это отрисовка заданных границ, а не вывод из данных.
//
// Пилюля положения жила здесь до шага 3.2 и переехала в карточку показателя
// (labs-history), к крупному значению: там ей место по макету, а дубль в
// шапке графика был бы шумом. Компонент общий — lab-position-pill.tsx.
//
// Свой SVG, без зависимостей. Переключатель единицы конвертит точки на лету.
//
// X — даты, Y — значения. Эстетика пастельная.

interface ChartRow {
  value: number
  unit: string
  measuredAt: string // 'yyyy-MM-dd'
}

// Геометрия SVG (viewBox; масштабируется по ширине контейнера).
const W = 320
const H = 160
const PADDING = { left: 40, right: 12, top: 12, bottom: 22 }
const PLOT_W = W - PADDING.left - PADDING.right
const PLOT_H = H - PADDING.top - PADDING.bottom

const numberFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 })
const fmtNum = (v: number) => numberFmt.format(v)
const fmtDate = (t: number) => {
  const d = new Date(t)
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function LabChart({
  analyteCode,
  rows,
  range = null,
}: {
  analyteCode: string
  rows: ChartRow[]
  /** Персональный коридор показателя или null. Задан юзером, не вычисляется. */
  range?: UserRange | null
}) {
  const analyte = getAnalyte(analyteCode)
  const units = analyte?.units ?? []
  const hasToggle = units.length > 1

  // Дефолтная единица отображения — базовая показателя; для «другое»/неизвестного
  // — единица первой записи (конверсии нет).
  const [displayUnit, setDisplayUnit] = useState(
    () => (analyte && defaultUnitCode(analyte)) ?? rows[0]?.unit ?? '',
  )

  // Точки в выбранной единице, по времени (для линии — по возрастанию).
  const points = rows
    .map((r) => ({
      t: parse(r.measuredAt, 'yyyy-MM-dd', new Date()).getTime(),
      v: analyte ? convertValue(r.value, r.unit, displayUnit, analyte) : r.value,
    }))
    .sort((a, b) => a.t - b.t)

  const hasPoints = points.length > 0

  // ── Полоса коридора ───────────────────────────────────────────────────────
  // Границы приводим к ТОЙ ЖЕ единице, что и точки, — иначе переключение
  // пг/мл ↔ пмоль/л двигало бы точки, а полоса стояла бы на месте.
  //
  // Через convertStrict, а НЕ через convertValue выше: нестрогий при
  // невозможности перевода молча отдаёт исходное число, и полоса нарисовалась
  // бы не там, где означает. Не приводится — полосы просто нет.
  const band = toBand(range, displayUnit, analyte)

  const ts = points.map((p) => p.t)
  const vs = points.map((p) => p.v)
  const minT = Math.min(...ts)
  const maxT = Math.max(...ts)
  const dataMin = Math.min(...vs)
  const dataMax = Math.max(...vs)

  // Домен Y — объединение данных И коридора. Без этого коридор 100–160 при
  // замерах 200–300 уехал бы за кромку полотна, то есть исчез бы ровно в том
  // случае, ради которого он и нужен: «я вне своих границ».
  //
  // На пустом массиве Math.min даёт Infinity, Math.max — -Infinity, и они
  // корректно уступают границам коридора. Поэтому график с нулём точек, но с
  // заданным коридором, рисуется сам собой.
  let lo = band ? Math.min(dataMin, band.lo) : dataMin
  let hi = band ? Math.max(dataMax, band.hi) : dataMax

  // Плоская линия (или единственная точка) → искусственный размах.
  if (lo === hi) {
    lo -= 1
    hi += 1
  }
  const padY = (hi - lo) * 0.08
  lo -= padY
  hi += padY

  const xScale = (t: number) =>
    maxT === minT
      ? PADDING.left + PLOT_W / 2
      : PADDING.left + ((t - minT) / (maxT - minT)) * PLOT_W
  const yScale = (v: number) => PADDING.top + (1 - (v - lo) / (hi - lo)) * PLOT_H

  const linePts = points.map((p) => `${xScale(p.t)},${yScale(p.v)}`).join(' ')

  // Y-метки. Есть коридор — подписываем его границы: они и есть то, с чем
  // человек сверяется, а пять чисел на 320×160 не помещаются. Нет коридора —
  // прежние три по данным.
  const yTicks = band
    ? band.lo === band.hi
      ? [band.hi]
      : [band.hi, band.lo]
    : !hasPoints
      ? []
      : dataMin === dataMax
        ? [dataMin]
        : [dataMax, (dataMin + dataMax) / 2, dataMin]

  // Пилюля положения переехала в карточку показателя (labs-history), к
  // крупному значению — там ей место по макету, и дубль в шапке графика был
  // бы шумом. Компонент общий: components/labs/lab-position-pill.tsx.

  return (
    <div className="mb-4 rounded-2xl bg-card p-4 ring-1 ring-border">
      {hasToggle && (
        <div className="mb-3 flex justify-end gap-1">
          {units.map((u) => (
            <button
              key={u.code}
              type="button"
              onClick={() => setDisplayUnit(u.code)}
              aria-pressed={displayUnit === u.code}
              className={cn(
                'rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
                displayUnit === u.code
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {u.label}
            </button>
          ))}
        </div>
      )}

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
        {/* Полоса коридора — под линией и точками, иначе перекроет их. */}
        {band && (
          <>
            <rect
              x={PADDING.left}
              y={yScale(band.hi)}
              width={PLOT_W}
              // yScale инвертирует: верхняя граница даёт МЕНЬШИЙ y.
              height={Math.max(0, yScale(band.lo) - yScale(band.hi))}
              rx={10}
              fill="var(--color-lavender-soft)"
              opacity={0.55}
            />
            {[band.hi, band.lo].map((v, i) => (
              <line
                key={i}
                x1={PADDING.left}
                y1={yScale(v)}
                x2={W - PADDING.right}
                y2={yScale(v)}
                stroke="var(--color-lavender-deep)"
                strokeWidth={1}
                strokeDasharray="3 4"
              />
            ))}
          </>
        )}

        {/* Y-метки. Линии сетки рисуем только без коридора: у полосы уже есть
            свои пунктирные границы, вторая сетка поверх них — каша. */}
        {yTicks.map((tick, i) => {
          const y = yScale(tick)
          return (
            <g key={i}>
              {!band && (
                <line
                  x1={PADDING.left}
                  y1={y}
                  x2={W - PADDING.right}
                  y2={y}
                  stroke="var(--border)"
                  strokeWidth={1}
                />
              )}
              <text
                x={PADDING.left - 6}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={9}
                fill={band ? 'var(--color-lavender-deep)' : 'var(--muted-foreground)'}
              >
                {fmtNum(tick)}
              </text>
            </g>
          )
        })}

        {/* Линия динамики */}
        {points.length > 1 && (
          <polyline
            points={linePts}
            fill="none"
            stroke="var(--chart-1)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Точки */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={xScale(p.t)}
            cy={yScale(p.v)}
            r={3}
            fill="var(--chart-1)"
            stroke="var(--background)"
            strokeWidth={1.5}
          />
        ))}

        {/* X-метки: первая и последняя дата. Без точек дат нет — minT там
            Infinity, и подпись стала бы «Invalid Date». */}
        {hasPoints && (
          <>
            <text x={PADDING.left} y={H - 6} textAnchor="start" fontSize={9} fill="var(--muted-foreground)">
              {fmtDate(minT)}
            </text>
            {maxT !== minT && (
              <text x={W - PADDING.right} y={H - 6} textAnchor="end" fontSize={9} fill="var(--muted-foreground)">
                {fmtDate(maxT)}
              </text>
            )}
          </>
        )}
      </svg>

      {/* Подпись единицы под графиком */}
      <p className="mt-1 text-right text-xs text-muted-foreground">
        {analyte ? unitLabel(analyte, displayUnit) : displayUnit}
      </p>
    </div>
  )
}

/**
 * Границы коридора в единице отображения — или null, если перевод не обоснован.
 *
 * Строгая проверка сопоставимости берётся ОБЩАЯ, из stats.ts: дублировать
 * правило «что с чем сравнимо» в графике значило бы завести второй ответ,
 * который через полгода разойдётся с первым. Её поведение уже покрыто тестами.
 */
function toBand(
  range: UserRange | null,
  displayUnit: string,
  analyte: ReturnType<typeof getAnalyte>,
): { lo: number; hi: number } | null {
  if (!range || !analyte) return null
  const lo = convertStrict(range.min, range.unitCode, displayUnit, analyte)
  if (lo === null) return null
  const hi = convertStrict(range.max, range.unitCode, displayUnit, analyte)
  if (hi === null) return null
  return { lo, hi }
}

