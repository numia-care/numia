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

/** Один показатель внутри сдачи. Числовой всегда: у «только фото» строк нет. */
export interface NewLabSessionRow {
  analyte: string
  analyteCustomName?: string // только для analyte='other'
  value: number
  unit: string
}

export interface NewLabSession {
  measuredAt?: string | null // null/undefined = дата не указана
  note?: string // E2E, ОБЩАЯ на сдачу
  photo?: File // E2E, ОДНО фото бланка на сдачу
  /** Показатели сдачи. Пустой массив = сдача «только фото бланка». */
  rows: NewLabSessionRow[]
}

/**
 * Сохранить СДАЧУ: одна запись в lab_sessions + N показателей в lab_results.
 *
 * Дата, заметка и фото бланка принадлежат сдаче — бланк физически один, на
 * нём сразу все значения. Показатели различаются только тройкой
 * analyte/value/unit.
 *
 * Если есть заметка или фото — нужен DEK в памяти (иначе PinRequiredError,
 * форма попросит PIN). Пустая сдача (ни показателей, ни фото) отклоняется.
 * Фото сжимается, шифруется и грузится в path-media ДО вставки; при сбое
 * осиротевший блоб удаляем.
 *
 * ДВОЙНАЯ ЗАПИСЬ. Общие поля дублируются в старые колонки КАЖДОГО из N рядов:
 * читатели ещё не переведены на сдачи и берут дату/заметку/фото оттуда. Без
 * дубля показатели 2…N остались бы в истории без даты и без бейджа фото.
 * Дубль уйдёт в подшаге 6 вместе с самими колонками. Фото при этом
 * НЕ дублируется — блоб один, в N рядов копируются только путь и IV.
 */
