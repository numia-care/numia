import { getRequestConfig } from 'next-intl/server'

/**
 * Конфигурация next-intl для Server Components.
 *
 * Пока единственная локаль — 'ru'. Когда добавим английский:
 *   1. Создать messages/en.json
 *   2. Тут определять локаль из cookie/header/URL
 *   3. В proxy.ts (middleware) — negotiation + redirect
 *
 * messages загружаются динамически через import() — это даёт code-splitting
 * по локалям из коробки (en.json не попадёт в бандл пока не используется).
 */
export default getRequestConfig(async () => {
  const locale = 'ru'

  return {
    locale,
    messages: (await import(`@/messages/${locale}.json`)).default,
  }
})
