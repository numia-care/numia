/**
 * Утилиты таймзоны юзера — клиентская часть.
 * Server action для сохранения tz в profiles — в lib/timezone-actions.ts.
 *
 * Зачем: трекеру ЗГТ нужна tz юзера, чтобы wall-clock расписание
 * («09:00 каждый день») корректно конвертилось в UTC при генерации слотов.
 * Без этого юзер уехал в другой часовой пояс — и таблетка «в 9 утра»
 * напомнит ему в 4 утра по местному. Это тот класс багов которого мы
 * специально избегаем для этой аудитории (одна пропущенная доза = плохо).
 */

/**
 * Определить IANA-имя таймзоны юзера в браузере.
 * 'Europe/Madrid', 'America/Los_Angeles', и т.п.
 *
 * Должна вызываться ТОЛЬКО на клиенте. Server Components на Vercel
 * живут в UTC и вернули бы 'UTC' для всех — то есть бесполезно.
 *
 * Fallback 'UTC': современные браузеры (включая старые WebView в iOS 13+)
 * всегда возвращают валидный timeZone. Эта ветка — для совсем экзотики.
 */
export function detectUserTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    return tz || 'UTC'
  } catch {
    return 'UTC'
  }
}

/**
 * Проверка что строка — валидное IANA tz имя.
 * Intl.DateTimeFormat бросает RangeError для невалидных tz.
 *
 * Используется и на клиенте (перед отправкой), и на сервере (в action
 * перед записью). Дублирующая валидация специально: клиент не доверенный.
 */
export function isValidIanaTimezone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 100) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}
