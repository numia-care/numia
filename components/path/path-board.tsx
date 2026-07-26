'use client'

import { useLayoutEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'
import type { PathEntry } from '@/lib/path/entries'
import type { PathView } from './path-toolbar'

// Доска «Пути»: ДВЕ НЕЗАВИСИМЫЕ колонки без наложений (флекс, обычный поток).
// Записи чередуются: чётные — левая колонка, нечётные — правая.
//
//   'path' — свободный ритм: правая колонка смещена вниз (стаггер), зазоры
//            крупнее, между карточками вьётся точечная S-кривая (эталон путь1).
//   'grid' — плотная мозаика: зазоры меньше, без кривой (эталон путь3).
//
// Кривая рисуется ПО ЗАМЕРАМ реальных карточек и пересчитывается
// ResizeObserver'ом (ленивая догрузка фото/текста меняет высоты). Absolute-
// раскладки НЕТ — наложения и переполнения исключены самим потоком документа.

interface Point {
  x: number
  y: number
}

const n = (v: number) => v.toFixed(1)

// Гладкая кривая через точки: Catmull-Rom → кубические безье.
function smoothPath(pts: Point[]): string {
  if (pts.length < 2) return ''
  const seg: string[] = ['M ' + n(pts[0].x) + ' ' + n(pts[0].y)]
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? pts[i + 1]
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    seg.push(
      'C ' + n(c1x) + ' ' + n(c1y) + ', ' + n(c2x) + ' ' + n(c2y) + ', ' + n(p2.x) + ' ' + n(p2.y),
    )
  }
  return seg.join(' ')
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
  const [curve, setCurve] = useState('')
  const [size, setSize] = useState({ w: 0, h: 0 })

  const isPath = view === 'path'

  // Чередование по индексу: чётные — левая колонка, нечётные — правая.
  const withIndex = entries.map((entry, i) => ({ entry, i }))
  const left = withIndex.filter((p) => p.i % 2 === 0)
  const right = withIndex.filter((p) => p.i % 2 === 1)

  useLayoutEffect(() => {
    if (!isPath) return
    function measure() {
      const container = containerRef.current
      if (!container) return
      const cRect = container.getBoundingClientRect()

      // Якоря — внутренние края карточек (сторона к центру), между соседями —
      // точка в центральном жёлобе: получаются S-петли, как в эталоне.
      const anchors: Point[] = []
      itemRefs.current.slice(0, entries.length).forEach((el, i) => {
        if (!el) return
        const r = el.getBoundingClientRect()
        const y = r.top - cRect.top + r.height / 2
        const x = i % 2 === 0 ? r.right - cRect.left - 6 : r.left - cRect.left + 6
        anchors.push({ x, y })
      })
      const pts: Point[] = []
      anchors.forEach((a, i) => {
        pts.push(a)
        const b = anchors[i + 1]
        if (b) pts.push({ x: cRect.width / 2 + (i % 2 === 0 ? 26 : -26), y: (a.y + b.y) / 2 })
      })

      setCurve(smoothPath(pts))
      setSize({ w: cRect.width, h: container.offsetHeight })
    }

    measure()
    const ro = new ResizeObserver(measure)
    if (containerRef.current) ro.observe(containerRef.current)
    itemRefs.current.slice(0, entries.length).forEach((el) => el && ro.observe(el))
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [entries, isPath])

  const gap = isPath ? 'gap-7' : 'gap-3'
  const colGap = isPath ? 'gap-7' : 'gap-3'
  const rightStagger = isPath ? 'mt-12' : ''

  return (
    <div ref={containerRef} className="relative">
      {/* Точечная кривая-дорожка — под карточками (только вид «дорожка»). */}
      {isPath && curve && (
        <svg
          aria-hidden
          className="pointer-events-none absolute inset-0 z-0"
          width={size.w}
          height={size.h}
          viewBox={'0 0 ' + size.w + ' ' + size.h}
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

      {/* Две независимые колонки: обычный поток, без absolute → без наложений. */}
      <div className={cn('relative z-10 flex items-start', colGap)}>
        <div className={cn('flex min-w-0 flex-1 flex-col', gap)}>
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
        <div className={cn('flex min-w-0 flex-1 flex-col', gap, rightStagger)}>
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
