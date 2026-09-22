import { describe, expect, it } from 'vitest'

import { DOCS_CSP, apiDocsEnabled, docsHtml, docsInitScript } from './docs'

describe('страница Swagger UI', () => {
  it('выключена, пока API_DOCS не равен ровно "true"', () => {
    expect(apiDocsEnabled({})).toBe(false)
    expect(apiDocsEnabled({ API_DOCS: 'false' })).toBe(false)
    expect(apiDocsEnabled({ API_DOCS: '1' })).toBe(false)
    expect(apiDocsEnabled({ API_DOCS: 'true' })).toBe(true)
  })

  it('HTML не грузит ничего со сторонних адресов и не содержит инлайн-скриптов', () => {
    const html = docsHtml()
    expect(html).not.toMatch(/https?:\/\//)
    // Каждый <script> — только с src.
    expect(html.match(/<script(?![^>]*\bsrc=)[^>]*>/g)).toBeNull()
  })

  it('CSP не пускает скрипты и запросы с чужих адресов', () => {
    expect(DOCS_CSP).toContain("script-src 'self'")
    expect(DOCS_CSP).toContain("connect-src 'self'")
    expect(DOCS_CSP).not.toMatch(/https?:|\*/)
    expect(DOCS_CSP).not.toMatch(/script-src[^;]*unsafe-inline/)
  })

  it('Swagger UI не сохраняет токен и не ходит во внешний валидатор', () => {
    const init = docsInitScript()
    expect(init).toContain('persistAuthorization: false')
    expect(init).toContain('validatorUrl: null')
    expect(init).toContain('"/api/v1/openapi.json"')
  })
})
