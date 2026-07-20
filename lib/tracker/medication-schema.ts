import { z } from 'zod'

import { ScheduleSchema } from './schedule'

/**
 * Schema для входа в createMedication / updateMedication.
 *
 * Живёт в отдельном файле (а не в medications.ts) потому что:
 *   - medications.ts помечен 'use server' → все его экспорты становятся
 *     server actions. Импорт Zod-схемы оттуда в client component
 *     приведёт к попытке сериализовать сложный объект через RSC и упадёт.
 *   - Эту схему хотим переиспользовать в client form для синхронной
 *     валидации до отправки (UX-ради) — поэтому она должна быть
 *     чистым модулем без рантайм-побочек.
 *
 * Поля БД, которые сюда НЕ входят: id, user_id, end_date, deleted_at,
 * created_at — выставляются сервером.
 */
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

export const MedicationInputSchema = z.object({
  name: z.string().trim().min(1, 'нужно название').max(100),
  kind: z.enum([
    'estrogen',
    'antiandrogen',
    'progesterone',
    'testosterone',
    'other',
  ]),
  form: z.enum([
    'tablet',
    'capsule',
    'injection',
    'gel',
    'patch',
    'drops',
    'spray',
    'other',
  ]),
  // coerce: HTML number input может вернуть строку — на сервере и на клиенте
  // одинаково приводим к number перед валидацией.
  dose_amount: z.coerce
    .number({ message: 'число' })
    .positive('больше нуля')
    .finite(),
  dose_unit: z.enum(['mg', 'mcg', 'ml', 'iu', 'drop', 'puff', 'tablet']),
  schedule: ScheduleSchema,
  start_date: z.string().regex(DATE_REGEX, 'формат YYYY-MM-DD'),
  // Без .transform() — иначе z.input != z.output, и RHF resolver двоит
  // дженерики, ломая typing FormField. Пустую строку → null обрабатываем
  // в createMedication перед инсертом.
  notes: z.string().trim().max(2000).optional(),
})

export type MedicationInput = z.infer<typeof MedicationInputSchema>
