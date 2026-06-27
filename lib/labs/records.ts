// Запись лабораторного показателя. Гибрид по границе шифрования:
//   • Числа (analyte, value, unit, measured_at) — открыто в lab_results под RLS.
//   • Заметка и фото бланка — E2E тем же конвейером, что медиа «Пути»
//     (encryptText / encryptBytes → path-media). Сервер их не читает.
//
// Только клиент: нужен DEK из PIN-сессии для шифрования заметки/фото, браузерный
// Supabase и Web Crypto. Импортируется из 'use client' формы.

import { encryptBytes, encryptText } from '@/lib/crypto/envelope'
import { bytesToBase64 } from '@/lib/crypto/pin'
import { getCryptoKey } from '@/lib/crypto/session'
import { createClient } from '@/lib/supabase/client'
import { compressImage } from '@/lib/path/compress'
import { PinRequiredError } from '@/lib/path/entries'

const BUCKET = 'path-media'

export interface NewLabResult {
  analyte: string
  analyteCustomName?: string // только для analyte='other'
  value: number
  unit: string
  measuredAt: string // 'yyyy-MM-dd'
  note?: string // E2E
  photo?: File // E2E (фото бланка)
}

/**
 * Сохранить показатель. Если есть заметка или фото — нужен DEK в памяти
 * (иначе PinRequiredError, форма попросит PIN). Фото сжимается (как в «Пути»),
 * шифруется и грузится в path-media ДО вставки ряда; при сбое вставки
 * осиротевший блоб удаляем.
 */
export async function addLabResult(input: NewLabResult): Promise<string> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('not_authenticated')

  const note = input.note?.trim()
  const needsDek = Boolean(note || input.photo)
  const dek = needsDek ? getCryptoKey() : null
  if (needsDek && !dek) throw new PinRequiredError()

  // id генерим заранее — он же имя файла фото в Storage ({user_id}/{id}).
  const id = crypto.randomUUID()

  // E2E-заметка: IV упакован внутрь (encryptText).
  const noteCiphertext = dek && note ? await encryptText(dek, note) : null

  // E2E-фото бланка: сжать → зашифровать (IV отдельно) → загрузить шифроблоб.
  let blankPhotoPath: string | null = null
  let blankPhotoIv: string | null = null
  if (dek && input.photo) {
    const compressed = await compressImage(input.photo)
    const bytes = new Uint8Array(await compressed.arrayBuffer())
    const { iv, ciphertext } = await encryptBytes(dek, bytes)
    const path = `${user.id}/${id}`
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, new Blob([ciphertext], { type: 'application/octet-stream' }), {
        contentType: 'application/octet-stream',
        upsert: false,
      })
    if (upErr) throw new Error(`blank_photo_upload_failed: ${upErr.message}`)
    blankPhotoPath = path
    blankPhotoIv = bytesToBase64(iv)
  }

  const { error: insErr } = await supabase.from('lab_results').insert({
    id,
    user_id: user.id,
    analyte: input.analyte,
    analyte_custom_name:
      input.analyte === 'other' ? input.analyteCustomName?.trim() || null : null,
    value: input.value,
    unit: input.unit,
    measured_at: input.measuredAt,
    note_ciphertext: noteCiphertext,
    blank_photo_path: blankPhotoPath,
    blank_photo_iv: blankPhotoIv,
  })
  if (insErr) {
    // Убираем осиротевший блоб, если ряд не записался.
    if (blankPhotoPath) await supabase.storage.from(BUCKET).remove([blankPhotoPath])
    throw new Error(`lab_insert_failed: ${insErr.message}`)
  }

  return id
}
