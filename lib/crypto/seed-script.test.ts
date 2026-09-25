/**
 * Крипта скрипта сидирования против настоящей.
 *
 * `scripts/seed-staging.mjs` считает якорь своими тридцатью строками: он должен
 * запускаться голым `node`, а envelope.ts импортирует соседний модуль без
 * расширения. Дубль констант там помечен, но пометка ничего не гарантирует —
 * гарантирует этот файл. Разойдутся — здесь станет красно, а не у человека,
 * который однажды не сможет восстановить доступ засеянной учёткой.
 */

import { describe, expect, it } from 'vitest'

import {
  deriveKek as scriptDeriveKek,
  makeAnchor,
  open as scriptOpen,
  seal as scriptSeal,
} from '../../scripts/seed-staging.mjs'
import { deriveKek, generateDek, unwrapDekRaw, wrapDek } from './envelope'
import { base64ToBytes, KDF_ITERATIONS } from './pin'
import { normalizeRecoveryPhrase } from './recovery'

const SECRET = 'twelve words pretending to be a phrase'

describe('скрипт сидирования и envelope.ts', () => {
  it('разворачивает envelope.ts то, что завернул скрипт', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const dataKey = crypto.getRandomValues(new Uint8Array(32))

    const wrapped = await scriptSeal(await scriptDeriveKek(SECRET, salt), dataKey)
    const unwrapped = await unwrapDekRaw(await deriveKek(SECRET, salt), wrapped)

    expect(new Uint8Array(unwrapped)).toEqual(dataKey)
  })

  it('и наоборот — скрипт открывает то, что завернул envelope.ts', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const dek = await generateDek()

    const wrapped = await wrapDek(await deriveKek(SECRET, salt), dek.raw)
    const opened = await scriptOpen(await scriptDeriveKek(SECRET, salt), wrapped)

    expect(opened).toEqual(dek.raw)
  })

  it('якорь из скрипта открывается своей фразой и имеет форму, которую принимает BFF', async () => {
    const anchor = await makeAnchor()

    // docs/api-v1.md, §12: обёртка ровно 60 байт (IV 12 + DEK 32 + тег 16),
    // соль 16, итерации не ниже текущих.
    expect(base64ToBytes(anchor.row.dek_wrapped_recovery).length).toBe(60)
    expect(base64ToBytes(anchor.row.recovery_salt).length).toBe(16)
    expect(anchor.row.recovery_kdf_iterations).toBe(KDF_ITERATIONS)

    const kek = await deriveKek(
      normalizeRecoveryPhrase(anchor.phrase),
      base64ToBytes(anchor.row.recovery_salt),
      anchor.row.recovery_kdf_iterations,
    )
    const dataKey = await unwrapDekRaw(kek, anchor.row.dek_wrapped_recovery)

    expect(dataKey.length).toBe(32)
  })
})
