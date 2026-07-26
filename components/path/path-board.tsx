'use client'

import { useLayoutEffect, useRef, useState } from 'react'

import type { PathEntry } from '@/lib/path/entries'
import type { PathView } from './path-toolbar'

// Доска «Пути» — absolute-мозаика с замером реальных высот карточек
// (по PNG-эталонам «путь1» дорожка / «путь3» мозаика):
//
//   'path' — карточки ~62% ширины попеременно лево/право, КАСКАДОМ с наездом
//            (следующая начинается примерно с середины предыдущей, эталон
//            путь1). Между ними — ТОЧЕЧНАЯ тёмная S-кривая (мелкие круглые
//            точки, плавные изгибы) под карточками.
//   'grid' — два плотных столбца ~48%: жадная укладка в короткий столбец
//            (shortest-column, эталон путь3), без кривой.
//
// Высоты замеряются ResizeObserver'ом на каждой карточке: ленивая расшифровка
// (фото/текст догружаются) меняет высоту → раскладка и кривая пересчитываются.

interface Point {
  x: number
  y: number
}

interface ItemLayout {
  x: number
  y: number
  w: number
}

const GAP_X = 12 // между столбцами мозаики
const GAP_Y = 24 // вертикальный зазор мозаики
const PATH_W = 0.62 // ширина карточки в виде «дорожка»
const OVERLAP = 0.55 // каскад: следующая начинается с 55% высоты предыдущей
const SAME_SIDE_GAP = 28 // зазор между картами одной стороны (дорожка)

// Гладкая кривая через точки: Catmull-Rom → кубические безье.
function smoothPath(pts: Point[]): string {
  if (pts.length < 2) return ''
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? pts[i + 1]
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
  }
  return d
}

export function PathBoard({
  entries,
  renderEntry,
  view,
}: {
  entries: PathEntry[]
  renderEntry: (entry: PathEntry) => React.ReactNode
  view: PathView
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])
  const [layouts, setLayouts] = useState<ItemLayout[] | null>(null)
  const [boardH, setBoardH] = useState(0)
  const [curve, setCurve] = useState('')
  const [boardW, setBoardW] = useState(0)

  useLayoutEffect(() => {
    function relayout() {
      const container = containerRef.current
      if (!container) return
      const W = container.clientWidth
      if (W === 0) return

      const heights = itemRefs.current
        .slice(0, entries.length)
        .map((el) => el?.offsetHeight ?? 0)
      if (heights.some((h) => h === 0)) return // ещё не отрендерились

      const next: ItemLayout[] = []
      let maxBottom = 0

      if (view === 'grid') {
        const colW = (W - GAP_X) / 2
        const colH = [0, 0]
        heights.forEach((h) => {
          const col = colH[0] <= colH[1] ? 0 : 1
          next.push({ x: col * (colW + GAP_X), y: colH[col], w: colW })
          colH[col] += h + GAP_Y
        })
        maxBottom = Math.max(colH[0], colH[1]) - GAP_Y
        setCurve('')
      } else {
        const colW = W * PATH_W
        const anchors: Point[] = []
        heights.forEach((h, i) => {
          const left = i % 2 === 0
          const x = left ? 0 : W - colW
          const prevY = i > 0 ? next[i - 1].y : 0
          const prevH = i > 0 ? heights[i - 1] : 0
          const sameY = i > 1 ? next[i - 2].y + heights[i - 2] + SAME_SIDE_GAP : 0
          const y = i === 0 ? 0 : Math.max(prevY + prevH * OVERLAP, sameY)
          next.push({ x, y, w: colW })
          // Якорь кривой — внутренний край карточки на её вертикальной середине.
          anchors.push({ x: left ? colW - 8 : W - colW + 8, y: y + h / 2 })
          maxBottom = Math.max(maxBottom, y + h)
        })

        // Промежуточные точки в центральном жёлобе — кривая «провисает» между
        // карточками, образуя S-петли, как в эталоне.
        const pts: Point[] = []
        anchors.forEach((a, i) => {
          pts.push(a)
          const b = anchors[i + 1]
          if (b) pts.push({ x: W / 2 + (i % 2 === 0 ? 30 : -30), y: (a.y + b.y) / 2 })
        })
        setCurve(smoothPath(pts))
      }

      setLayouts(next)
      setBoardH(maxBottom)
      setBoardW(W)
    }

    relayout()
    const ro = new ResizeObserver(relayout)
    if (containerRef.current) ro.observe(containerRef.current)
    itemRefs.current.slice(0, entries.length).forEach((el) => {
      if (el) ro.observe(el)
    })
    return () => ro.disconnect()
  }, [entries, view])

  const ready = layouts !== null && layouts.length === entries.length

  return (
    <div
      ref={containerRef}
      className="relative"
      style={{ height: ready ? boardH : undefined }}
    >
      {/* Точечная кривая-дорожка — под карточками. Тёмная, мелкие точки. */}
      {view === 'path' && ready && curve && (
        <svg
          aria-hidden
          className="pointer-events-none absolute inset-0 z-0"
          width={boardW}
          height={boardH}
          viewBox={`0 0 ${boardW} ${boardH}`}
          fill="none"
        >
          <path
            d={curve}
            className="stroke-foreground/70"
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeDasharray="0.1 8"
          />
        </svg>
      )}

      {entries.map((entry, i) => {
        const l = ready ? layouts![i] : null
        return (
          <div
            key={entry.id}
            ref={(el) => {
              itemRefs.current[i] = el
            }}
            className="transition-opacity duration-300"
            style={
              l
                ? {
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    transform: `translate(${l.x}px, ${l.y}px)`,
                    width: l.w,
                    // Ранние записи выше: их подписи-пилюли наезжают на соседей.
                    zIndex: entries.length - i,
                  }
                : {
                    // До замера: обычный поток (невидимо), чтобы узнать высоты.
                    width: view === 'grid' ? '48%' : `${PATH_W * 100}%`,
                    opacity: 0,
                  }
            }
          >
            {renderEntry(entry)}
          </div>
        )
      })}
    </div>
  )
}
