import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

// Раннер для тестов в lib/: чистые функции и маршруты BFF. React и DOM здесь
// не нужны. Маршруты BFF тестируются вызовом их обработчиков напрямую —
// Supabase в модульных тестах подменяется, в интеграционных
// (*.integration.test.ts, запуск: NUMIA_INTEGRATION=1 pnpm test) — настоящий
// локальный стек.
//
// Конфиг Next не читает и в сборку не тянет: `next build` про этот файл не знает.
export default defineConfig({
  resolve: {
    // Тот же алиас, что в tsconfig.json: маршруты импортируют '@/lib/...'.
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    environment: 'node',
    // Узко и явно: только тесты в lib/. Дефолтный шаблон vitest сканирует весь
    // проект, а на диске рядом лежит негитовая папка «скрины дизайна» — в неё
    // раннеру ходить незачем.
    include: ['lib/**/*.test.ts'],
  },
})