export async function addLabSession(
  input: NewLabSession,
): Promise<{ sessionId: string; resultIds: string[] }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('not_authenticated')

  if (input.rows.length === 0 && !input.photo) throw new Error('empty_record')

  const note = input.note?.trim()
  const needsDek = Boolean(note || input.photo)
  const dek = needsDek ? getCryptoKey() : null
  if (needsDek && !dek) throw new PinRequiredError()

  // Имя файла в Storage строится из id СДАЧИ: бланк один на сдачу, и путь из
  // id какого-то одного показателя был бы произволом «а почему именно этого».
  // Ничего в коде путь не выводит повторно — все читатели берут его из
  // колонки, — поэтому переезда путей не потребуется.
  const sessionId = crypto.randomUUID()

  // Сдача «только бланк» (rows пуст) теперь НЕ создаёт строк вовсе — это
  // честная «сдача с нулём показателей». Раньше приходилось вставлять
  // строку-полупустышку с NULL в analyte/value/unit, потому что читатели
  // ходили в lab_results и сдачу без строк не видели. С подшага 4 главная
  // сущность чтения — сама сдача, полупустышка больше не нужна.
  //
  // Старые полупустышки в базе остаются и продолжают показываться: маппер
  // кладёт в photoOnly и их (value == null), и сдачи без строк.
  const resultIds = input.rows.map(() => crypto.randomUUID())

  // E2E-заметка: IV упакован внутрь (encryptText). Шифруем ОДИН раз на сдачу,
  // одна и та же строка base64(iv‖ct) копируется во все колонки — это копия
  // шифротекста, а не повторное шифрование, лишних IV не появляется.
  const noteCiphertext = dek && note ? await encryptText(dek, note) : null

  // E2E-фото бланка: сжать → зашифровать (IV отдельно) → загрузить шифроблоб.
  let blankPhotoPath: string | null = null
  let blankPhotoIv: string | null = null
  if (dek && input.photo) {
    const compressed = await compressImage(input.photo)
    const bytes = new Uint8Array(await compressed.arrayBuffer())
    const { iv, ciphertext } = await encryptBytes(dek, bytes)
    const path = `${user.id}/${sessionId}`
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

  // ── Сдача, потом показатели ─────────────────────────────────────────────
  // Порядок задан внешним ключом: строки ссылаются на сдачу, значит сдача
  // обязана существовать раньше. Транзакции нет — PostgREST шлёт по стейтменту
  // на HTTP-запрос, BEGIN/COMMIT через несколько вызовов недоступны. Поэтому
  // откат оркеструем сами, как уже сделано для блоба.
  const { error: sessErr } = await supabase.from('lab_sessions').insert({
    id: sessionId,
    user_id: user.id,
    measured_at: input.measuredAt ?? null,
    note_ciphertext: noteCiphertext,
    blank_photo_path: blankPhotoPath,
    blank_photo_iv: blankPhotoIv,
  })
  if (sessErr) {
    if (blankPhotoPath) await supabase.storage.from(BUCKET).remove([blankPhotoPath])
    throw new Error(`lab_session_insert_failed: ${sessErr.message}`)
  }

  // Общая часть каждого ряда — только ссылки. Дата, заметка и фото живут на
  // сдаче и в строки БОЛЬШЕ НЕ ДУБЛИРУЮТСЯ: двойная запись была нужна, пока
  // читатели брали общие поля отсюда, а с подшага 4 они читают сдачу.
  // Сами колонки в lab_results ещё существуют — снесёт их миграция подшага 6,
  // но писать в них уже незачем.
  const shared = {
    user_id: user.id,
    session_id: sessionId,
  }

  const payload = input.rows.map((row, i) => ({
    id: resultIds[i],
    ...shared,
    analyte: row.analyte,
    // Кастомное имя осмысленно только для 'other' — так требует
    // констрейнт analyte_custom_name_only_other.
    analyte_custom_name:
      row.analyte === 'other' ? row.analyteCustomName?.trim() || null : null,
    value: row.value,
    unit: row.unit,
  }))

  // У сдачи «только бланк» показателей нет — вставлять нечего, сдача уже
  // создана выше и этого достаточно.
  if (payload.length > 0) {
    // ВСЕ N рядов ОДНИМ вызовом. supabase-js шлёт массив одним POST, PostgREST
    // превращает его в один INSERT с несколькими VALUES — то есть атомарно на
    // уровне Postgres: либо все N, либо ни одного. Цикл дал бы частичную
    // вставку и потребовал бы отката уже созданных строк.
    const { error: insErr } = await supabase.from('lab_results').insert(payload)
    if (insErr) {
      // Третья ступень отката: сносим и сдачу, и блоб — иначе останется пустая
      // сдача, ссылающаяся на файл, о котором никто не знает.
      await supabase.from('lab_sessions').delete().eq('id', sessionId)
      if (blankPhotoPath) await supabase.storage.from(BUCKET).remove([blankPhotoPath])
      throw new Error(`lab_insert_failed: ${insErr.message}`)
    }
  }

  return { sessionId, resultIds }
}

// addLabResult (обёртка «одна запись») и её тип NewLabResult удалены здесь же,
// в подшаге 4: форма перешла на addLabSession ещё в 3b, вызовов не осталось
// (проверено грепом по репозиторию), а после снятия строки-полупустышки её
// контракт всё равно ломался — для «только фото» она вернула бы undefined при
// заявленном Promise<string>. Держать мёртвую функцию со сломанным контрактом
// незачем. Понадобится одиночная вставка — это addLabSession с одной строкой.

// ── Правка и удаление СДАЧИ ЦЕЛИКОМ ─────────────────────────────────────────

/** Показатель в итоговом списке. id есть → существующий, нет → новый. */
export interface UpdateLabSessionRow {
  id?: string
  analyte: string
  analyteCustomName?: string // только для analyte='other'
  value: number
  unit: string
}

export interface UpdateLabSession {
  measuredAt?: string | null // null/undefined = дата не указана
  note?: string // E2E; пусто/не задано = заметку стереть
  // ── бланк (E2E) ──
  // photo задан        → заменить
  // removePhoto = true → убрать
  // ни то, ни другое   → НЕ ТРОГАТЬ
  photo?: File
  removePhoto?: boolean
  /** ИТОГОВЫЙ список показателей сдачи: чего здесь нет — будет удалено. */
  rows: UpdateLabSessionRow[]
}

