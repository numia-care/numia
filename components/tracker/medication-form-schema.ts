import type { z } from 'zod'

import type { MedicationInputSchema } from '@/lib/tracker/medication-schema'

/**
 * Тип значений формы добавления/редактирования препарата.
 *
 * z.input — это shape ДО трансформаций (notes как string | undefined,
 * dose_amount как number | string — coerce примет любое). Это то, что
 * react-hook-form хранит в defaultValues и в полях.
 *
 * z.output (= z.infer) — после трансформаций (notes как string | null) —
 * используется на сервере после safeParse. Здесь нам нужен именно input.
 *
 * Тип-only импорт из @/lib/tracker/medication-schema не тащит Zod-схему
 * в client bundle (хотя сама медиатор-схема в client всё равно нужна
 * через zodResolver — это пробрасывается в medication-form.tsx).
 */
export type MedicationFormValues = z.input<typeof MedicationInputSchema>
