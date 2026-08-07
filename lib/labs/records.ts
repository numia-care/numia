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
  analyte?: string // опускается для записи «только фото»
  analyteCustomName?: string // только для analyte='other'
  value?: number // опускается для записи «только фото»
  unit?: string
  measuredAt?: string | null // null/undefined = дата не указана
  note?: string // E2E
  photo?: File // E2E (фото бланка)
}

/**
 * Сохранить показатель. Гибкий ввод (миграция 20260723): ряд может быть
 * «числовым» (value+unit+analyte, дата опциональна) ИЛИ «только фото бланка»
 * (числа не заданы — снимок на потом). Пустой ряд (ни чисел, ни фото)
 * отклоняем. Если есть заметка или фото — нужен DEK в памяти (иначе
 * PinRequiredError, форма попросит PIN). Фото сжимается, шифруется и грузится
 * в path-media ДО вставки ряда; при сбое вставки осиротевший блоб удаляем.
 *
 * СДАЧА (lab_sessions). Создаётся здесь же, перед строкой: дата, заметка и
 * фото бланка логически принадлежат сдаче, а не отдельному показателю.
 * Пока идёт миграция параллельными колонками, те же значения ДУБЛИРУЮТСЯ в
 * старые колонки lab_results — читатели ещё берут их оттуда. Дубль уйдёт в
 * подшаге 6 вместе с колонками.
 *
 * Форма пока отдаёт один показатель за раз, поэтому связь один-к-одному.
 * Несколько показателей на одну сдачу появятся в подшаге 3.
 */
export async function addLabResult(input: NewLabResult): Promise<string> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('not_authenticated')

  const hasValue = typeof input.value === 'number' && isFinite(input.value)
  if (!hasValue && !input.photo) throw new Error('empty_record')

  const note = input.note?.trim()
  const needsDek = Boolean(note || input.photo)
  const dek = needsDek ? getCryptoKey() : null
  if (needsDek && !dek) throw new PinRequiredError()

  // ДВА идентификатора вместо одного: сдача и строка — разные сущности.
  // Имя файла в Storage строится из id СДАЧИ: бланк один на сдачу, и когда
  // у сдачи появится несколько показателей (подшаг 3), путь из id строки был
  // бы произволом «а почему именно этой». Ничего в коде путь не выводит
  // повторно — все читатели берут его из колонки, — поэтому переезда путей
  // ни сейчас, ни позже не потребуется.
  const sessionId = crypto.randomUUID()
  const resultId = crypto.randomUUID()

  // E2E-заметка: IV упакован внутрь (encryptText). Шифруем ОДИН раз, одна и
  // та же строка base64(iv‖ct) ляжет в обе колонки — это копия шифротекста,
  // а не второе шифрование, повтора пары (ключ, IV) не возникает.
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

  // ── Сдача, потом строка ─────────────────────────────────────────────────
  // Порядок задан внешним ключом: строка ссылается на сдачу, значит сдача
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

  const { error: insErr } = await supabase.from('lab_results').insert({
    id: resultId,
    user_id: user.id,
    session_id: sessionId,
    // Числовые поля — только у числового ряда; у «только фото» они NULL.
    analyte: hasValue ? (input.analyte ?? null) : null,
    analyte_custom_name:
      hasValue && input.analyte === 'other'
        ? input.analyteCustomName?.trim() || null
        : null,
    value: hasValue ? input.value : null,
    unit: hasValue ? (input.unit ?? null) : null,
    // ДУБЛЬ в старые колонки — миграция параллельными колонками. Читатели
    // ещё не переведены на сдачи и берут дату/заметку/фото отсюда. Дубль
    // уйдёт в подшаге 6 вместе с самими колонками.
    measured_at: input.measuredAt ?? null,
    note_ciphertext: noteCiphertext,
    blank_photo_path: blankPhotoPath,
    blank_photo_iv: blankPhotoIv,
  })
  if (insErr) {
    // Третья ступень отката: сносим и сдачу, и блоб — иначе останется пустая
    // сдача, ссылающаяся на файл, о котором никто не знает.
    await supabase.from('lab_sessions').delete().eq('id', sessionId)
    if (blankPhotoPath) await supabase.storage.from(BUCKET).remove([blankPhotoPath])
    throw new Error(`lab_insert_failed: ${insErr.message}`)
  }

  return resultId
}

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
    // id сдачи, а не строки: бланк принадлежит сдаче (см. addLabResult).
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

  // На этом подшаге связь строго один-к-одному: одна строка — одна сдача.
  // Не снести её значило бы оставить пустую сдачу с blank_photo_path на файл,
  // который мы сейчас удалим, — и в подшаге 6 она всплыла бы как «сдача
  // только с фото» с битым блобом.
  //
  // Настоящая логика (посчитать оставшиеся показатели сдачи и удалять её
  // только когда их не осталось) появится в подшаге 6, когда сдача сможет
  // держать несколько строк.
  if (sessionId) {
    // best-effort: строка уже удалена, ронять действие из-за сдачи незачем.
    await supabase.from('lab_sessions').delete().eq('id', sessionId)
  }

  if (row.blank_photo_path) {
    // best-effort: ошибку не пробрасываем, ряд уже удалён.
    await supabase.storage.from(BUCKET).remove([row.blank_photo_path])
  }
}
