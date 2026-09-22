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
    const known = `Известные значения: ${values.join(', ')}. Список может пополняться внутри v1 — незнакомое значение клиент обязан переживать.`
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
  InvalidInput: jsonResponse('Тело не прошло валидацию. `field` указывает на поле.', 'ErrorResponse'),
  Unauthenticated: jsonResponse(
    'Токена нет, он протух или не принят. Вызвать /auth/refresh и повторить; если и он вернул 401 — войти заново.',
    'ErrorResponse',
  ),
  RateLimited: {
    ...jsonResponse('Слишком часто. Ждать столько секунд, сколько в Retry-After.', 'ErrorResponse'),
    headers: {
      'Retry-After': { description: 'Секунды до следующей попытки.', schema: { type: 'integer' } },
    },
  },
  ServiceUnavailable: jsonResponse(
    'BFF жив, но не достучался до хранилища. Токен при этом может быть валиден — сессию НЕ сбрасывать, повторить с нарастающей задержкой.',
    'ErrorResponse',
  ),
  NotFound: jsonResponse('Записи нет.', 'ErrorResponse'),
  Internal: jsonResponse('Ошибка сервера. Не означает, что записи нет.', 'ErrorResponse'),
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
        'Контракт между iOS-приложением и BFF. Правила версионирования, модель входа и граница шифрования описаны в docs/api-v1.md. Поля — из zod-схем в lib/api/schemas.ts.',
    },
    servers: [{ url: '/api/v1', description: 'Относительно хоста BFF' }],
    tags: [
      { name: 'system', description: 'Служебное' },
      { name: 'auth', description: 'Вход по коду из письма' },
      { name: 'profile', description: 'Профиль пользователя' },
      { name: 'e2e', description: 'Материал ключей E2E. Секретов сервер не видит.' },
    ],
    paths: {
      '/health': {
        get: {
          tags: ['system'],
          summary: 'Проверка живости',
          operationId: 'getHealth',
          security: publicAccess,
          responses: { '200': jsonResponse('Сервис жив.', 'HealthResponse') },
        },
      },
      '/openapi.json': {
        get: {
          tags: ['system'],
          summary: 'Эта спецификация',
          operationId: 'getOpenApi',
          security: publicAccess,
          responses: {
            '200': {
              description: 'OpenAPI 3.1 документ.',
              content: { 'application/json': { schema: { type: 'object' } } },
            },
          },
        },
      },
      '/auth/otp': {
        post: {
          tags: ['auth'],
          summary: 'Отправить код на почту',
          description:
            'Для нового адреса заодно создаётся аккаунт. Отвечает 204 всегда, существует аккаунт или нет, — иначе по ответу можно было бы проверять, кто пользуется приложением. 429 вскоре после прошлого запроса — код уже отправлен.',
          operationId: 'sendOtp',
          security: publicAccess,
          requestBody: jsonBody('OtpRequest'),
          responses: {
            '204': { description: 'Код отправлен (или адрес не существует — не различаем).' },
            '400': sharedResponse('InvalidInput'),
            '429': sharedResponse('RateLimited'),
            '503': sharedResponse('ServiceUnavailable'),
          },
        },
      },
      '/auth/verify': {
        post: {
          tags: ['auth'],
          summary: 'Обменять код на токены',
          operationId: 'verifyOtp',
          security: publicAccess,
          requestBody: jsonBody('VerifyRequest'),
          responses: {
            '200': jsonResponse('Токены.', 'TokenResponse'),
            '400': jsonResponse(
              'invalid_input — тело не прошло валидацию; invalid_code — код неверный или просрочен (не различаем).',
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
          summary: 'Новая пара токенов',
          description:
            'Каждый обмен выдаёт новый refresh_token — сохранять его. Обновление одно на всё приложение: параллельные запросы, получившие 401, ждут его результата.',
          operationId: 'refreshTokens',
          security: publicAccess,
          requestBody: jsonBody('RefreshRequest'),
          responses: {
            '200': jsonResponse('Новые токены.', 'TokenResponse'),
            '400': sharedResponse('InvalidInput'),
            '401': jsonResponse('Сессия кончилась — войти заново.', 'ErrorResponse'),
            '429': sharedResponse('RateLimited'),
            '503': sharedResponse('ServiceUnavailable'),
          },
        },
      },
      '/auth/logout': {
        post: {
          tags: ['auth'],
          summary: 'Выйти на этом устройстве',
          description:
            'Всегда 204, в том числе на недействительный токен. Access-токен доживает до своего срока — клиент стирает оба токена сразу.',
          operationId: 'logout',
          security: bearer,
          responses: {
            '204': { description: 'Вышли.' },
            '401': sharedResponse('Unauthenticated'),
            '503': sharedResponse('ServiceUnavailable'),
          },
        },
      },
      '/me': {
        get: {
          tags: ['profile'],
          summary: 'Профиль',
          operationId: 'getProfile',
          security: bearer,
          responses: {
            '200': jsonResponse('Профиль текущего пользователя.', 'ProfileResponse'),
            '401': sharedResponse('Unauthenticated'),
            '404': sharedResponse('NotFound'),
            '503': sharedResponse('ServiceUnavailable'),
          },
        },
        patch: {
          tags: ['profile'],
          summary: 'Изменить профиль',
          operationId: 'updateProfile',
          security: bearer,
          requestBody: jsonBody('ProfilePatchRequest'),
          responses: {
            '200': jsonResponse('Обновлённый профиль.', 'ProfileResponse'),
            '400': sharedResponse('InvalidInput'),
            '401': sharedResponse('Unauthenticated'),
            '404': sharedResponse('NotFound'),
            '503': sharedResponse('ServiceUnavailable'),
          },
        },
        delete: {
          tags: ['profile'],
          summary: 'Удалить аккаунт',
          description:
            'Удаляет аккаунт, все данные и файлы, разлогинивает все устройства. Необратимо. Повторной проверки кода нет. Идемпотентно: после сбоя повтор дочищает остатки. Если ответ 204 потерялся, повтор вернёт 401 — аккаунта уже нет, клиент стирает токены и локальные данные так же, как после 204.',
          operationId: 'deleteAccount',
          security: bearer,
          responses: {
            '204': { description: 'Аккаунт удалён.' },
            '401': sharedResponse('Unauthenticated'),
            '500': sharedResponse('Internal'),
            '503': jsonResponse(
              'Хранилище недоступно. Аккаунт не удалён, часть файлов могла удалиться — повторить позже.',
              'ErrorResponse',
            ),
          },
        },
      },
      '/e2e/recovery': {
        get: {
          tags: ['e2e'],
          summary: 'Якорь восстановления',
          description:
            '404 — якоря нет, можно создавать новый DEK. Любой сбой чтения — 500 или 503, никогда не 404: на ложный 404 клиент сгенерировал бы новый DEK и потерял данные.',
          operationId: 'getRecoveryAnchor',
          security: bearer,
          responses: {
            '200': jsonResponse('Якорь.', 'RecoveryAnchorResponse'),
            '401': sharedResponse('Unauthenticated'),
            '404': jsonResponse('Якоря нет.', 'ErrorResponse'),
            '500': sharedResponse('Internal'),
            '503': sharedResponse('ServiceUnavailable'),
          },
        },
        put: {
          tags: ['e2e'],
          summary: 'Создать или сменить якорь восстановления',
          description:
            'Условная запись. expected_anchor_version: 0 — создать, только если якоря нет; N — заменить, только если текущая версия N. Проверка и запись атомарны в БД. Повтор того же тела безопасен: если якорь уже ровно такой, ответ 200 с текущей версией.',
          operationId: 'putRecoveryAnchor',
          security: bearer,
          requestBody: jsonBody('RecoveryAnchorPutRequest'),
          responses: {
            '200': jsonResponse('Записано. anchor_version — новая версия.', 'RecoveryAnchorResponse'),
            '400': sharedResponse('InvalidInput'),
            '401': sharedResponse('Unauthenticated'),
            '409': jsonResponse(
              'Версия не совпала: якорь успели создать или сменить с другого устройства. Ничего не записано. Перечитать GET и перейти к восстановлению по фразе.',
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
          description: 'access_token из /auth/verify или /auth/refresh. Непрозрачен.',
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
