// E2E-пайплайн «Пути»: сжать → зашифровать → загрузить → записать, и обратно.
//
// Граница шифрования (CLAUDE.md, раздел «Путь»):
//   • КОНТЕНТ (файл фото, подпись) — E2E через DEK из PIN-сессии. Сервер не
//     читает: в Storage лежит шифроблоб, в encrypted_content — шифротекст.
//   • МЕТАДАННЫЕ (entry_type, occurred_at, id) — открыты, нужны серверу чтобы
//     построить ленту без расшифровки.
//
// Только клиент: нужен DEK в памяти сессии (session.ts), браузерный Supabase,
// Web Crypto и canvas. Импортируется из 'use client' компонентов.

import { getCryptoKey } from '@/lib/crypto/session'
import {
  decryptBytes,
  decryptText,
  encryptBytes,
  encryptText,
} from '@/lib/crypto/envelope'
import { base64ToBytes, bytesToBase64 } from '@/lib/crypto/pin'
import { createClient } from '@/lib/supabase/client'
import { compressImage } from './compress'

const BUCKET = 'path-media'

/**
 * Бросается, когда DEK нет в памяти (PIN-сессия истекла / новое открытие
 * приложения). UI должен это поймать и попросить ввести PIN, затем повторить.
 */
export class PinRequiredError extends Error {
  constructor() {
    super('pin_required')
    this.name = 'PinRequiredError'
  }
}

// DEK из сессии или PinRequiredError. Все крипто-операции идут через него —
// один источник правды «разблокированы ли мы».
function requireDek(): CryptoKey {
  const dek = getCryptoKey()
  if (!dek) throw new PinRequiredError()
  return dek
}

// ── Типы ────────────────────────────────────────────────────────────────────

export type PathEntryType =
  | 'photo'
  | 'voice'
  | 'note'
  | 'diary'
  | 'lab_result'
  | 'milestone'

// Ряд ленты — только МЕТАДАННЫЕ (расшифровки тут нет, она ленивая, см. ниже).
// mood — исключение: он ОТКРЫТ (не шифруется), поэтому едет прямо в метаданных
// ленты, без отдельной расшифровки. Текст заметки (note_ciphertext) — шифрован,
// расшифровывается лениво, как caption у фото.
export interface PathEntry {
  id: string
  entryType: PathEntryType
  occurredAt: string // ISO timestamptz
  mediaPath: string | null
  mediaIv: string | null // base64 IV для расшифровки файла
  encryptedContent: string | null
  mood: number | null // 1–5, открыто (дневник)
  noteCiphertext: string | null // E2E-текст заметки дневника
  createdAt: string
}

export interface NewPhoto {
  file: File
  occurredAt: Date
  caption?: string
}

export interface NewVoice {
  blob: Blob
  occurredAt: Date
  caption?: string
}

// Запись дневника: настроение (1–5) и/или текст. Оба опциональны по отдельности,
// но addDiaryEntry требует хотя бы одно (та же инварианта, что в CHECK миграции).
export type MoodLevel = 1 | 2 | 3 | 4 | 5

export interface NewDiary {
  mood?: MoodLevel
  note?: string
  occurredAt: Date
}

// Форма расшифрованного encrypted_content. Объект (а не голая строка), чтобы
// будущие типы записей клали свои поля, не ломая старые.
interface EntryContent {
  caption?: string
}

// ── Запись: общий пайплайн ────────────────────────────────────────────────────

/**
 * Общий E2E-пайплайн для любого медиа-типа:
 *   зашифровать байты DEK'ом (новый IV на файл) → загрузить шифроблоб в Storage
 *   → записать метаданные в path_entries. Возвращает id новой записи.
 *
 * Фото и голос отличаются только подготовкой байт (сжатие vs готовый mp4) и
 * entry_type — всё остальное (шифрование, аплоад, запись) общее.
 *
 * Атомарности на два хранилища (Storage + таблица) нет, поэтому при провале
 * вставки чистим уже загруженный блоб, чтобы не копить осиротевшие файлы.
 */
