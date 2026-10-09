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
    description: 'Stable error code. The client branches on it, not on message.',
  })

export const ErrorResponseSchema = z
  .object({
    error: z.object({
      code: ApiErrorCodeSchema,
      message: z
        .string()
        .optional()
        .describe('For logs and debugging. Do not show to the user.'),
      field: z.string().optional().describe('The field that failed validation.'),
    }),
  })
  .register(apiSchemas, { id: 'ErrorResponse', description: 'Unified error envelope.' })

// ── Служебное ────────────────────────────────────────────────────────────────

export const HealthResponseSchema = z
  .object({
    status: z.literal('ok'),
    api: z.literal('v1'),
    version: z.string().describe('Build revision of the image.'),
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
    code: z.string().regex(/^\d{6}$/, 'code must be 6 digits').describe('6 digits from the email.'),
  })
  .strict()
  .register(apiSchemas, { id: 'VerifyRequest' })

export const RefreshRequestSchema = z
  .object({ refresh_token: z.string().min(1).max(4096) })
  .strict()
  .register(apiSchemas, { id: 'RefreshRequest' })

export const TokenResponseSchema = z
  .object({
    access_token: z.string().describe('Opaque string. The client does not decode it.'),
    refresh_token: z
      .string()
      .describe('Opaque string. Store the new one after every exchange.'),
    expires_in: z.number().int().describe('Lifetime of access_token in seconds.'),
    token_type: z.literal('bearer'),
  })
  .register(apiSchemas, {
    id: 'TokenResponse',
    description:
      'Tokens are opaque: the client does not parse the JWT or read fields from it. user_id comes only from GET /me.',
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
  .describe('ISO 8601, UTC, with Z, no fractional seconds: 2026-09-15T11:09:46Z.')

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
  .describe('IANA time zone name, e.g. Europe/Madrid.')

export const ProfileResponseSchema = z
  .object({
    user_id: z.uuid(),
    timezone: z.string().describe('IANA name. In the clear: the server uses it to compute slots and send reminders.'),
    profile_ciphertext: z
      .string()
      .nullable()
      .describe('E2E blob with the name and form of address, base64(iv ‖ ct). The server does not read it.'),
    e2e: z.object({
      has_recovery_anchor: z
        .boolean()
        .describe('Whether the server holds a wrap of the key under the recovery phrase.'),
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
    description: 'Any non-empty subset of the fields.',
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
      .describe('base64(iv ‖ ciphertext ‖ tag): the DEK wrapped with the key derived from the recovery phrase.'),
    recovery_salt: z.string().describe('base64, the PBKDF2 salt for deriving the key from the phrase.'),
    recovery_kdf_iterations: z
      .number()
      .int()
      .nullable()
      .describe('PBKDF2 iterations. null means a legacy anchor with 210 000. Take it from the response, not from a constant.'),
    anchor_version: z
      .number()
      .int()
      .min(1)
      .describe('Current anchor version. Passed as expected_anchor_version when changing the phrase.'),
  })
  .register(apiSchemas, {
    id: 'RecoveryAnchorResponse',
    description: 'Server-side recovery anchor. It holds no secrets: neither the phrase nor the DEK reaches the server.',
  })

export const RecoveryAnchorPutRequestSchema = z
  .object({
    dek_wrapped_recovery: base64Bytes(WRAPPED_DEK_BYTES).describe(
      'base64(iv 12 ‖ ciphertext 32 ‖ tag 16) — exactly 60 bytes.',
    ),
    recovery_salt: base64Bytes(RECOVERY_SALT_BYTES).describe('base64, exactly 16 bytes.'),
    recovery_kdf_iterations: z.number().int().min(MIN_KDF_ITERATIONS).max(MAX_KDF_ITERATIONS),
    expected_anchor_version: z
      .number()
      .int()
      .min(0)
      .describe('0 — create only if there is no anchor. N — replace only if the current version is N.'),
  })
  .strict()
  .register(apiSchemas, {
    id: 'RecoveryAnchorPutRequest',
    description: 'Conditional anchor write. Version mismatch — 409, nothing is written.',
  })

export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>
export type HealthResponse = z.infer<typeof HealthResponseSchema>
export type TokenResponse = z.infer<typeof TokenResponseSchema>
export type ProfileResponse = z.infer<typeof ProfileResponseSchema>
export type RecoveryAnchorResponse = z.infer<typeof RecoveryAnchorResponseSchema>
