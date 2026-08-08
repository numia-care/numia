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

  // Общая часть каждого ряда: ссылка на сдачу + ДУБЛЬ её полей в старые
  // колонки. Дубль нужен, пока читатели не переведены на сдачи (подшаг 4):
  // без него показатели 2…N остались бы без даты и без бейджа фото. Фото при
  // этом не дублируется — блоб один, копируются только путь и IV.
  const shared = {
    user_id: user.id,
    session_id: sessionId,
    measured_at: input.measuredAt ?? null,
    note_ciphertext: noteCiphertext,
    blank_photo_path: blankPhotoPath,
    blank_photo_iv: blankPhotoIv,
  }

  // Тип объявлен явно: без него TS выводит объединение двух форм ряда
  // (числовой со string/number и полупустышка с null) и не может свести их
  // к одному аргументу insert. В самой таблице эти колонки nullable —
  // гибкий ввод, миграция 20260723.
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

export interface UpdateLabResult {
  analyte?: string // опускается для записи «только фото»
  analyteCustomName?: string // только для analyte='other'
  value?: number // опускается для записи «только фото»
  unit?: string
  measuredAt?: string | null // null = дата не указана
  note?: string // E2E; пусто/не задано = заметку стереть
  // ── фото бланка (E2E) ──
  // photo задан        → заменить существующее
  // removePhoto = true → убрать
  // ни то, ни другое   → НЕ ТРОГАТЬ (колонки не попадут в патч)
  photo?: File
  removePhoto?: boolean
  /** Текущий путь блоба — нужен, чтобы снести старый файл при замене/удалении. */
  currentPhotoPath?: string | null
}

/**
 * Обновить показатель.
 *
 * ЗАМЕТКА ПЕРЕЗАПИСЫВАЕТСЯ ЦЕЛИКОМ, не патчится. encryptText генерит новый IV
 * на каждый вызов и возвращает единый base64(iv‖ct) — патчить там нечего в
 * принципе. И это не деталь реализации, а требование: повтор пары (ключ, IV)
 * в AES-GCM ломает и конфиденциальность, и аутентичность, так что
 * переиспользовать старый IV было бы уязвимостью, а не экономией.
 *
 * Пустая заметка пишется как NULL, а НЕ как шифротекст пустой строки: иначе
 * has_note остался бы true и бейдж в списке открывал бы пустоту.
 *
 * DEK нужен только когда заметка непустая. Стереть заметку или поправить одни
 * числа можно и с истёкшей PIN-сессией — расшифровывать нечего. (Префилл
 * заметки в форме — другое дело, там DEK нужен, и форма гейтит вход сама.)
 *
 * ФОТО — три случая, см. UpdateLabResult. Если ни photo, ни removePhoto не
 * заданы, колонки blank_photo_* в патч не попадают вовсе: PostgREST обновляет
 * только переданные, так что существующий блоб в безопасности.
 *
 * ЗАМЕНА ФОТО идёт через НОВЫЙ ПУТЬ, а не перезапись старого:
 *   1. залить новый блоб по {user_id}/{id}-{uuid}, старый не трогать
 *   2. UPDATE ряда: новый путь + новый IV (пара согласована — CHECK доволен)
 *   3. снести старый блоб best-effort
 * Так ряд ни в один момент не указывает на отсутствующее или
 * нерасшифровываемое. Перезапись по тому же пути (upsert) была бы хуже: IV
 * меняется при каждом шифровании, и сбой UPDATE после успешной загрузки дал
 * бы новый блоб при старом IV — фото не расшифровалось бы никогда, тихо.
 * Вариант «снести, потом залить» хуже тем же, чем в deleteEntry: между
 * операциями ряд указывает на пустоту.
 *
 * ДВОЙНАЯ ЗАПИСЬ. Дата, заметка и фото пишутся И в строку, И в сдачу. Иначе
 * копии разъедутся молча: сегодня читают строку, а в подшаге 6 источником
 * правды станет сдача — и правка оказалась бы потеряна. Порядок и обработка
 * частичного сбоя — в комментарии у самого апдейта сдачи ниже.
 *
 * Чужой ряд не даст тронуть RLS (lab_results_update_own), чужую сдачу —
 * lab_sessions_update_own, чужой блоб — storage-политики path_media_*.
 * Новых прав не нужно.
 */
