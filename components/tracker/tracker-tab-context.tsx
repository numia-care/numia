'use client'

import { createContext, useContext, useMemo, useState } from 'react'

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
 * Почему не ?tab= в URL: панели всех вкладок отрисованы сервером заранее и
 * переключаются мгновенно на клиенте. Через URL каждое переключение стало бы
 * навигацией с походом на сервер — заметно медленнее без выигрыша.
 */

export type TabKey = 'today' | 'all' | 'analyses' | 'history'

interface TrackerTabValue {
  tab: TabKey
  setTab: (tab: TabKey) => void
}

const TrackerTabContext = createContext<TrackerTabValue | null>(null)

export function TrackerTabProvider({
  children,
  initial = 'today',
}: {
  children: React.ReactNode
  initial?: TabKey
}) {
  const [tab, setTab] = useState<TabKey>(initial)
  // Мемо, чтобы смена НЕ-состояния родителя не перерисовывала потребителей.
  const value = useMemo(() => ({ tab, setTab }), [tab])

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
