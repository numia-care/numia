import { z } from 'zod'

/**
 * Схемы контракта BFF v1 — ЕДИНСТВЕННЫЙ источник правды о полях запросов и
 * ответов.
 *
 * Из этих же схем:
 *   - маршруты валидируют входящие запросы (parseJsonBody);
 *   - собирается OpenAPI-спецификация (lib/api/openapi.ts).
 *
 * Поэтому спецификация не может разойтись с тем, что сервер реально
 * принимает: поменял схему здесь — поменялось и то, и другое. Рукописный
 * yaml рядом разошёлся бы с кодом на первой же правке.
 *
 * Модуль намеренно без Next и Supabase — только zod. Его импортирует и
 * рантайм маршрутов, и генератор спецификации в тестах.
 *
 * Реестр apiSchemas: всё, что в него зарегистрировано с id, попадает в
 * components.schemas спецификации отдельной именованной схемой. Остальное
 * встраивается по месту.
 *
 * Про ответы: схемы ответов НЕ строгие (без .strict()). Правило 3 контракта —
 * клиент обязан терпеть незнакомые поля, а сервер вправе добавлять новые
 * внутри v1. Строгие только схемы запросов: незнакомое поле во входе — ошибка.
 */

export interface ApiSchemaMeta {
  id: string
  description?: string
}

export const apiSchemas = z.registry<ApiSchemaMeta>()

// ── Ошибки ───────────────────────────────────────────────────────────────────

export const ApiErrorCodeSchema = z
  .enum([
    'invalid_input',
    'invalid_code',
    'unauthenticated',
    'forbidden',
    'not_found',
    'conflict',
    'unprocessable',
    'rate_limited',
    'internal',
    'service_unavailable',
  ])
  .register(apiSchemas, {
    id: 'ApiErrorCode',
    description: 'Стабильный код ошибки. Клиент ветвится по нему, а не по message.',
  })

export const ErrorResponseSchema = z
  .object({
    error: z.object({
      code: ApiErrorCodeSchema,
      message: z
        .string()
        .optional()
        .describe('Для логов и отладки. Пользователю не показывать.'),
      field: z.string().optional().describe('Поле, не прошедшее валидацию.'),
    }),
  })
  .register(apiSchemas, { id: 'ErrorResponse', description: 'Единый конверт ошибки.' })

// ── Служебное ────────────────────────────────────────────────────────────────

export const HealthResponseSchema = z
  .object({
    status: z.literal('ok'),
    api: z.literal('v1'),
    version: z.string().describe('Ревизия сборки образа.'),
  })
  .register(apiSchemas, { id: 'HealthResponse' })

// ── Вход ─────────────────────────────────────────────────────────────────────

// Нормализуем как Supabase: регистр в email не значим. Без этого
// «A@x.com» и «a@x.com» считались бы разными субъектами лимита.
//
// .meta() — только для спецификации. Схема сначала чистит строку и лишь потом
// проверяет формат, а в OpenAPI попадает первый шаг — голый string. Формат
// и длину, которые реально проверяются во втором шаге, указываем явно.
export const EmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(320))
  .meta({ format: 'email', maxLength: 320 })

export const OtpRequestSchema = z
  .object({ email: EmailSchema })
  .strict()
  .register(apiSchemas, { id: 'OtpRequest' })

export const VerifyRequestSchema = z
  .object({
    email: EmailSchema,
    code: z.string().regex(/^\d{6}$/, 'code must be 6 digits').describe('6 цифр из письма.'),
  })
  .strict()
  .register(apiSchemas, { id: 'VerifyRequest' })

export const RefreshRequestSchema = z
  .object({ refresh_token: z.string().min(1).max(4096) })
  .strict()
  .register(apiSchemas, { id: 'RefreshRequest' })

export const TokenResponseSchema = z
  .object({
    access_token: z.string().describe('Непрозрачная строка. Клиент не декодирует.'),
    refresh_token: z
      .string()
      .describe('Непрозрачная строка. После каждого обмена сохранять новую.'),
    expires_in: z.number().int().describe('Срок жизни access_token в секундах.'),
    token_type: z.literal('bearer'),
  })
  .register(apiSchemas, {
    id: 'TokenResponse',
    description:
      'Токены непрозрачны: клиент не разбирает JWT и не читает из него поля. user_id — только из GET /me.',
  })

// ── Время ────────────────────────────────────────────────────────────────────

/**
 * Момент времени в ответах: ISO 8601, UTC, с `Z`, БЕЗ дробных секунд —
 * `2026-09-15T11:09:46Z`. Так обещает контракт (docs/api-v1.md, §4).
 *
 * Почему без дробной части. Postgres отдаёт `…46.89996+00:00`, а стандартный
 * разбор ISO 8601 в Swift (и swift-openapi-generator по умолчанию) дробные
 * секунды не принимает — декодирование ответа на iOS падает целиком.
 * Миллисекунды в датах создания записей никому не нужны.
 */
export function toApiTimestamp(value: string): string {
  return new Date(value).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export const TimestampSchema = z.iso
  .datetime()
  .describe('ISO 8601, UTC, с Z, без дробных секунд: 2026-09-15T11:09:46Z.')

// ── Профиль ──────────────────────────────────────────────────────────────────

// IANA-имя таймзоны проверяем самим Intl: держать свой список нельзя, он
// устаревает с каждым релизом базы часовых поясов.
export const TimezoneSchema = z
  .string()
  .refine(
    (tz) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz })
        return true
      } catch {
        return false
      }
    },
    { message: 'unknown IANA timezone' },
  )
  .describe('IANA-имя таймзоны, например Europe/Madrid.')

