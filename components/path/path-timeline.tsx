'use client'

import { useLayoutEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'
import type { PathEntry } from '@/lib/path/entries'

// Извилистая дорожка «Пути» по макету Кая (фрейм 583:155): записи расставлены
// попеременно лево/право, между ними вьётся пунктирная линия. У Кая линия —
// рисованный статичный вектор под 4 записи; для ДИНАМИЧЕСКОЙ ленты рисуем её
// ПРОЦЕДУРНО: замеряем вертикальные центры карточек и «внутренние» края
// (сторона, обращённая к центру), соединяем плавными кубическими кривыми.
//
// Перерасчёт: ResizeObserver на контейнере ловит и ресайз окна, и изменение
// высоты карточек (фото/текст догружаются и расшифровываются лениво → высота
// растёт → контейнер меняет размер → пересчитываем путь).

interface Point {
  x: number
  y: number
}

export function PathTimeline({
  entries,
  renderEntry,
}: {
  entries: PathEntry[]
  renderEntry: (entry: PathEntry) => React.ReactNode
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])
  const [pathD, setPathD] = useState('')
  const [size, setSize] = useState({ w: 0, h: 0 })

  useLayoutEffect(() => {
    function measure() {
      const container = containerRef.current
      if (!container) return
      const cRect = container.getBoundingClientRect()

      const points: Point[] = []
      itemRefs.current.forEach((el, i) => {
        if (!el) return
        const r = el.getBoundingClientRect()
        const y = r.top - cRect.top + r.height / 2
        // Якорь — край карточки, обращённый к центру (чётные слева → правый край).
        const x = i % 2 === 0 ? r.right - cRect.left : r.left - cRect.left
        points.push({ x, y })
      })

      // Плавная кривая через якоря: горизонтальные «ручки» на середине высоты
      // между соседями дают мягкую S-волну, без острых углов.
      let d = ''
      points.forEach((p, i) => {
        if (i === 0) {
          d = `M ${p.x.toFixed(1)} ${p.y.toFixed(1)}`
          return
        }
        const prev = points[i - 1]
        const midY = ((prev.y + p.y) / 2).toFixed(1)
        d += ` C ${prev.x.toFixed(1)} ${midY}, ${p.x.toFixed(1)} ${midY}, ${p.x.toFixed(1)} ${p.y.toFixed(1)}`
      })

      setPathD(d)
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
  }, [entries.length])

  return (
    <div ref={containerRef} className="relative">
      {/* Дорожка — под карточками (z-0). Пунктир с круглыми точками, мягкий ink. */}
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
            className="stroke-foreground"
            strokeOpacity={0.28}
            strokeWidth={2}
            strokeLinecap="round"
            strokeDasharray="1 9"
          />
        )}
      </svg>

      {/* Карточки — над дорожкой, попеременно лево/право (~72% ширины). */}
      <div className="relative z-10 space-y-8">
        {entries.map((entry, i) => (
          <div
            key={entry.id}
            ref={(el) => {
              itemRefs.current[i] = el
            }}
            className={cn('w-[72%]', i % 2 === 0 ? 'mr-auto' : 'ml-auto')}
          >
            {renderEntry(entry)}
          </div>
        ))}
      </div>
    </div>
  )
}