async function saveEntry(params: {
  entryType: PathEntryType
  bytes: Uint8Array
  occurredAt: Date
  caption?: string
}): Promise<string> {
  const dek = requireDek()
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('not_authenticated')

  // Зашифровать блоб DEK'ом (новый IV на файл).
  const { iv, ciphertext } = await encryptBytes(dek, params.bytes)

  // Подпись (опционально) — отдельным зашифрованным полем, как JSON.
  const caption = params.caption?.trim()
  const encryptedContent = caption
    ? await encryptText(dek, JSON.stringify({ caption } satisfies EntryContent))
    : null

  // id генерим заранее — он же имя файла в Storage (путь {user_id}/{id},
  // RLS бакета изолирует юзеров по первому сегменту).
  const entryId = crypto.randomUUID()
  const mediaPath = `${user.id}/${entryId}`

  // Загрузить ЗАШИФРОВАННЫЙ блоб. upsert:false — не перезатираем существующее.
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(mediaPath, new Blob([ciphertext], { type: 'application/octet-stream' }), {
      contentType: 'application/octet-stream',
      upsert: false,
    })
  if (upErr) throw new Error(`media_upload_failed: ${upErr.message}`)

  // Записать метаданные. Упало — убираем осиротевший блоб и пробрасываем.
  const { error: insErr } = await supabase.from('path_entries').insert({
    id: entryId,
    user_id: user.id,
    entry_type: params.entryType,
    occurred_at: params.occurredAt.toISOString(),
    media_path: mediaPath,
    media_iv: bytesToBase64(iv),
    encrypted_content: encryptedContent,
  })
  if (insErr) {
    await supabase.storage.from(BUCKET).remove([mediaPath])
    throw new Error(`entry_insert_failed: ${insErr.message}`)
  }

  return entryId
}

/** Фото: сжать на клиенте (до шифрования, см. compress.ts) → общий пайплайн. */
export async function addPhotoEntry(input: NewPhoto): Promise<string> {
  const compressed = await compressImage(input.file)
  const bytes = new Uint8Array(await compressed.arrayBuffer())
  return saveEntry({
    entryType: 'photo',
    bytes,
    occurredAt: input.occurredAt,
    caption: input.caption,
  })
}

/**
 * Голос: блоб уже сжат (mp4/AAC из MediaRecorder), сжимать нечего — сразу в
 * общий пайплайн. Тип воспроизведения восстановим по entry_type (mediaMimeType).
 */
export async function addVoiceEntry(input: NewVoice): Promise<string> {
  const bytes = new Uint8Array(await input.blob.arrayBuffer())
  return saveEntry({
    entryType: 'voice',
    bytes,
    occurredAt: input.occurredAt,
    caption: input.caption,
  })
}

/**
 * Дневник: настроение и/или заметка, без медиа — поэтому НЕ через saveEntry
 * (там аплоад файла в Storage). Пишем прямо в path_entries:
 *   • mood      — открыто (число нужно серверу для будущих графиков);
 *   • note      — шифруется DEK'ом в note_ciphertext (как заметка анализов).
 * Требуем хотя бы одно из двух — совпадает с CHECK path_entries_diary_not_empty.
 */
export async function addDiaryEntry(input: NewDiary): Promise<string> {
  const dek = requireDek()

  const note = input.note?.trim()
  if (input.mood == null && !note) {
    // Клиентская страховка к серверному CHECK — не даём собрать пустую запись.
    throw new Error('diary_empty')
  }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('not_authenticated')

  const noteCiphertext = note ? await encryptText(dek, note) : null

  const entryId = crypto.randomUUID()
  const { error } = await supabase.from('path_entries').insert({
    id: entryId,
    user_id: user.id,
    entry_type: 'diary',
    occurred_at: input.occurredAt.toISOString(),
    mood: input.mood ?? null,
    note_ciphertext: noteCiphertext,
  })
  if (error) throw new Error(`diary_insert_failed: ${error.message}`)

  return entryId
}

