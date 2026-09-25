// Сброс и наполнение стейджинга тестовыми данными.
//
//   node scripts/seed-staging.mjs --yes
//
// Зачем: тестовые учётки разъезжаются по состояниям, и чинить их руками SQL-ом
// — как это пришлось делать 2026-09-25 — занятие на каждый раз. Скрипт
// приводит все четыре к известному состоянию и печатает фразы восстановления,
// которые нужно положить в Configs/TestAccounts.xcconfig в numia-ios.
//
// ── Что он НЕ делает и почему ──
//
// Не ходит под service_role. Тот обходит RLS целиком, и ключ, которым можно
// почистить одну учётку, читает базу всех остальных (см. lib/supabase/bff.ts).
// Вместо этого скрипт входит в каждую учётку по паролю и работает её же
// правами — ровно как приложение. Политики Postgres режут строки сами.
//
// Не удаляет аккаунт. delete_my_account() снёс бы и саму строку auth.users,
// а учётки должны пережить сброс: их адреса и пароль зашиты в сборку.
//
// ── Крипта ──
//
// Якорь считается здесь, а не берётся из lib/crypto/envelope.ts: тот импортирует
// соседний модуль без расширения, и голый node такое не резолвит. Три константы
// ниже продублированы оттуда, и чтобы дубль не разошёлся с оригиналом,
// seed-staging.test.ts заворачивает ключ одним кодом и разворачивает другим.
// Разойдутся — упадёт тест, а не восстановление у человека.

import { createClient } from '@supabase/supabase-js'
import { generateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'

// Из lib/crypto/envelope.ts и lib/crypto/pin.ts. Менять только вместе с ними.
const KEK_INFO = 'numia-kek-v1'
const KDF_ITERATIONS = 600_000
const IV_BYTES = 12
const SALT_BYTES = 16
const PHRASE_STRENGTH_BITS = 128

const encoder = new TextEncoder()

export function randomBytes(count) {
  return crypto.getRandomValues(new Uint8Array(count))
}

export function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString('base64')
}

export function base64ToBytes(value) {
  return new Uint8Array(Buffer.from(value, 'base64'))
}

/** PBKDF2 над «секрет + тег назначения», как в envelope.ts. */
export async function deriveKek(secret, salt, iterations = KDF_ITERATIONS) {
  const base = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret + KEK_INFO),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** base64(iv ‖ ciphertext) — самодостаточная строка, IV внутри. */
export async function seal(key, plaintext) {
  const iv = randomBytes(IV_BYTES)
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext),
  )
  const packed = new Uint8Array(iv.length + ciphertext.length)
  packed.set(iv, 0)
  packed.set(ciphertext, iv.length)
  return bytesToBase64(packed)
}

export async function open(key, packed) {
  const bytes = base64ToBytes(packed)
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.slice(0, IV_BYTES) },
    key,
    bytes.slice(IV_BYTES),
  )
  return new Uint8Array(plaintext)
}

/** Случайный DEK плюс якорь под новой фразой. Фразу возвращаем — её показать. */
export async function makeAnchor() {
  const phrase = generateMnemonic(wordlist, PHRASE_STRENGTH_BITS)
  const dataKey = randomBytes(32)
  const salt = randomBytes(SALT_BYTES)
  const kek = await deriveKek(phrase, salt)
  return {
    phrase,
    dataKey: await crypto.subtle.importKey('raw', dataKey, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']),
    row: {
      dek_wrapped_recovery: await seal(kek, dataKey),
      recovery_salt: bytesToBase64(salt),
      recovery_kdf_iterations: KDF_ITERATIONS,
    },
  }
}

// ── Учётки и то, чем они отличаются ─────────────────────────────────────────

const ACCOUNTS = [
  { email: 'numia.fresh@example.com', state: 'empty' },
  { email: 'numia.tracker@example.com', state: 'tracker' },
  { email: 'numia.path@example.com', state: 'path' },
  { email: 'numia.anchor@example.com', state: 'anchor' },
]

// Порядок важен: дети раньше родителей, иначе внешний ключ не даст удалить.
const OWNED_TABLES = [
  'intake_events',
  'medications',
  'lab_results',
  'lab_sessions',
  'lab_ranges',
  'path_entries',
  'push_subscriptions',
]

const MEDIA_BUCKET = 'path-media'
const DAY_MS = 86_400_000

function requireEnv(name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`не задано ${name}`)
  }
  return value
}

function isoDaysAgo(days, hours = 0, minutes = 0) {
  const date = new Date(Date.now() - days * DAY_MS)
  date.setUTCHours(hours, minutes, 0, 0)
  return date.toISOString()
}

/** Всё, что принадлежит этой учётке, кроме самой учётки. */
async function reset(db, uid) {
  for (const table of OWNED_TABLES) {
    const { error } = await db.from(table).delete().eq('user_id', uid)
    if (error) {
      throw new Error(`${table}: ${error.message}`)
    }
  }

  // Storage не каскадится с auth.users и не удаляется SQL-ом — только через API,
  // и только токеном владельца. См. миграцию 20260915130000_delete_my_account.
  const { data: files } = await db.storage.from(MEDIA_BUCKET).list(uid)
  if (files?.length) {
    await db.storage.from(MEDIA_BUCKET).remove(files.map((file) => `${uid}/${file.name}`))
  }

  const { error } = await db
    .from('profiles')
    .update({ dek_wrapped_recovery: null, recovery_salt: null, recovery_kdf_iterations: null })
    .eq('id', uid)
  if (error) {
    throw new Error(`profiles: ${error.message}`)
  }
}

