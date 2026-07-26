'use client'

import { useLayoutEffect, useRef, useState } from 'react'

import type { PathEntry } from '@/lib/path/entries'
import type { PathView } from './path-toolbar'

// Доска «Пути» по макету Кая (фреймы 583:155 / 591:398): карточки в ДВА
// столбца мозаикой (разной высоты), записи чередуются лево/право по времени.
//
// Вид 'path'  — между карточками вьётся ПЛАВНАЯ НЕПРЕРЫВНАЯ кривая (S-образная,
//               акцентный цвет). Не пунктир: сплайн Catmull-Rom через якоря
//               (внутренние края карточек в центральном жёлобе).
// Вид 'grid'  — та же мозаика без линии.
//
// Кривая пересчитывается по ResizeObserver: и на ресайз, и когда фото/текст
// лениво догружаются (высота карточек растёт → контейнер меняет размер).

interface Point {
  x: number
  y: number
}

// Гладкий путь через точки: Catmull-Rom → кубические безье (C1-непрерывность).
function buildSmoothPath(pts: Point[]): string {
  if (pts.length < 2) return ''
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? pts[i + 1]
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
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
  const [pathD, setPathD] = useState('')
  const [size, setSize] = useState({ w: 0, h: 0 })

  // Чётные → левый столбец, нечётные → правый (зигзаг по времени).
  const withIndex = entries.map((entry, i) => ({ entry, i }))
  const left = withIndex.filter((p) => p.i % 2 === 0)
  const right = withIndex.filter((p) => p.i % 2 === 1)

  useLayoutEffect(() => {
    // В виде «мозаика» линию не считаем; svg не рендерится (view-гард ниже),
    // поэтому устаревший pathD не виден. При возврате в 'path' эффект
    // перезапустится (view в зависимостях) и пересчитает.
    if (view !== 'path') return
    function measure() {
      const container = containerRef.current
      if (!container) return
      const cRect = container.getBoundingClientRect()

      const points: Point[] = []
      itemRefs.current.forEach((el, i) => {
        if (!el) return
        const r = el.getBoundingClientRect()
        const y = r.top - cRect.top + r.height / 2
        // Якорь — край, обращённый к центру (чётные слева → правый край).
        const x = i % 2 === 0 ? r.right - cRect.left : r.left - cRect.left
        points.push({ x, y })
      })

      setPathD(buildSmoothPath(points))
      setSize({ w: cRect.width, h: cRect.height })
    }

    measure()
    const ro = new ResizeObserver(measure)
    if (containerRef.current) ro.observe(containerRef.current)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [entries.length, view])

  return (
    <div ref={containerRef} className="relative">
      {/* Кривая-дорожка — под карточками (z-0), сплошная, акцентный цвет. */}
      {view === 'path' && (
        <svg
          aria-hidden
          className="pointer-events-none absolute inset-0 z-0"
          width={size.w}
          height={size.h}
          viewBox={`0 0 ${size.w} ${size.h}`}
          fill="none"
        >
          {pathD && (
            <path
              d={pathD}
              className="stroke-lavender-deep"
              strokeOpacity={0.55}
              strokeWidth={2.5}
              strokeLinecap="round"
            />
          )}
        </svg>
      )}

      {/* Две колонки мозаикой; правая слегка смещена вниз (стаггер, как у Кая). */}
      <div className="relative z-10 flex items-start gap-3">
        <div className="flex flex-1 flex-col gap-6">
          {left.map(({ entry, i }) => (
            <div
              key={entry.id}
              ref={(el) => {
                itemRefs.current[i] = el
              }}
            >
              {renderEntry(entry)}
            </div>
          ))}
        </div>
        <div className="mt-10 flex flex-1 flex-col gap-6">
          {right.map(({ entry, i }) => (
            <div
              key={entry.id}
              ref={(el) => {
                itemRefs.current[i] = el
              }}
            >
              {renderEntry(entry)}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
