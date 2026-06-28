'use client'

import { useState } from 'react'
import { parse } from 'date-fns'

import { convertValue, defaultUnitCode, getAnalyte, unitLabel } from '@/lib/labs/catalog'
import { cn } from '@/lib/utils'

// График динамики одного показателя — чистая линия значений во времени.
// Без референсных полос (коридоры в конфиге выключены, не трогаем). Свой SVG,
// без зависимостей. Переключатель единицы конвертит точки на лету (convertValue,
// детерминированно). Точки разных исходных единиц приводятся к выбранной.
//
// X — даты, Y — значения. Эстетика пастельная (мох/шалфей).

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

export function LabChart({ analyteCode, rows }: { analyteCode: string; rows: ChartRow[] }) {
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

  const ts = points.map((p) => p.t)
  const vs = points.map((p) => p.v)
  const minT = Math.min(...ts)
  const maxT = Math.max(...ts)
  const dataMin = Math.min(...vs)
  const dataMax = Math.max(...vs)

  // Диапазон Y с паддингом; плоская линия → искусственный размах.
  let lo = dataMin
  let hi = dataMax
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

  // Y-метки: max, середина, min (по реальным данным, не по паддингу).
  const yTicks =
    dataMin === dataMax ? [dataMin] : [dataMax, (dataMin + dataMax) / 2, dataMin]

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
                  ? 'bg-[#5A6B4A] text-white'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {u.label}
            </button>
          ))}
        </div>
      )}

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
        {/* Y-метки + тонкие горизонтальные линии сетки */}
        {yTicks.map((tick, i) => {
          const y = yScale(tick)
          return (
            <g key={i}>
              <line
                x1={PADDING.left}
                y1={y}
                x2={W - PADDING.right}
                y2={y}
                stroke="#E8E2D8"
                strokeWidth={1}
              />
              <text
                x={PADDING.left - 6}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={9}
                fill="#7A7A7A"
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
            stroke="#5A6B4A"
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
            fill="#5A6B4A"
            stroke="#FAF6F0"
            strokeWidth={1.5}
          />
        ))}

        {/* X-метки: первая и последняя дата */}
        <text x={PADDING.left} y={H - 6} textAnchor="start" fontSize={9} fill="#7A7A7A">
          {fmtDate(minT)}
        </text>
        {maxT !== minT && (
          <text x={W - PADDING.right} y={H - 6} textAnchor="end" fontSize={9} fill="#7A7A7A">
            {fmtDate(maxT)}
          </text>
        )}
      </svg>

      {/* Подпись единицы под графиком */}
      <p className="mt-1 text-right text-xs text-muted-foreground">
        {analyte ? unitLabel(analyte, displayUnit) : displayUnit}
      </p>
    </div>
  )
}