export const ProfileResponseSchema = z
  .object({
    user_id: z.uuid(),
    timezone: z.string().describe('IANA-имя. Открыто: по нему сервер считает слоты и шлёт напоминания.'),
    profile_ciphertext: z
      .string()
      .nullable()
      .describe('E2E-блоб с именем и формой обращения, base64(iv ‖ ct). Сервер не читает.'),
    e2e: z.object({
      has_recovery_anchor: z
        .boolean()
        .describe('Есть ли на сервере обёртка ключа под фразу восстановления.'),
    }),
    created_at: TimestampSchema,
  })
  .register(apiSchemas, { id: 'ProfileResponse' })

// Шифроблоб для нас непрозрачен — проверяем только границы, чтобы в базу не
// улетел мусор произвольного размера. Расшифровать всё равно не можем.
export const ProfilePatchRequestSchema = z
  .object({
    timezone: TimezoneSchema.optional(),
    profile_ciphertext: z.string().max(8192).nullable().optional(),
  })
  .strict()
  .register(apiSchemas, {
    id: 'ProfilePatchRequest',
    description: 'Любое непустое подмножество полей.',
  })

// ── E2E: якорь восстановления ────────────────────────────────────────────────

/**
 * Стандартный base64 с паддингом, ровно `bytes` байт после декодирования.
 *
 * Проверяем обратным кодированием: строка должна совпасть с каноническим
 * base64 своих же байт. Это отсекает URL-safe алфавит, пропущенный паддинг,
 * пробелы и «хвостовые» биты, которые Buffer молча проглотил бы.
 */
export function base64Bytes(bytes: number) {
  const length = 4 * Math.ceil(bytes / 3)
  return z
    .string()
    .length(length, `must be base64 of exactly ${bytes} bytes`)
    .refine(
      (value) => {
        const decoded = Buffer.from(value, 'base64')
        return decoded.length === bytes && decoded.toString('base64') === value
      },
      { message: `must be base64 of exactly ${bytes} bytes` },
    )
    // Только длина. contentEncoding: base64 не ставим: swift-openapi-generator
    // сделал бы поле запроса типом Base64EncodedData, а то же поле в ответе
    // осталось бы String.
    .meta({ minLength: length, maxLength: length })
}

// Формат из lib/crypto/envelope.ts (wrapDek): base64(iv ‖ ciphertext), где
// iv — 12 байт, ciphertext — 32 байта DEK и 16 байт тега GCM в хвосте.
const WRAPPED_DEK_BYTES = 12 + 32 + 16
// lib/crypto/pin.ts, generateSalt.
const RECOVERY_SALT_BYTES = 16
// lib/crypto/pin.ts: KDF_ITERATIONS. Новые якоря на legacy 210 000 не принимаем.
// Верхняя граница — чтобы клиент не записал якорь, который потом минуты
// разворачивается на слабом телефоне.
const MIN_KDF_ITERATIONS = 600_000
const MAX_KDF_ITERATIONS = 10_000_000

export const RecoveryAnchorResponseSchema = z
  .object({
    dek_wrapped_recovery: z
      .string()
      .describe('base64(iv ‖ ciphertext ‖ tag): DEK, обёрнутый ключом из фразы восстановления.'),
    recovery_salt: z.string().describe('base64, соль PBKDF2 для вывода ключа из фразы.'),
    recovery_kdf_iterations: z
      .number()
      .int()
      .nullable()
      .describe('Итерации PBKDF2. null — исторический якорь на 210 000. Брать из ответа, не из константы.'),
    anchor_version: z
      .number()
      .int()
      .min(1)
      .describe('Текущая версия якоря. Передаётся в expected_anchor_version при смене фразы.'),
  })
  .register(apiSchemas, {
    id: 'RecoveryAnchorResponse',
    description: 'Серверный якорь восстановления. Секретов в нём нет: фраза и DEK на сервер не приходят.',
  })

export const RecoveryAnchorPutRequestSchema = z
  .object({
    dek_wrapped_recovery: base64Bytes(WRAPPED_DEK_BYTES).describe(
      'base64(iv 12 ‖ ciphertext 32 ‖ tag 16) — ровно 60 байт.',
    ),
    recovery_salt: base64Bytes(RECOVERY_SALT_BYTES).describe('base64, ровно 16 байт.'),
    recovery_kdf_iterations: z.number().int().min(MIN_KDF_ITERATIONS).max(MAX_KDF_ITERATIONS),
    expected_anchor_version: z
      .number()
      .int()
      .min(0)
      .describe('0 — создать, только если якоря нет. N — заменить, только если текущая версия N.'),
  })
  .strict()
  .register(apiSchemas, {
    id: 'RecoveryAnchorPutRequest',
    description: 'Условная запись якоря. Не совпала версия — 409, ничего не записано.',
  })

export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>
export type HealthResponse = z.infer<typeof HealthResponseSchema>
export type TokenResponse = z.infer<typeof TokenResponseSchema>
export type ProfileResponse = z.infer<typeof ProfileResponseSchema>
export type RecoveryAnchorResponse = z.infer<typeof RecoveryAnchorResponseSchema>