async function seedTracker(db, uid) {
  const started = isoDaysAgo(30).slice(0, 10)
  const { data: medications, error } = await db
    .from('medications')
    .insert([
      {
        user_id: uid,
        name: 'Эстрадиола валерат',
        kind: 'estrogen',
        form: 'tablet',
        dose_amount: 2,
        dose_unit: 'mg',
        schedule: { kind: 'daily', times: ['09:00', '21:00'] },
        start_date: started,
      },
      {
        user_id: uid,
        name: 'Ципротерона ацетат',
        kind: 'antiandrogen',
        form: 'tablet',
        dose_amount: 10,
        dose_unit: 'mg',
        schedule: { kind: 'daily', times: ['09:00'] },
        start_date: started,
      },
      {
        user_id: uid,
        name: 'Эстрадиола валерат, инъекции',
        kind: 'estrogen',
        form: 'injection',
        dose_amount: 5,
        dose_unit: 'mg',
        schedule: { kind: 'interval', every_days: 7, time: '10:00', anchor_date: started },
        start_date: started,
      },
    ])
    .select('id')
  if (error) {
    throw new Error(`medications: ${error.message}`)
  }

  // Неделя истории по первому препарату: в основном принято, один пропуск и один
  // слот впереди — чтобы на экране было что показать во всех трёх состояниях.
  const daily = medications[0].id
  const events = []
  for (let day = 7; day >= 1; day -= 1) {
    for (const [hour, minute] of [[9, 0], [21, 0]]) {
      const scheduled = isoDaysAgo(day, hour, minute)
      const missed = day === 3 && hour === 21
      events.push({
        user_id: uid,
        medication_id: daily,
        scheduled_at: scheduled,
        taken_at: missed ? null : scheduled,
        status: missed ? 'missed' : 'taken',
        dose_actual: missed ? null : 2,
      })
    }
  }
  events.push({
    user_id: uid,
    medication_id: daily,
    scheduled_at: isoDaysAgo(-1, 9, 0),
    taken_at: null,
    status: 'upcoming',
  })

  const { error: eventsError } = await db.from('intake_events').insert(events)
  if (eventsError) {
    throw new Error(`intake_events: ${eventsError.message}`)
  }
  return events.length + medications.length
}

/**
 * Записи «Пути» под тем же DEK, что лежит в якоре, — иначе приложение их
 * откроет якорем, а расшифровать не сможет.
 *
 * Фото и голос не засеваются: они живут файлами в Storage, и это отдельная
 * пачка работы ради данных, которые на экране всё равно блоб.
 */
async function seedPath(db, uid, dataKey) {
  const text = (value) => seal(dataKey, encoder.encode(value))
  const rows = [
    {
      user_id: uid,
      entry_type: 'diary',
      occurred_at: isoDaysAgo(12, 20, 30),
      mood: 4,
      note_ciphertext: await text('Спокойный день. Врач сказал, что анализы в норме.'),
    },
    {
      user_id: uid,
      entry_type: 'diary',
      occurred_at: isoDaysAgo(6, 22, 10),
      mood: 2,
      note_ciphertext: await text('Тяжело. Но завтра будет легче.'),
    },
    {
      user_id: uid,
      entry_type: 'note',
      occurred_at: isoDaysAgo(3, 12, 0),
      encrypted_content: await text(JSON.stringify({ caption: 'Заметка для следующего приёма' })),
    },
    {
      user_id: uid,
      entry_type: 'milestone',
      occurred_at: isoDaysAgo(1, 10, 0),
      encrypted_content: await text(JSON.stringify({ caption: 'Полгода' })),
    },
  ]

  const { error } = await db.from('path_entries').insert(rows)
  if (error) {
    throw new Error(`path_entries: ${error.message}`)
  }
  return rows.length
}

async function main() {
  if (!process.argv.includes('--yes')) {
    console.error('Перезаписывает данные тестовых учёток. Запускать с --yes.')
    process.exitCode = 1
    return
  }

  const url = requireEnv('SUPABASE_URL')
  const key = requireEnv('SUPABASE_PUBLISHABLE_KEY')
  const password = requireEnv('TEST_ACCOUNT_PASSWORD')
  console.log(`Проект: ${url}\n`)

  const phrases = []
  for (const account of ACCOUNTS) {
    const db = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    const { data, error } = await db.auth.signInWithPassword({ email: account.email, password })
    if (error) {
      throw new Error(`${account.email}: не удалось войти — ${error.message}`)
    }
    const uid = data.user.id

    await reset(db, uid)
    let seeded = 0

    if (account.state === 'tracker') {
      seeded = await seedTracker(db, uid)
    }

    if (account.state === 'path' || account.state === 'anchor') {
      const anchor = await makeAnchor()
      const { error: anchorError } = await db.from('profiles').update(anchor.row).eq('id', uid)
      if (anchorError) {
        throw new Error(`${account.email}: якорь не записался — ${anchorError.message}`)
      }
      phrases.push({ email: account.email, phrase: anchor.phrase })
      if (account.state === 'path') {
        seeded = await seedPath(db, uid, anchor.dataKey)
      }
    }

    console.log(`${account.email.padEnd(28)} ${account.state.padEnd(8)} строк: ${seeded}`)
  }

  if (phrases.length) {
    console.log('\nФразы восстановления. В numia-ios, Configs/TestAccounts.xcconfig:\n')
    for (const { email, phrase } of phrases) {
      const slot = email.split('@')[0].split('.')[1].toUpperCase()
      console.log(`TEST_ACCOUNTS_PHRASE_${slot} = ${phrase}`)
    }
    console.log('\nПоказаны один раз — переписать сейчас. Иначе только прогонять скрипт заново.')
  }
}

// Не при импорте: seed-staging.test.ts берёт отсюда только крипту.
if (process.argv[1]?.includes('seed-staging')) {
  await main()
}
