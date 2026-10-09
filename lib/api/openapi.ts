import { z } from 'zod'

import { apiSchemas } from './schemas'

/**
 * OpenAPI 3.1 для BFF v1, собранный из zod-схем (lib/api/schemas.ts).
 *
 * Как устроено: поля запросов и ответов НЕ описываются здесь — они приходят
 * из тех же схем, которыми маршруты валидируют вход. Этот файл добавляет
 * только то, чего в схемах нет: какие пути и методы существуют, какие коды
 * ответа возможны, где нужна авторизация.
 *
 * Спецификация отдаётся сервером на GET /api/v1/openapi.json и лежит копией
 * в docs/openapi.json. Тест lib/api/openapi.test.ts падает, если копия
 * устарела или если маршрут в app/api/v1 есть, а в спецификации его нет.
 *
 * Модуль без Next и Supabase — только zod, чтобы собираться в тестах.
 */

// Ответы в OpenAPI 3.1 — это JSON Schema 2020-12, ровно тот формат, в который
// zod умеет переводить сам. io: 'input' — описываем то, что можно ПРИСЛАТЬ:
// для запросов это честнее (до trim и toLowerCase), а для нестрогих схем
// ответов не добавляет additionalProperties: false — клиент обязан терпеть
// новые поля (правило 3 контракта).
function componentSchemas(): Record<string, unknown> {
  const { schemas } = z.toJSONSchema(apiSchemas, {
    target: 'draft-2020-12',
    io: 'input',
    uri: (id) => `#/components/schemas/${id}`,
    override: ({ jsonSchema }) => stripNoise(jsonSchema as Record<string, unknown>),
  })
  // $schema и $id нужны самостоятельному JSON Schema, внутри OpenAPI —
  // лишний шум: диалект задан всем документом.
  return Object.fromEntries(
    Object.entries(schemas).map(([id, schema]) => {
      const clean: Record<string, unknown> = { ...schema }
      delete clean.$schema
      delete clean.$id
      return [id, clean]
    }),
  )
}

// Убираем то, что zod добавляет честно, но что только мешает читателю и
// генераторам клиентов:
//   - regex рядом со стандартным format: format однозначен, а многострочный
//     pattern для uuid или date-time генераторы переводят в громоздкий код;
//   - границы безопасного целого (±2^53−1) у z.number().int(): это не
//     ограничение контракта, а свойство JS.
const FORMATS_WITHOUT_PATTERN = new Set(['uuid', 'date-time', 'email'])

function stripNoise(schema: Record<string, unknown>) {
  if (typeof schema.format === 'string' && FORMATS_WITHOUT_PATTERN.has(schema.format)) {
    delete schema.pattern
  }
  if (schema.minimum === Number.MIN_SAFE_INTEGER) delete schema.minimum
  if (schema.maximum === Number.MAX_SAFE_INTEGER) delete schema.maximum
}

// ── Открытые перечисления в ответах ──────────────────────────────────────────
//
// swift-openapi-generator превращает `enum` в ЗАКРЫТЫЙ Swift-enum без запасного
// варианта. Добавили на сервере новый код ошибки — у всех установленных сборок
// перестаёт декодироваться любой ответ с ошибкой. Правило 1 контракта (новые
// значения enum внутри v1 можно) без этого не выполнить.
//
// Поэтому перечисления, до которых можно дойти из ОТВЕТА, публикуем как
// `type: string` со списком известных значений в x-enum-values и в описании.
// Сервер при этом валидирует строго, как и раньше: меняется только
// спецификация, не zod-схемы. Перечисления только из запросов остаются
// закрытыми — там новое значение вводит сервер, а старый клиент его просто не
// пришлёт.
//
// Какие схемы «из ответа», вычисляем обходом $ref от responses, а не флагом в
// схеме: флаг легко забыть на новом перечислении, обход — нет.

type Json = Record<string, unknown>

const SCHEMA_REF = /^#\/components\/schemas\/(.+)$/

function schemaRefs(node: unknown, found: Set<string> = new Set()): Set<string> {
  if (Array.isArray(node)) {
    node.forEach((item) => schemaRefs(item, found))
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      const match = key === '$ref' && typeof value === 'string' ? SCHEMA_REF.exec(value) : null
      if (match) found.add(match[1])
      else schemaRefs(value, found)
    }
  }
  return found
}

export function responseSchemaIds(paths: Json, responses: Json, schemas: Json): Set<string> {
  const roots = new Set<string>()
  for (const ops of Object.values(paths)) {
    for (const op of Object.values(ops as Json)) {
      schemaRefs((op as Json).responses, roots)
    }
  }
  schemaRefs(responses, roots)

  // Транзитивное замыкание: ErrorResponse → ApiErrorCode и дальше.
  const reachable = new Set<string>()
  const queue = [...roots]
  while (queue.length > 0) {
    const id = queue.pop()!
    if (reachable.has(id)) continue
    reachable.add(id)
    queue.push(...schemaRefs(schemas[id]))
  }
  return reachable
}

