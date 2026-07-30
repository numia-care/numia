'use client'

import { useLayoutEffect, useMemo, useRef, useState } from 'react'

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

interface Rect {
  left: number
  right: number
  top: number
  bottom: number
  cx: number
  cy: number
}

const n = (v: number) => v.toFixed(1)
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

// ── Ритм лесенки — ЗАМЕР эталона путь1/2 ─────────────────────────────────────
// Верхушки карточек по порядку ленты: 228 → 332 → 493 → 647, то есть шаг
// чередуется: 105 при переходе влево→вправо и 160 при вправо→влево. Сумма 265 —
// шаг внутри колонки (высота карточки 177 + зазор 88, сходится).
// Жёлоб между колонками — 42.
//
// ВАЖНО: позиция карточки считается ТОЛЬКО из шага, высота содержимого на неё
// не влияет. При раскладке потоком колонки разъезжались (в одной короткая
// голосовая, в другой высокое фото), лесенка скакала, появлялись провалы, и
// дуга местами заходила на соседнюю карточку.
const STEP_LR = 105
const STEP_RL = 160
// Жёлоб между колонками «дорожки». 33 — замер эталона путь1 по профилю строки:
// левая карточка кончается на 177, правая начинается на 210. Прежние 42 были
// сняты на строке, где вторая колонка ещё не начиналась, — замер был неверный.
const GUTTER = 33

// Мозаика (путь3): вертикальный зазор между карточками в колонке. Замер эталона
// даёт ~12; держим числом, а не Tailwind-классом, потому что то же значение
// участвует в расчёте балансировки колонок.
const GRID_ROW_GAP = 12

/** Верх карточки #i: сумма чередующихся шагов. */
function stepTop(i: number): number {
  return Math.floor(i / 2) * (STEP_LR + STEP_RL) + (i % 2 === 1 ? STEP_LR : 0)
}

// ── Форма дуги (единственное вкусовое; всё остальное — замеры эталона) ────────
const DROP = 64 // на сколько дуга спускается по вертикали (в макете 40–70)
const LAND = 0.65 // куда садится на верхнюю грань цели (в макете 45–75% ширины)
const OUT_K = 0.55 // длина горизонтального выхода
const IN_K = 0.75 // крутизна приземления

// Коннектор между соседними карточками — по ЗАМЕРАМ эталона путь1/2
// (координаты точек пунктира сняты с JPG, не на глаз):
//   • выходит за внутренний край источника на 8px и стартует ГОРИЗОНТАЛЬНО
//     (в макете первые ~45pt дорожки идут ровно);
//   • идёт по воздуху между колонками — размах даёт увеличенный зазор
//     (жёлоб 42px, зазор в колонке 88px, сдвиг колонки 105px, см. ниже);
//   • садится на ВЕРХНЮЮ грань следующей карточки почти вертикально.
//
// Веток нет: одна формула на оба направления, поэтому «слева направо» и
// «справа налево» выглядят одинаково. Прежний вариант «угол-в-угол» давал
// вертикальный зигзаг — якоря сидели в узком жёлобе, и размаху взяться было
// неоткуда.
function connector(a: Rect, b: Rect, leftToRight: boolean): string {
  const bw = b.right - b.left

  const to = {
    x: leftToRight ? b.left + bw * LAND : b.right - bw * LAND,
    y: b.top - 2,
  }
  // Точка выхода отсчитывается от приземления (а не от габаритов карточки) —
  // так дуга одинакова, высокое там фото или короткая голосовая. Clamp держит
  // её в пределах карточки-источника.
  const from = {
    x: leftToRight ? a.right + 8 : a.left - 8,
    y: clamp(to.y - DROP, a.top + 16, a.bottom - 8),
  }

  const dx = to.x - from.x
  const dy = to.y - from.y
  const c1 = { x: from.x + dx * OUT_K, y: from.y } // касательная горизонтальна
  const c2 = { x: to.x, y: to.y - dy * IN_K } // касательная вертикальна

  return (
    'M ' + n(from.x) + ' ' + n(from.y) +
    ' C ' + n(c1.x) + ' ' + n(c1.y) +
    ', ' + n(c2.x) + ' ' + n(c2.y) +
    ', ' + n(to.x) + ' ' + n(to.y)
  )
}

