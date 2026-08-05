// Ключ активной вкладки экрана «Препараты» и разбор ?tab= из URL.
//
// БЕЗ 'use client' — и это главное, ради чего файл существует отдельно.
// Раньше всё это жило в components/tracker/tracker-tab-context.tsx, у которого
// в первой строке 'use client'. Серверная страница /tracker импортировала
// оттуда parseTabKey и вызывала её при рендере — и падала на каждом запросе.
//
// Причина в том, как Next собирает клиентские модули: загрузчик подменяет
// КАЖДЫЙ не-дефолтный экспорт 'use client'-файла заглушкой через
// registerClientReference, тело которой сразу бросает «Attempted to call
// parseTabKey() from the server but parseTabKey is on the client»
// (next/dist/build/webpack/loaders/next-flight-loader). Типы бы уцелели —
// они стираются на компиляции, — а функция нет.
//
// Ни typecheck, ни линт, ни сборка этого не ловят: типы корректны, правила
// такого нет, а /tracker динамический и на сборке не пререндерится, так что
// код там ни разу не выполняется. Ловится только запросом к странице.
//
// Модуль нейтральный: его импортируют и клиентский контекст, и серверная
// страница. Логика не менялась — только переехала.

export type TabKey = 'today' | 'all' | 'analyses' | 'history'

export const TAB_KEYS: readonly TabKey[] = ['today', 'all', 'analyses', 'history']

/** Вкладка по умолчанию — она же «параметра в URL нет». */
export const DEFAULT_TAB: TabKey = 'today'

/**
 * ?tab=... → TabKey. Мусор и отсутствие параметра дают undefined, вызывающий
 * подставит дефолт.
 */
export function parseTabKey(value: string | undefined): TabKey | undefined {
  return TAB_KEYS.includes(value as TabKey) ? (value as TabKey) : undefined
}