function openEnums(node: unknown): void {
  if (Array.isArray(node)) {
    node.forEach(openEnums)
    return
  }
  if (!node || typeof node !== 'object') return
  const schema = node as Json
  if (Array.isArray(schema.enum)) {
    const values = schema.enum as unknown[]
    const known = `Known values: ${values.join(', ')}. The list may grow within v1 — the client must survive an unknown value.`
    delete schema.enum
    schema.type = 'string'
    schema['x-enum-values'] = values
    schema.description = schema.description ? `${schema.description} ${known}` : known
  }
  Object.values(schema).forEach(openEnums)
}

const ref = (id: string) => ({ $ref: `#/components/schemas/${id}` })

const jsonBody = (id: string) => ({
  required: true,
  content: { 'application/json': { schema: ref(id) } },
})

const jsonResponse = (description: string, id: string) => ({
  description,
  content: { 'application/json': { schema: ref(id) } },
})

const sharedResponse = (name: string) => ({ $ref: `#/components/responses/${name}` })

// Повторяющиеся ответы. Смысл 401 и 503 — главное, что клиенту нельзя
// перепутать: на 401 обновляют токен, на 503 сессию НЕ трогают.
const sharedResponses = {
  InvalidInput: jsonResponse('The body failed validation. `field` points to the field.', 'ErrorResponse'),
  Unauthenticated: jsonResponse(
    'No token, or it expired or was not accepted. Call /auth/refresh and retry; if that also returns 401, sign in again.',
    'ErrorResponse',
  ),
  RateLimited: {
    ...jsonResponse('Too many requests. Wait as many seconds as Retry-After says.', 'ErrorResponse'),
    headers: {
      'Retry-After': { description: 'Seconds until the next attempt.', schema: { type: 'integer' } },
    },
  },
  ServiceUnavailable: jsonResponse(
    'The BFF is alive but could not reach the storage. The token may still be valid, so do NOT reset the session; retry with increasing delay.',
    'ErrorResponse',
  ),
  NotFound: jsonResponse('No such record.', 'ErrorResponse'),
  Internal: jsonResponse('Server error. It does not mean the record does not exist.', 'ErrorResponse'),
}

const bearer = [{ bearerAuth: [] }]
// Явное «без авторизации». Пустое умолчание генераторы клиентов трактуют
// по-разному, поэтому публичные эндпоинты помечены прямо.
const publicAccess: never[] = []

