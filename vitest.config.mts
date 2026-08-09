import { defineConfig } from 'vitest/config'

// Раннер для чистых функций в lib/. Ни Next, ни React, ни DOM здесь не нужны:
// тестируемый граф (stats.ts → catalog.ts) не импортирует ничего внешнего —
// ни Supabase, ни переменных окружения, ни window.
//
// Конфиг Next не читает и в сборку не тянет: `next build` про этот файл не знает.
export default defineConfig({
  test: {
    environment: 'node',
    // Узко и явно: только тесты в lib/. Дефолтный шаблон vitest сканирует весь
    // проект, а на диске рядом лежит негитовая папка «скрины дизайна» — в неё
    // раннеру ходить незачем.
    include: ['lib/**/*.test.ts'],
  },
})