// ── Чтение: лента (метаданные) ────────────────────────────────────────────────

/**
 * Лента «Пути» — только метаданные, новые сверху. Без расшифровки: контент
 * (картинки/подписи) тянем лениво по мере показа, чтобы не блокировать экран.
 * Фильтрация по юзеру — на RLS (path_entries_select_own = auth.uid()).
 */
export async function listEntries(): Promise<PathEntry[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('path_entries')
    .select(
      'id, entry_type, occurred_at, media_path, media_iv, encrypted_content, mood, note_ciphertext, created_at',
    )
    .order('occurred_at', { ascending: false })
  if (error) throw new Error(`entries_list_failed: ${error.message}`)

  return (data ?? []).map((r) => ({
    id: r.id,
    entryType: r.entry_type,
    occurredAt: r.occurred_at,
    mediaPath: r.media_path,
    mediaIv: r.media_iv,
    encryptedContent: r.encrypted_content,
    mood: r.mood,
    noteCiphertext: r.note_ciphertext,
    createdAt: r.created_at,
  }))
}

// ── Чтение: расшифровка контента (ленивая, на запись) ────────────────────────

/** Расшифровать подпись записи (фото/голос). null — если подписи нет. */
export async function decryptCaption(entry: PathEntry): Promise<string | null> {
  if (!entry.encryptedContent) return null
  const dek = requireDek()
  const json = await decryptText(dek, entry.encryptedContent)
  const parsed = JSON.parse(json) as EntryContent
  return parsed.caption ?? null
}

/**
 * Расшифровать текст заметки дневника. null — если заметки нет (запись только с
 * настроением). В отличие от caption, текст лежит голой строкой в note_ciphertext
 * (не JSON) — как заметка анализов.
 */
export async function decryptNote(entry: PathEntry): Promise<string | null> {
  if (!entry.noteCiphertext) return null
  const dek = requireDek()
  return decryptText(dek, entry.noteCiphertext)
}

// MIME расшифрованного медиа по типу записи: фото всегда JPEG (compress.ts),
// голос — mp4/AAC (запись MediaRecorder на iOS). Тип нужен для Blob, чтобы
// <img>/<audio> корректно проиграли. Аудитория — iOS PWA, там голос всегда mp4.
function mediaMimeType(entryType: PathEntryType): string {
  return entryType === 'voice' ? 'audio/mp4' : 'image/jpeg'
}

/**
 * Обратный путь для медиа (фото/голос): скачать шифроблоб → расшифровать в
 * памяти → отдать object URL для <img src> / <audio src>. Тип Blob выбирается
 * по entry_type (mediaMimeType).
 *
 * ВАЖНО: вызывающий ОБЯЗАН вызвать URL.revokeObjectURL(url), когда медиа больше
 * не нужно (размонтирование компонента) — иначе расшифрованный блоб висит в
 * памяти до перезагрузки страницы.
 */
export async function loadMediaUrl(entry: PathEntry): Promise<string> {
  if (!entry.mediaPath || !entry.mediaIv) throw new Error('entry_has_no_media')
  const dek = requireDek()
  const supabase = createClient()

  const { data, error } = await supabase.storage.from(BUCKET).download(entry.mediaPath)
  if (error || !data) {
    throw new Error(`media_download_failed: ${error?.message ?? 'no data'}`)
  }

  const ciphertext = new Uint8Array(await data.arrayBuffer())
  const iv = base64ToBytes(entry.mediaIv)
  const plain = await decryptBytes(dek, iv, ciphertext)

  return URL.createObjectURL(new Blob([plain], { type: mediaMimeType(entry.entryType) }))
}
