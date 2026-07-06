'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'

import { createClient } from '@/lib/supabase/client'

// Вечерний мягкий заход на дневник: после 19:00 локального, если сегодня ещё
// нет записи дневника — тонкая строчка под приветствием «Как прошёл день? ✦».
// НЕ пуш и НЕ модалка — просто строчка; тап открывает /path/new сразу на
// вкладке дневника. Утром/днём не показывается вовсе.
//
// Лёгкий: одна head-count-выборка (метаданные, mood/entry_type открыты — E2E
// не трогаем), и только вечером.

const EVENING_HOUR = 19

export function EveningNudge() {
  const t = useTranslations('dashboard')
  const [show, setShow] = useState(false)

  useEffect(() => {
    // Время проверяем на клиенте — локальное для юзера (сервер в UTC).
    if (new Date().getHours() < EVENING_HOUR) return

    let cancelled = false
    async function check() {
      try {
        const supabase = createClient()
        const startOfDay = new Date()
        startOfDay.setHours(0, 0, 0, 0)
        // Есть ли сегодня запись дневника (по occurred_at — дате события).
        const { count } = await supabase
          .from('path_entries')
          .select('id', { count: 'exact', head: true })
          .eq('entry_type', 'diary')
          .gte('occurred_at', startOfDay.toISOString())
        if (!cancelled && (count ?? 0) === 0) setShow(true)
      } catch {
        // Некритично — просто не показываем.
      }
    }
    check()
    return () => {
      cancelled = true
    }
  }, [])

  if (!show) return null

  return (
    <Link
      href="/path/new?mode=diary"
      className="inline-block text-sm text-muted-foreground underline-offset-4 transition-colors animate-in fade-in duration-700 hover:text-foreground hover:underline"
    >
      {t('eveningNudge')}
    </Link>
  )
}