export async function updateLabResult(
  id: string,
  input: UpdateLabResult,
): Promise<void> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('not_authenticated')

  const note = input.note?.trim()
  const needsDek = Boolean(note || input.photo)
  const dek = needsDek ? getCryptoKey() : null
  if (needsDek && !dek) throw new PinRequiredError()

  const noteCiphertext = dek && note ? await encryptText(dek, note) : null
  const hasValue = typeof input.value === 'number' && isFinite(input.value)

  // Сдача, к которой принадлежит строка. Достаём запросом, а не параметром:
  // передать её сверху значило бы тронуть getLabResultForEdit, страницу
  // правки и LabFormValues, а этот подшаг их не касается.
  //
  // null тут после бэкфилла быть не должно, но до SET NOT NULL формально
  // возможен — тогда пишем только в старые колонки, как раньше. Страховка
  // уйдёт вместе с шагом 5 миграции.
  const { data: row } = await supabase
    .from('lab_results')
    .select('session_id')
    .eq('id', id)
    .maybeSingle()
  const sessionId = (row?.session_id as string | null) ?? null

  // Патч колонок фото собираем отдельно: пустой объект = «не трогать».
  let photoPatch: {
    blank_photo_path?: string | null
    blank_photo_iv?: string | null
  } = {}
  let newPhotoPath: string | null = null

  if (dek && input.photo) {
    const compressed = await compressImage(input.photo)
    const bytes = new Uint8Array(await compressed.arrayBuffer())
    const { iv, ciphertext } = await encryptBytes(dek, bytes)
    // Новый путь на каждую замену — обоснование в шапке функции. Базой берём
    // id сдачи, а не строки: бланк принадлежит сдаче (см. addLabSession).
    newPhotoPath = `${user.id}/${sessionId ?? id}-${crypto.randomUUID()}`
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(
        newPhotoPath,
        new Blob([ciphertext], { type: 'application/octet-stream' }),
        { contentType: 'application/octet-stream', upsert: false },
      )
    if (upErr) throw new Error(`blank_photo_upload_failed: ${upErr.message}`)
    photoPatch = { blank_photo_path: newPhotoPath, blank_photo_iv: bytesToBase64(iv) }
  } else if (input.removePhoto) {
    // Оба поля обнуляем ВМЕСТЕ: констрейнт blank_photo_path_iv_together
    // требует, чтобы они были NULL только парой, иначе UPDATE отвалится.
    photoPatch = { blank_photo_path: null, blank_photo_iv: null }
  }

  const { error } = await supabase
    .from('lab_results')
    .update({
      analyte: hasValue ? (input.analyte ?? null) : null,
      analyte_custom_name:
        hasValue && input.analyte === 'other'
          ? input.analyteCustomName?.trim() || null
          : null,
      value: hasValue ? input.value : null,
      unit: hasValue ? (input.unit ?? null) : null,
      measured_at: input.measuredAt ?? null,
      note_ciphertext: noteCiphertext,
      ...photoPatch,
    })
    .eq('id', id)

  if (error) {
    // Ряд не обновился — только что залитый блоб осиротел, убираем его.
    // Старый при этом цел, и ряд по-прежнему указывает на него.
    if (newPhotoPath) await supabase.storage.from(BUCKET).remove([newPhotoPath])
    throw new Error(`lab_update_failed: ${error.message}`)
  }

  // ── Вторая копия: та же дата/заметка/фото в сдачу ───────────────────────
  // Порядок «строка, потом сдача» выбран сознательно. Транзакции нет, значит
  // частичный результат возможен, и первой пишем ту копию, которую сейчас
  // РЕАЛЬНО читают: если ляжет только она, юзер увидит, что правка применилась.
  // Обратный порядок дал бы «сохранила, а ничего не изменилось» плюс скрытое
  // расхождение. При сбое второго апдейта бросаем — повтор перезапишет обе
  // копии, то есть частичное состояние самоизлечивается.
  //
  // Без этого копии разъедутся молча: сегодня читают строку, а в подшаге 6
  // источником правды станет сдача — и правка оказалась бы потеряна.
  if (sessionId) {
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
  }

  // Старый блоб сносим ТОЛЬКО когда обе копии переписаны. Раньше это стояло
  // сразу после апдейта строки — тогда сбой апдейта сдачи оставил бы её
  // указывающей на уже удалённый файл.
  //
  // best-effort: не вышло — остаётся осиротевший шифроблоб, безвреден,
  // прочитать его нечем.
  const replacedOrRemoved = Boolean(newPhotoPath) || Boolean(input.removePhoto)
  if (replacedOrRemoved && input.currentPhotoPath) {
    await supabase.storage.from(BUCKET).remove([input.currentPhotoPath])
  }
}

