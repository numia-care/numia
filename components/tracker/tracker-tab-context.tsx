'use client'

import { createContext, useCallback, useContext, useMemo, useState } from 'react'

import { DEFAULT_TAB, type TabKey } from '@/lib/tracker/tab-key'

/**
 * Активная вкладка экрана «Препараты» — общее состояние для двух мест,
 * которые в DOM стоят далеко друг от друга.
 *
 * Зачем контекст, а не useState внутри TrackerTabs (как было раньше):
 * круглый «+» живёт в СТРОКЕ ЗАГОЛОВКА, а пилюли вкладок — ниже, внутри
 * Suspense-границы. «Плюсу» нужно знать активную вкладку, чтобы вести на
 * добавление анализа с «Анализов» и препарата — с остальных.
 *
 * Почему не поднять всё в один компонент: заголовок стоит СНАРУЖИ Suspense
 * нарочно — он рисуется мгновенно, не дожидаясь запросов к БД. Затащить его
 * внутрь значило бы вернуть мигание заголовка при каждом заходе. Провайдер
 * оборачивает и заголовок, и Suspense, а серверные потомки проезжают сквозь
 * него как children — состояние общее, серверный рендер не страдает.
 *
 * ?tab= — МЯГКИЙ параметр, и это важное различие. Он читается ТОЛЬКО при
 * инициализации провайдера (сервер отдаёт его в initial), чтобы можно было
 * вернуться на нужную вкладку после формы анализа. Клики по вкладкам
 * по-прежнему идут через setTab: локально, мгновенно, БЕЗ навигации и похода
 * на сервер. Именно навигация-на-каждый-клик была причиной отказаться от
 * ?tab= раньше, и она здесь не появляется.
 *
 * URL при клике подправляется через history.replaceState — чтобы адрес не
 * врал (зашли по ?tab=analyses, ткнули «Сегодня» — в адресе всё ещё analyses).
 * replaceState, а не pushState: переключение вкладки не должно засорять
 * историю и ломать кнопку «назад». Next поддерживает это официально и
 * синхронизирует с роутером (docs: 02-guides/single-page-applications,
 * «Shallow routing on the client»).
 *
 * TabKey, TAB_KEYS, DEFAULT_TAB и parseTabKey переехали в
 * lib/tracker/tab-key.ts — модуль БЕЗ 'use client'. Причина там же в шапке:
 * серверная страница /tracker вызывает parseTabKey при рендере, а экспорт
 * клиентского модуля вызвать с сервера нельзя — он подменяется заглушкой,
 * которая бросает.
 */

interface TrackerTabValue {
  tab: TabKey
  setTab: (tab: TabKey) => void
}

const TrackerTabContext = createContext<TrackerTabValue | null>(null)

export function TrackerTabProvider({
  children,
  initial = DEFAULT_TAB,
}: {
  children: React.ReactNode
  initial?: TabKey
}) {
  const [tab, setTabState] = useState<TabKey>(initial)

  const setTab = useCallback((next: TabKey) => {
    setTabState(next)

    // Подправляем адрес, не навигируя. window.location, а не useSearchParams:
    // читаем только в момент клика, в браузере — и не тащим в компонент
    // требование Suspense-границы, которое useSearchParams накладывает.
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    // У дефолтной вкладки параметр убираем, чтобы /tracker оставался чистым.
    if (next === DEFAULT_TAB) params.delete('tab')
    else params.set('tab', next)
    const qs = params.toString()
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname)
  }, [])

  // Мемо, чтобы смена НЕ-состояния родителя не перерисовывала потребителей.
  // setTab стабилен благодаря useCallback, поэтому в зависимостях только tab.
  const value = useMemo(() => ({ tab, setTab }), [tab, setTab])

  return (
    <TrackerTabContext.Provider value={value}>
      {children}
    </TrackerTabContext.Provider>
  )
}

export function useTrackerTab(): TrackerTabValue {
  const ctx = useContext(TrackerTabContext)
  if (!ctx) {
    throw new Error('useTrackerTab вызван вне TrackerTabProvider')
  }
  return ctx
}