export function PathBoard({
  entries,
  renderEntry,
  view,
}: {
  entries: PathEntry[]
  // side — в какой колонке оказалась карточка. Нужен подписи: её пузырь
  // сдвигается в сторону жёлоба, то есть зеркально для левой и правой колонки.
  renderEntry: (entry: PathEntry, side: 'left' | 'right') => React.ReactNode
  view: PathView
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])
  const [curve, setCurve] = useState('')
  const [size, setSize] = useState({ w: 0, h: 0 })
  // Высота доски в виде «дорожка»: карточки абсолютные, поток её не задаёт.
  const [boardHeight, setBoardHeight] = useState<number | undefined>(undefined)

  // Высоты карточек мозаики (замер) — по ним балансируем колонки.
  const [heights, setHeights] = useState<number[]>([])

  const isPath = view === 'path'

  // ── Мозаика: балансировка колонок ───────────────────────────────────────────
  // Каждая следующая карточка падает в ту колонку, которая СЕЙЧАС короче по
  // суммарной высоте — тогда низ выравнивается сам. Раскладка «через одну»
  // (чётные влево, нечётные вправо) этого не умеет: высокое фото и короткая
  // голосовая чередуются, и одна колонка уезжает вниз.
  //
  // Порядок записей по датам НЕ меняется — меняется только колонка.
  // Пока высоты не замерены (первый кадр), кладём через одну, как раньше.
  const columns = useMemo(() => {
    const leftIdx: number[] = []
    const rightIdx: number[] = []
    const measured = heights.length === entries.length
    let hl = 0
    let hr = 0

    entries.forEach((_, i) => {
      const toLeft = measured ? hl <= hr : i % 2 === 0
      if (toLeft) {
        leftIdx.push(i)
        hl += (heights[i] ?? 0) + GRID_ROW_GAP
      } else {
        rightIdx.push(i)
        hr += (heights[i] ?? 0) + GRID_ROW_GAP
      }
    })
    return { left: leftIdx, right: rightIdx }
  }, [entries, heights])

  // Замер высот для мозаики. Ширина колонок одинаковая, поэтому высота карточки
  // от выбора колонки не зависит — балансировка сходится за один проход и не
  // зацикливается.
  useLayoutEffect(() => {
    if (isPath) return
    function measure() {
      const next = itemRefs.current
        .slice(0, entries.length)
        .map((el) => el?.getBoundingClientRect().height ?? 0)
      setHeights((prev) =>
        prev.length === next.length && prev.every((v, i) => Math.abs(v - next[i]) < 1)
          ? prev // ничего не поменялось — не дёргаем ререндер
          : next,
      )
    }

    measure()
    const ro = new ResizeObserver(measure)
    itemRefs.current.slice(0, entries.length).forEach((el) => el && ro.observe(el))
    return () => ro.disconnect()
  }, [entries, isPath])

  useLayoutEffect(() => {
    if (!isPath) return
    function measure() {
      const container = containerRef.current
      if (!container) return
      const cRect = container.getBoundingClientRect()

      // Замеряем карточки в координатах контейнера.
      const rects: Rect[] = []
      itemRefs.current.slice(0, entries.length).forEach((el) => {
        if (!el) return
        const r = el.getBoundingClientRect()
        rects.push({
          left: r.left - cRect.left,
          right: r.right - cRect.left,
          top: r.top - cRect.top,
          bottom: r.bottom - cRect.top,
          cx: r.left - cRect.left + r.width / 2,
          cy: r.top - cRect.top + r.height / 2,
        })
      })

      const segments: string[] = []

      // Хвостик из точек над первой карточкой — дорожка «приходит откуда-то»
      // (в эталоне путь1/2 он есть).
      const first = rects[0]
      if (first) {
        segments.push(
          // 26px — влезает в отступ под тулбаром (mb-7), не наезжая на кнопки.
          'M ' + n(first.right - 4) + ' ' + n(first.top - 26) +
            ' C ' + n(first.right - 4) + ' ' + n(first.top - 16) +
            ', ' + n(first.right - 10) + ' ' + n(first.top - 12) +
            ', ' + n(first.right - 10) + ' ' + n(first.top - 4),
        )
      }

      // По одному коннектору на пару соседей: чётный индекс — карточка слева,
      // значит линия идёт слева направо, и наоборот.
      for (let i = 0; i < rects.length - 1; i++) {
        segments.push(connector(rects[i], rects[i + 1], i % 2 === 0))
      }

      // Хвостик вниз от последней карточки — дорожка «уходит дальше».
      const last = rects[rects.length - 1]
      if (last && rects.length > 1) {
        const toRight = (rects.length - 1) % 2 === 0
        const x = toRight ? last.right - 10 : last.left + 10
        segments.push(
          'M ' + n(x) + ' ' + n(last.bottom + 6) +
            ' C ' + n(x) + ' ' + n(last.bottom + 22) +
            ', ' + n(x + (toRight ? 14 : -14)) + ' ' + n(last.bottom + 26) +
            ', ' + n(x + (toRight ? 16 : -16)) + ' ' + n(last.bottom + 44),
        )
      }

      // Высота доски: самый низкий край карточки + место под хвостик.
      const bottom = rects.reduce((m, r) => Math.max(m, r.bottom), 0)
      const height = bottom + 56

      setCurve(segments.join(' '))
      setBoardHeight(height)
      setSize({ w: cRect.width, h: height })
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

  // Мозаика (путь3) — плотный поток в две колонки, замер эталона:
  // колонки по 156.5pt, жёлоб 10, вертикальный зазор ~12, сдвига нет.
  const gridColGap = 'gap-[10px]' // между колонками

  return (
    <div
      ref={containerRef}
      className="relative"
      // В виде «дорожка» карточки позиционируются абсолютно, поэтому высоту
      // контейнера задаём замером (иначе он схлопнется в ноль).
      style={isPath ? { height: boardHeight } : undefined}
    >
      {/* Точечная кривая-дорожка — под карточками (только вид «дорожка»). */}
      {isPath && curve && (
        // overflow-visible — дуги намеренно выходят за колонки, обрезать нельзя.
        <svg
          aria-hidden
          className="pointer-events-none absolute inset-0 z-0 overflow-visible"
          width={size.w}
          height={size.h}
          viewBox={'0 0 ' + size.w + ' ' + size.h}
          fill="none"
        >
          <path
            d={curve}
            className="path-trail stroke-foreground/70"
            strokeWidth={2.6}
            strokeLinecap="round"
          />
        </svg>
      )}

      {isPath ? (
        // «Дорожка»: позиция карточки задаётся ШАГОМ ЛЕСЕНКИ, а не потоком —
        // высота содержимого на неё не влияет. Из-за потока колонки разъезжались
        // (короткая голосовая в одной, высокое фото в другой), появлялись
        // провалы, и дуга местами упиралась в соседнюю карточку.
        entries.map((entry, i) => (
          <div
            key={entry.id}
            ref={(el) => {
              itemRefs.current[i] = el
            }}
            className="absolute z-10"
            style={{
              top: stepTop(i),
              // Колонки: ширина (100% − жёлоб)/2, правая начинается за жёлобом.
              left: i % 2 === 0 ? 0 : `calc(50% + ${GUTTER / 2}px)`,
              width: `calc(50% - ${GUTTER / 2}px)`,
            }}
          >
            {renderEntry(entry, i % 2 === 0 ? 'left' : 'right')}
          </div>
        ))
      ) : (
        // Мозаика: обычный поток в две колонки (колонки независимы → masonry).
        <div className={cn('relative z-10 flex items-start', gridColGap)}>
          <div className="flex min-w-0 flex-1 flex-col" style={{ gap: GRID_ROW_GAP }}>
            {columns.left.map((i) => (
              <div
                key={entries[i].id}
                ref={(el) => {
                  itemRefs.current[i] = el
                }}
              >
                {renderEntry(entries[i], 'left')}
              </div>
            ))}
          </div>
          <div className="flex min-w-0 flex-1 flex-col" style={{ gap: GRID_ROW_GAP }}>
            {columns.right.map((i) => (
              <div
                key={entries[i].id}
                ref={(el) => {
                  itemRefs.current[i] = el
                }}
              >
                {renderEntry(entries[i], 'right')}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
