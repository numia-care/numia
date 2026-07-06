'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'

import { getCryptoKey } from '@/lib/crypto/session'
import { listEntries, type PathEntry } from '@/lib/path/entries'
import { PathPreviewItem } from './path-preview-item'

// Ретроспектива на дашборде: «Месяц назад в твоём пути ✦» / «Год назад ✦».
// Тёплая механика памяти: если в «Пути» есть запись около месяца назад
// (окно ±3 дня) — показываем её превью; годовщина (любая: 1 год, 2 года…)
// приоритетнее месяца. Нет попаданий — карточки нет вообще (null, без
// пустых заглушек). Тап — в «Путь».
//
// Лёгкая: один запрос метаданных (listEntries), расшифровка превью — ленивая
// внутри PathPreviewItem, как везде.

const WINDOW_MS = 3 * 86_400_000 // ±3 дня

type Hit = { entry: PathEntry; kind: 'month' | 'year' }

// «k месяцев/лет назад» через календарные единицы (не 30*86400с): setMonth
// сам корректно переносит месяцы разной длины.
function monthsAgo(now: Date, k: number): number {
  const d = new Date(now)
  d.setMonth(d.getMonth() - k)
  return d.getTime()
}

export function findRetro(entries: PathEntry[], now: Date): Hit | null {
  if (entries.length === 0) return null

  // Самая старая запись ограничивает, сколько годовщин имеет смысл проверять.
  const oldest = Math.min(...entries.map((e) => new Date(e.occurredAt).getTime()))

  // Годовщины: 1, 2, 3… лет назад, пока не старше самой старой записи.
  // Приоритет над месяцем — «Год назад» ценнее.
  for (let years = 1; monthsAgo(now, years * 12) + WINDOW_MS >= oldest; years++) {
    const target = monthsAgo(now, years * 12)
    const hit = closestWithin(entries, target)
    if (hit) return { entry: hit, kind: 'year' }
  }

  const monthHit = closestWithin(entries, monthsAgo(now, 1))
  return monthHit ? { entry: monthHit, kind: 'month' } : null
}

// Ближайшая к целевой дате запись в пределах окна, иначе null.
function closestWithin(entries: PathEntry[], target: number): PathEntry | null {
  let best: PathEntry | null = null
  let bestDist = Infinity
  for (const e of entries) {
    const dist = Math.abs(new Date(e.occurredAt).getTime() - target)
    if (dist <= WINDOW_MS && dist < bestDist) {
      best = e
      bestDist = dist
    }
  }
  return best
}

export function RetroCard() {
  const t = useTranslations('dashboard')
  const [hit, setHit] = useState<Hit | null>(null)

  useEffect(() => {
    let cancelled = false
    async function run() {
      try {
        // Нечем расшифровать превью → не показываем (карточка — чистая радость,
        // просить PIN ради неё неуместно).
        if (!getCryptoKey()) return
        const entries = await listEntries()
        if (!cancelled) setHit(findRetro(entries, new Date()))
      } catch {
        // Ретроспектива некритична — молча пропускаем.
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [])

  // Нет попадания — нет карточки (null не оставляет пустого места в space-y).
  if (!hit) return null

  return (
    <Link
      href="/path"
      className="block rounded-2xl bg-card p-5 ring-1 ring-border transition-colors animate-in fade-in slide-in-from-bottom-3 duration-500 hover:ring-sage/50"
    >
      <h2 className="font-heading text-lg text-foreground">
        {hit.kind === 'year' ? t('retroYear') : t('retroMonth')}
      </h2>
      <div className="mt-3">
        <PathPreviewItem entry={hit.entry} />
      </div>
    </Link>
  )
}