/**
 * Удалить показатель. Удаление ЖЁСТКОЕ, не мягкое: колонки deleted_at у
 * lab_results нет и заводить её незачем — на запись ничего не ссылается.
 * (У препаратов иначе: там soft-delete нужен, чтобы не осиротела история
 * приёмов в intake_events.)
 *
 * СДАЧА сносится только когда у неё не осталось показателей. У сдачи их
 * может быть несколько, а общие дата и бланк живут на ней — удалить сдачу
 * вместе с одним показателем значило бы уронить каскадом соседние строки.
 *
 * Порядок — как в deleteEntry «Пути» (lib/path/entries.ts): сначала ряд,
 * потом блоб фото best-effort. Каскада из Postgres в Storage не существует:
 * это разные подсистемы, внешних ключей туда нет и триггер их не заменит,
 * поэтому блоб приходится сносить руками. Если снести не вышло — остаётся
 * осиротевший шифроблоб: он безвреден (зашифрован, а путь к нему знал только
 * удалённый ряд), просто занимает место. Обратный порядок был бы хуже —
 * запись со сломанным фото в списке.
 *
 * Клиентская, потому что чистит Storage браузерным клиентом — тем же, что
 * грузил блоб. DEK при этом НЕ нужен: удаление ничего не расшифровывает, так
 * что запись можно убрать и с истёкшей PIN-сессией. Это осознанно: гейт на
 * PIN здесь не защитил бы ничего (аккаунт уже аутентифицирован), а мешал бы.
 *
 * Чужую запись не даст удалить RLS — политика lab_results_delete_own, плюс
 * storage-политика path_media_delete_own по префиксу пути с auth.uid().
 * Новых прав не требуется.
 */
export async function deleteLabResult(row: {
  id: string
  blank_photo_path: string | null
}): Promise<void> {
  const supabase = createClient()

  // Сдачу достаём ДО удаления строки — после неё связь узнать негде.
  // Запросом, а не параметром: сигнатуру не меняем, чтобы не тянуть правки
  // в LabDeleteButton, страницу правки и getLabResultForEdit.
  const { data: existing } = await supabase
    .from('lab_results')
    .select('session_id')
    .eq('id', row.id)
    .maybeSingle()
  const sessionId = (existing?.session_id as string | null) ?? null

  const { error } = await supabase.from('lab_results').delete().eq('id', row.id)
  if (error) throw new Error(`lab_delete_failed: ${error.message}`)

  if (!sessionId) {
    // Строка без сдачи (до бэкфилла таких не осталось, но страховка дешёвая).
    if (row.blank_photo_path) {
      await supabase.storage.from(BUCKET).remove([row.blank_photo_path])
    }
    return
  }

  // ── Сдачу сносим ТОЛЬКО если она опустела ───────────────────────────────
  // Ключевой момент: у сдачи может быть несколько показателей, и общие для
  // них дата и бланк живут на сдаче. Снести её вместе с одним показателем
  // значило бы уронить каскадом соседние строки — то есть потерять данные.
  const { count } = await supabase
    .from('lab_results')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)

  // count === null означает, что посчитать не удалось. Трактуем как «строки
  // остались» и сдачу не трогаем: оставить лишнюю сдачу безобидно, а снести
  // живую — потеря данных. При сомнении выбираем сторону сохранности.
  const remaining = count ?? 1
  if (remaining > 0) {
    // У соседей общая дата и бланк — ни сдачу, ни блоб не трогаем.
    return
  }

  // Показатель был последним. Порядок — как в deleteEntry «Пути»: сначала
  // ряд (уже удалён выше), потом сдача, потом блоб best-effort. Осиротевший
  // шифроблоб безвреден: он зашифрован, а путь к нему знала только сдача.
  await supabase.from('lab_sessions').delete().eq('id', sessionId)

  if (row.blank_photo_path) {
    // best-effort: ошибку не пробрасываем, ряды уже удалены.
    await supabase.storage.from(BUCKET).remove([row.blank_photo_path])
  }
}
