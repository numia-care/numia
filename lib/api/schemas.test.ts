import { describe, expect, it } from 'vitest'

import { EmailSchema, toApiTimestamp } from './schemas'

describe('toApiTimestamp', () => {
  it('приводит ответ Postgres к ISO 8601 UTC без дробных секунд', () => {
    // Ровно так created_at приходит из Supabase.
    expect(toApiTimestamp('2026-09-15T11:09:46.89996+00:00')).toBe('2026-09-15T11:09:46Z')
  })

  it('переводит смещение в UTC', () => {
    expect(toApiTimestamp('2026-09-15T14:09:46.5+03:00')).toBe('2026-09-15T11:09:46Z')
  })

  it('не трогает значение, уже подходящее под контракт', () => {
    expect(toApiTimestamp('2026-09-15T11:09:46Z')).toBe('2026-09-15T11:09:46Z')
  })
})

describe('EmailSchema', () => {
  it('чистит пробелы и регистр до проверки формата', () => {
    expect(EmailSchema.parse('  Tester@Example.COM ')).toBe('tester@example.com')
  })

  it('отклоняет не-email', () => {
    expect(EmailSchema.safeParse('not-an-email').success).toBe(false)
  })
})