/**
 * Обновить сдачу целиком: общие поля + разбор показателей.
 *
 * РАЗБОР БЕЗ ВЫБОРКИ ТЕКУЩИХ. Форма отдаёт итоговый список, и его хватает:
 *   upsert(onConflict:'id') — строки с id обновятся, без id вставятся, ОДНИМ
 *                             стейтментом, то есть атомарно
 *   delete … id not in (…)  — всё, чего в итоговом списке нет
 *
 * ПОРЯДОК upsert → delete выбран в сторону сохранности: удалить первым и
 * упасть на вставке значило бы потерять строки безвозвратно, а вставить
 * первым и упасть на удалении — оставить лишние, что чинится повтором.
 *
 * ПОРЯДОК «сдача → строки» задан тем, где лежит источник правды. До подшага 4
 * читатели брали общие поля из строки, и писать надо было её первой; теперь
 * они читают сдачу — значит первой пишется она.
 *
 * ТЕКУЩЕЕ ФОТО читаем в начале по двум причинам: из него берётся старый путь
 * для сноса, и им же заполняется дубль у НОВЫХ строк — иначе они получили бы
 * NULL там, где у соседей путь. Поэтому передавать его снаружи не требуется.
 *
 * ДВОЙНАЯ ЗАПИСЬ жива: общие поля дублируются в старые колонки ВСЕХ итоговых
 * строк. Уйдёт в подшаге 6 вместе с колонками.
 *
 * Чужую сдачу не даст тронуть RLS (lab_sessions_update_own), чужие строки —
 * lab_results_*, чужой блоб — storage-политики path_media_*. Новых прав нет.
 */
