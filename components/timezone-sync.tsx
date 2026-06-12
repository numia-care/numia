'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'

import { detectUserTimezone } from '@/lib/timezone'
import { syncUserTimezone } from '@/lib/timezone-actions'

/**
 * Невидимый компонент в (app) layout — на маунте детектит tz браузера
 * через Intl и сверяет с profiles.timezone. Если разные — апдейтит.
 *
 * Зачем: profiles.timezone дефолтится в 'UTC' при signup, и без этого
 * шага слоты расписания считаются в UTC → отображаются в неправильный
 * день в Сегодня.
 *
 * useRef-флаг — защита от двойного срабатывания (React strict mode
 * рендерит эффекты дважды в dev).
 */
export function TimezoneSync() {
  const router = useRouter()
  const synced = useRef(false)

  useEffect(() => {
    if (synced.current) return
    synced.current = true

    const tz = detectUserTimezone()
    syncUserTimezone(tz).then((result) => {
      // Если tz изменилась — перерисовать страницу: слоты надо пересчитать,
      // секция Сегодня могла стать пустой/полной.
      if (result.changed) router.refresh()
    })
  }, [router])

  return null
}
