import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildOpenApiDocument, responseSchemaIds } from './openapi'

/**
 * Страховка от расхождения спецификации с кодом.
 *
 * 1. docs/openapi.json — копия того, что отдаёт сервер. Поменял схему или
 *    маршрут и забыл обновить копию — тест падает. Обновить:
 *      pnpm test -u
 * 2. Каждый маршрут в app/api/v1 описан в спецификации, и наоборот. Иначе
 *    легко добавить эндпоинт, которого iOS никогда не увидит.
 */

const doc = buildOpenApiDocument()
const API_ROOT = join(__dirname, '..', '..', 'app', 'api', 'v1')
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return routeFiles(full)
    return entry.name === 'route.ts' ? [full] : []
  })
}

// Какие HTTP-методы экспортирует route.ts: `export const GET` или
// `export async function GET`.
function exportedMethods(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  return METHODS.filter((m) =>
    new RegExp(`export\\s+(const|async\\s+function|function)\\s+${m}\\b`).test(source),
  )
}

function routePath(file: string): string {
  const segments = relative(API_ROOT, file).split(sep).slice(0, -1)
  return '/' + segments.join('/')
}

describe('OpenAPI', () => {
  it('docs/openapi.json совпадает с тем, что собирается из кода', async () => {
    await expect(JSON.stringify(doc, null, 2) + '\n').toMatchFileSnapshot(
      '../../docs/openapi.json',
    )
  })

  it('каждый маршрут app/api/v1 описан в спецификации', () => {
    const missing = routeFiles(API_ROOT).flatMap((file) =>
      exportedMethods(file)
        .filter((m) => !(doc.paths as Record<string, Record<string, unknown>>)[routePath(file)]?.[m.toLowerCase()])
        .map((m) => `${m} ${routePath(file)}`),
    )
    expect(missing).toEqual([])
  })

  it('в спецификации нет путей без маршрута', () => {
    const existing = new Set(
      routeFiles(API_ROOT).flatMap((file) =>
        exportedMethods(file).map((m) => `${m.toLowerCase()} ${routePath(file)}`),
      ),
    )
    const phantom = Object.entries(doc.paths).flatMap(([path, ops]) =>
      Object.keys(ops)
        .map((method) => `${method} ${path}`)
        .filter((key) => !existing.has(key)),
    )
    expect(phantom).toEqual([])
  })

  it('email в запросах описан с форматом, а не голой строкой', () => {
    const otp = doc.components.schemas.OtpRequest as {
      properties: { email: Record<string, unknown> }
    }
    expect(otp.properties.email).toMatchObject({ type: 'string', format: 'email', maxLength: 320 })
  })

  it('в схемах ответов нет закрытых enum', () => {
    const schemas = doc.components.schemas as Record<string, unknown>
    const ids = responseSchemaIds(doc.paths, doc.components.responses, schemas)
    const closed = [...ids].filter((id) => JSON.stringify(schemas[id]).includes('"enum"'))
    expect(ids.has('ApiErrorCode')).toBe(true)
    expect(closed).toEqual([])
  })

  it('коды ошибок публикуются строкой со списком известных значений', () => {
    expect(doc.components.schemas.ApiErrorCode).toMatchObject({
      type: 'string',
      'x-enum-values': expect.arrayContaining(['invalid_input', 'service_unavailable']),
    })
  })

  it('все ссылки на схемы ведут на существующие схемы', () => {
    const refs = [...JSON.stringify(doc).matchAll(/#\/components\/schemas\/([A-Za-z]+)/g)].map(
      (m) => m[1],
    )
    const defined = Object.keys(doc.components.schemas)
    expect(refs.filter((id) => !defined.includes(id))).toEqual([])
  })
})