export async function updateLabSession(
  sessionId: string,
  input: UpdateLabSession,
): Promise<void> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('not_authenticated')

  const { data: current } = await supabase
    .from('lab_sessions')
    .select('blank_photo_path')
    .eq('id', sessionId)
    .maybeSingle()
  const currentPhotoPath = (current?.blank_photo_path as string | null) ?? null

  // Каким бланк станет после правки — нужно для гарда empty_record.
  const willHavePhoto =
    Boolean(input.photo) || (!input.removePhoto && currentPhotoPath != null)

  // Тот же инвариант, что при создании: сдача не может остаться и без
  // показателей, и без бланка — показывать было бы нечего.
  if (input.rows.length === 0 && !willHavePhoto) throw new Error('empty_record')

  const note = input.note?.trim()
  const needsDek = Boolean(note || input.photo)
  const dek = needsDek ? getCryptoKey() : null
  if (needsDek && !dek) throw new PinRequiredError()

  // Шифруем ОДИН раз на сдачу: во все колонки идёт копия одной строки
  // base64(iv‖ct), а не повторное шифрование.
  const noteCiphertext = dek && note ? await encryptText(dek, note) : null

  let photoPatch: {
    blank_photo_path?: string | null
    blank_photo_iv?: string | null
  } = {}
  let newPhotoPath: string | null = null

  if (dek && input.photo) {
    const compressed = await compressImage(input.photo)
    const bytes = new Uint8Array(await compressed.arrayBuffer())
    const { iv, ciphertext } = await encryptBytes(dek, bytes)
    // Новый путь на каждую замену: перезапись по тому же пути при смене IV
    // дала бы нерасшифровываемое фото — блоб новый, а IV в ряду ещё старый.
    newPhotoPath = `${user.id}/${sessionId}-${crypto.randomUUID()}`
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(
        newPhotoPath,
        new Blob([ciphertext], { type: 'application/octet-stream' }),
        { contentType: 'application/octet-stream', upsert: false },
      )
    if (upErr) throw new Error(`blank_photo_upload_failed: ${upErr.message}`)
    photoPatch = {
      blank_photo_path: newPhotoPath,
      blank_photo_iv: bytesToBase64(iv),
    }
  } else if (input.removePhoto) {
    // Оба поля обнуляем ВМЕСТЕ: констрейнт lab_sessions_photo_path_iv_together
    // требует, чтобы они были NULL только парой.
    photoPatch = { blank_photo_path: null, blank_photo_iv: null }
  }

  // ── 1. Сдача ────────────────────────────────────────────────────────────
  const { error: sessErr } = await supabase
    .from('lab_sessions')
    .update({
      measured_at: input.measuredAt ?? null,
      note_ciphertext: noteCiphertext,
      ...photoPatch,
    })
    .eq('id', sessionId)

  if (sessErr) {
    if (newPhotoPath) await supabase.storage.from(BUCKET).remove([newPhotoPath])
    throw new Error(`lab_session_update_failed: ${sessErr.message}`)
  }

  // ── 2. Показатели: upsert итоговых ──────────────────────────────────────
  const keptIds: string[] = []
  const payload = input.rows.map((row) => {
    const id = row.id ?? crypto.randomUUID()
    keptIds.push(id)
    return {
      id,
      user_id: user.id,
      session_id: sessionId,
      analyte: row.analyte,
      analyte_custom_name:
        row.analyte === 'other' ? row.analyteCustomName?.trim() || null : null,
      value: row.value,
      unit: row.unit,
      // Общие поля в строки БОЛЬШЕ НЕ ДУБЛИРУЮТСЯ: они живут на сдаче, и с
      // подшага 4 читатели берут их оттуда. Колонки в lab_results ещё есть,
      // но писать в них незачем — снесёт миграция подшага 6.
    }
  })

  if (payload.length > 0) {
    const { error: upsertErr } = await supabase
      .from('lab_results')
      .upsert(payload, { onConflict: 'id' })
    if (upsertErr) {
      if (newPhotoPath) await supabase.storage.from(BUCKET).remove([newPhotoPath])
      throw new Error(`lab_rows_upsert_failed: ${upsertErr.message}`)
    }
  }

  // ── 3. Показатели: снести всё, чего в итоговом списке нет ───────────────
  const removeQuery = supabase
    .from('lab_results')
    .delete()
    .eq('session_id', sessionId)
  const { error: delErr } = await (keptIds.length > 0
    ? removeQuery.not('id', 'in', `(${keptIds.join(',')})`)
    : removeQuery)

  if (delErr) throw new Error(`lab_rows_delete_failed: ${delErr.message}`)

  // ── 4. Старый блоб — в самом конце, когда обе записи прошли ─────────────
  // Раньше значило бы риск оставить сдачу указывающей на удалённый файл.
  // best-effort: осиротевший шифроблоб безвреден, прочитать его нечем.
  const replacedOrRemoved = Boolean(newPhotoPath) || Boolean(input.removePhoto)
  if (replacedOrRemoved && currentPhotoPath) {
    await supabase.storage.from(BUCKET).remove([currentPhotoPath])
  }
}

/**
 * Удалить сдачу целиком: показатели уходят каскадом (FK on delete cascade),
 * следом блоб бланка.
 *
 * Единственное осмысленное удаление для сдачи «только бланк» — у неё строк
 * нет, и удалять по строке нечего.
 *
 * Порядок из deleteEntry «Пути»: ряды авторитетны, блоб последним. Каскада из
 * Postgres в Storage не существует, поэтому блоб сносим руками; не вышло —
 * остаётся осиротевший шифроблоб: безвреден, зашифрован, путь к нему знала
 * только удалённая сдача.
 */
export async function deleteLabSession(
  sessionId: string,
  blankPhotoPath: string | null,
): Promise<void> {
  const supabase = createClient()

  const { error } = await supabase
    .from('lab_sessions')
    .delete()
    .eq('id', sessionId)
  if (error) throw new Error(`lab_session_delete_failed: ${error.message}`)

  if (blankPhotoPath) {
    await supabase.storage.from(BUCKET).remove([blankPhotoPath])
  }
}