export function buildOpenApiDocument() {
  const doc = {
    openapi: '3.1.0',
    info: {
      title: 'Numia BFF',
      version: '1.0.0',
      description:
        'Contract between the iOS app and the BFF. Versioning rules, the sign-in model and the encryption boundary are described in docs/api-v1.md. Fields come from the zod schemas in lib/api/schemas.ts.',
    },
    servers: [{ url: '/api/v1', description: 'Relative to the BFF host' }],
    tags: [
      { name: 'system', description: 'Service endpoints' },
      { name: 'auth', description: 'Sign-in with an emailed code' },
      { name: 'profile', description: 'User profile' },
      { name: 'e2e', description: 'E2E key material. The server sees no secrets.' },
    ],
    paths: {
      '/health': {
        get: {
          tags: ['system'],
          summary: 'Liveness check',
          operationId: 'getHealth',
          security: publicAccess,
          responses: { '200': jsonResponse('The service is alive.', 'HealthResponse') },
        },
      },
      '/openapi.json': {
        get: {
          tags: ['system'],
          summary: 'This specification',
          operationId: 'getOpenApi',
          security: publicAccess,
          responses: {
            '200': {
              description: 'OpenAPI 3.1 document.',
              content: { 'application/json': { schema: { type: 'object' } } },
            },
          },
        },
      },
      '/auth/otp': {
        post: {
          tags: ['auth'],
          summary: 'Send a code by email',
          description:
            'For a new address an account is created along the way. Always responds 204, whether the account exists or not; otherwise the response would reveal who uses the app. A 429 shortly after the previous request means the code has already been sent.',
          operationId: 'sendOtp',
          security: publicAccess,
          requestBody: jsonBody('OtpRequest'),
          responses: {
            '204': { description: 'Code sent (or the address does not exist; we do not distinguish).' },
            '400': sharedResponse('InvalidInput'),
            '429': sharedResponse('RateLimited'),
            '503': sharedResponse('ServiceUnavailable'),
          },
        },
      },
      '/auth/verify': {
        post: {
          tags: ['auth'],
          summary: 'Exchange the code for tokens',
          operationId: 'verifyOtp',
          security: publicAccess,
          requestBody: jsonBody('VerifyRequest'),
          responses: {
            '200': jsonResponse('Tokens.', 'TokenResponse'),
            '400': jsonResponse(
              'invalid_input — the body failed validation; invalid_code — the code is wrong or expired (we do not distinguish).',
              'ErrorResponse',
            ),
            '429': sharedResponse('RateLimited'),
            '503': sharedResponse('ServiceUnavailable'),
          },
        },
      },
      '/auth/refresh': {
        post: {
          tags: ['auth'],
          summary: 'New token pair',
          description:
            'Every exchange issues a new refresh_token — store it. There is one refresh for the whole app: parallel requests that got 401 wait for its result.',
          operationId: 'refreshTokens',
          security: publicAccess,
          requestBody: jsonBody('RefreshRequest'),
          responses: {
            '200': jsonResponse('New tokens.', 'TokenResponse'),
            '400': sharedResponse('InvalidInput'),
            '401': jsonResponse('The session has ended — sign in again.', 'ErrorResponse'),
            '429': sharedResponse('RateLimited'),
            '503': sharedResponse('ServiceUnavailable'),
          },
        },
      },
      '/auth/logout': {
        post: {
          tags: ['auth'],
          summary: 'Sign out on this device',
          description:
            'Always 204, including for an invalid token. The access token lives until it expires, so the client erases both tokens at once.',
          operationId: 'logout',
          security: bearer,
          responses: {
            '204': { description: 'Signed out.' },
            '401': sharedResponse('Unauthenticated'),
            '503': sharedResponse('ServiceUnavailable'),
          },
        },
      },
      '/me': {
        get: {
          tags: ['profile'],
          summary: 'Profile',
          operationId: 'getProfile',
          security: bearer,
          responses: {
            '200': jsonResponse('Profile of the current user.', 'ProfileResponse'),
            '401': sharedResponse('Unauthenticated'),
            '404': sharedResponse('NotFound'),
            '503': sharedResponse('ServiceUnavailable'),
          },
        },
        patch: {
          tags: ['profile'],
          summary: 'Update profile',
          operationId: 'updateProfile',
          security: bearer,
          requestBody: jsonBody('ProfilePatchRequest'),
          responses: {
            '200': jsonResponse('Updated profile.', 'ProfileResponse'),
            '400': sharedResponse('InvalidInput'),
            '401': sharedResponse('Unauthenticated'),
            '404': sharedResponse('NotFound'),
            '503': sharedResponse('ServiceUnavailable'),
          },
        },
        delete: {
          tags: ['profile'],
          summary: 'Delete account',
          description:
            'Deletes the account, all data and files, and signs out all devices. Irreversible. There is no repeated code check. Idempotent: after a failure, a retry cleans up the rest. If the 204 response was lost, a retry returns 401 — the account is already gone; the client erases the tokens and local data the same way as after 204.',
          operationId: 'deleteAccount',
          security: bearer,
          responses: {
            '204': { description: 'Account deleted.' },
            '401': sharedResponse('Unauthenticated'),
            '500': sharedResponse('Internal'),
            '503': jsonResponse(
              'Storage unavailable. The account is not deleted, some files may already be deleted — retry later.',
              'ErrorResponse',
            ),
          },
        },
      },
      '/e2e/recovery': {
        get: {
          tags: ['e2e'],
          summary: 'Recovery anchor',
          description:
            '404 — there is no anchor, a new DEK may be created. Any read failure is 500 or 503, never 404: on a false 404 the client would generate a new DEK and lose data.',
          operationId: 'getRecoveryAnchor',
          security: bearer,
          responses: {
            '200': jsonResponse('Anchor.', 'RecoveryAnchorResponse'),
            '401': sharedResponse('Unauthenticated'),
            '404': jsonResponse('No anchor.', 'ErrorResponse'),
            '500': sharedResponse('Internal'),
            '503': sharedResponse('ServiceUnavailable'),
          },
        },
        put: {
          tags: ['e2e'],
          summary: 'Create or change the recovery anchor',
          description:
            'Conditional write. expected_anchor_version: 0 — create only if there is no anchor; N — replace only if the current version is N. The check and the write are atomic in the DB. Repeating the same body is safe: if the anchor is already exactly the same, the response is 200 with the current version.',
          operationId: 'putRecoveryAnchor',
          security: bearer,
          requestBody: jsonBody('RecoveryAnchorPutRequest'),
          responses: {
            '200': jsonResponse('Written. anchor_version is the new version.', 'RecoveryAnchorResponse'),
            '400': sharedResponse('InvalidInput'),
            '401': sharedResponse('Unauthenticated'),
            '409': jsonResponse(
              'Version mismatch: the anchor was created or changed from another device in the meantime. Nothing was written. Re-read with GET and go to recovery by phrase.',
              'ErrorResponse',
            ),
            '500': sharedResponse('Internal'),
            '503': sharedResponse('ServiceUnavailable'),
          },
        },
      },
    },
    components: {
      schemas: componentSchemas(),
      responses: sharedResponses,
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'access_token from /auth/verify or /auth/refresh. Opaque.',
        },
      },
    },
  }

  const { schemas } = doc.components
  for (const id of responseSchemaIds(doc.paths, doc.components.responses, schemas)) {
    openEnums(schemas[id])
  }
  return doc
}
