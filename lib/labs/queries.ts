import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'

const ID_SCHEMA = z.string().uuid()

// Серверное чтение анализов для рендера списка/истории.
//
// Открытые поля (числа, единица, дата) — под RLS, не E2E.
// note_ciphertext отдаём наружу шифротекстом: расшифровать его может только
// клиент, у которого DEK в памяти сессии (decryptLabNote в lib/labs/notes.ts).
// Здесь ничего не расшифровывается и расшифровано быть не может — ключа на
// сервере нет. blank_photo_path — по-прежнему только флагом наличия.
// Мутации и E2E-запись — в lib/labs/records.ts (клиент).
//
// Гибкий ввод (миграция 20260723): ряд бывает числовым (value задан) или
// «только фото бланка» (value/analyte/unit = null, есть фото). Дата тоже
// опциональна. Поэтому value/analyte/unit/measured_at здесь nullable.

export interface LabResultRow {
  id: string
  analyte: string | null
  analyte_custom_name: string | null
  value: number | null
  unit: string | null
  /**
   * id строки lab_results. NULL у сдачи «только бланк» — у неё показателей
   * нет вовсе, редактировать нечего, и карандаш в истории для неё скрыт.
   * Правка такой сдачи целиком появится в подшаге 5.
   */
  result_id: string | null
  /** Сдача, к которой принадлежит запись. Общие поля ниже — её. */
  session_id: string
  measured_at: string | null // 'yyyy-MM-dd' или null (дата не указана)
  /**
   * E2E-заметка как есть: base64(iv‖ct) из encryptText. Сервер её прочитать
   * не может — DEK живёт только в памяти вкладки, — поэтому отдавать её на
   * клиент безопасно, и только так заметку вообще можно показать. Ровно то
   * же делает лента «Пути» (lib/path/entries.ts). Расшифровка —
   * decryptLabNote (lib/labs/notes.ts), исключительно в браузере.
   */
  note_ciphertext: string | null
  /**
   * Производные флаги «есть заметка / есть бланк». Потребителей у них не
   * осталось: LabNote и LabPhoto получают сам шифротекст (путь и IV) и сами
   * решают, рендериться ли. Оставлены как дешёвый признак наличия для будущих
   * читателей; если так и не понадобятся — снести в уборке подшага 6.
   */
  has_note: boolean
  has_photo: boolean
  /**
   * Путь и IV шифроблоба бланка. Как и заметка, едут на клиент шифротекстом:
   * расшифровать может только браузер с DEK в памяти. Нужны, чтобы показать
   * фото прямо в истории — сам показыватель приезжает следующим заходом.
   */
  blank_photo_path: string | null
  blank_photo_iv: string | null
  created_at: string
}

export interface LabResults {
  /** Числовые записи (value задан) — для группировки по показателю и графиков. */
  numeric: LabResultRow[]
  /** Записи «только фото бланка» — снимки без ручного ввода чисел. */
  photoOnly: LabResultRow[]
}

export async function listLabResults(): Promise<LabResults> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { numeric: [], photoOnly: [] }

  // ГЛАВНАЯ СУЩНОСТЬ ЗАПРОСА — СДАЧА, показатели эмбедятся. Обратный порядок
  // (строки главные, сдача эмбедом) не годится по двум причинам: сортировать
  // пришлось бы по колонке вложенной таблицы, и, главное, сдача БЕЗ строк —
  // то есть «только бланк» — в такой запрос не попала бы никогда.
  //
  // RLS применяется к обеим таблицам автоматически (lab_sessions_select_own +
  // lab_results_select_own). Новых прав не требуется.
  //
  // Сортировка по дате: новые сверху, сдачи без даты (nullsFirst:false) — в
  // конце, тай-брейк по времени создания.
  const { data, error } = await supabase
    .from('lab_sessions')
    // Одним строковым литералом, без конкатенации: supabase-js выводит форму
    // ответа из ЛИТЕРАЛА select, а 'a' + 'b' даёт обычный string, и вывод
    // ломается (тот же приём, что в lib/tracker/today.ts).
    .select(
      `
      id, measured_at, note_ciphertext, blank_photo_path, blank_photo_iv, created_at,
      results:lab_results(id, analyte, analyte_custom_name, value, unit, created_at)
    `,
    )
    .order('measured_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (error || !data) return { numeric: [], photoOnly: [] }

  const numeric: LabResultRow[] = []
  const photoOnly: LabResultRow[] = []

  for (const s of data) {
    // Общие поля сдачи — они же попадут в каждую её запись.
    const shared = {
      session_id: s.id as string,
      measured_at: (s.measured_at as string | null) ?? null,
      // Шифротекст заметки отдаём как есть — расшифровать его может только
      // клиент с DEK в памяти.
      note_ciphertext: (s.note_ciphertext as string | null) ?? null,
      has_note: s.note_ciphertext != null,
      has_photo: s.blank_photo_path != null,
      blank_photo_path: (s.blank_photo_path as string | null) ?? null,
      blank_photo_iv: (s.blank_photo_iv as string | null) ?? null,
    }

    // Порядок показателей внутри сдачи задаём здесь, а не через referencedTable:
    // история всё равно перегруппировывает всё по показателю, так что на экран
    // он не попадает, а ошибка в имени вложенной таблицы уронила бы весь
    // запрос — то есть историю целиком. Сортировка в коде безопаснее.
    const results = [...((s.results ?? []) as SessionResult[])].sort((a, b) =>
      String(a.created_at).localeCompare(String(b.created_at)),
    )

    if (results.length === 0) {
      // Сдача «только бланк»: показателей нет вовсе. Синтезируем одну запись,
      // чтобы история показала её в секции photoOnly. result_id = null —
      // редактировать нечего, карандаш для неё скрыт.
      photoOnly.push({
        id: s.id as string,
        result_id: null,
        analyte: null,
        analyte_custom_name: null,
        value: null,
        unit: null,
        ...shared,
        created_at: s.created_at as string,
      })
      continue
    }

    for (const r of results) {
      const row: LabResultRow = {
        id: r.id,
        result_id: r.id,
        analyte: r.analyte ?? null,
        analyte_custom_name: r.analyte_custom_name ?? null,
        value: r.value == null ? null : Number(r.value),
        unit: r.unit ?? null,
        ...shared,
        created_at: r.created_at,
      }
      // Строки без числа — это старые полупустышки «только фото», созданные
      // до подшага 4. Уживаются с новыми сдачами-без-строк в той же секции.
      if (row.value != null) numeric.push(row)
      else photoOnly.push(row)
    }
  }

  return { numeric, photoOnly }
}

/** Форма вложенной строки в ответе запроса выше. */
interface SessionResult {
  id: string
  analyte: string | null
  analyte_custom_name: string | null
  value: number | string | null
  unit: string | null
  created_at: string
}

/**
 * Одна запись целиком — для экрана редактирования.
 *
 * В отличие от списка отдаёт и blank_photo_path/blank_photo_iv: удалению нужен
 * путь блоба, чтобы снести его из Storage вслед за рядом (каскада из Postgres
 * в Storage не существует). Заметка — по-прежнему шифротекстом: расшифровать
 * её может только клиент.
 *
 * Аналог getMedicationForEdit из трекера. Чужой ряд не отдаст RLS; на всякий
 * случай отсекаем и мусорный id, чтобы не ходить в БД впустую.
 */
export interface LabResultForEdit {
  id: string
  analyte: string | null
  analyte_custom_name: string | null
  value: number | null
  unit: string | null
  measured_at: string | null
  note_ciphertext: string | null
  blank_photo_path: string | null
  blank_photo_iv: string | null
  created_at: string
}

export async function getLabResultForEdit(
  id: string,
): Promise<LabResultForEdit | null> {
  if (!ID_SCHEMA.safeParse(id).success) return null

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  // Здесь эмбед сдачи уместен, в отличие от списка: выборка одной строки по
  // id, сортировки нет, а сдачи без строк по определению не встречаются —
  // мы ищем именно строку.
  const { data, error } = await supabase
    .from('lab_results')
    .select(
      `
      id, analyte, analyte_custom_name, value, unit, session_id, created_at,
      session:lab_sessions(measured_at, note_ciphertext, blank_photo_path, blank_photo_iv)
    `,
    )
    .eq('id', id)
    .maybeSingle()

  if (error || !data) return null

  // Общие поля берём со сдачи. Двойная запись пока жива, так что старые
  // колонки строки содержат то же самое — но читаем именно сдачу, чтобы не
  // осталось читателя на старом источнике.
  // supabase-js без сгенерённых Database-типов не знает, что связь «к одному»,
  // и типизирует вложенный ресурс массивом. На рантайме PostgREST отдаёт
  // объект. Разворачиваем оба варианта — тот же приём, что для medication в
  // lib/tracker/today.ts.
  const rawSession = data.session as unknown
  const session = (Array.isArray(rawSession) ? (rawSession[0] ?? null) : rawSession) as {
    measured_at: string | null
    note_ciphertext: string | null
    blank_photo_path: string | null
    blank_photo_iv: string | null
  } | null

  return {
    id: data.id as string,
    analyte: (data.analyte as string | null) ?? null,
    analyte_custom_name: (data.analyte_custom_name as string | null) ?? null,
    value: data.value == null ? null : Number(data.value),
    unit: (data.unit as string | null) ?? null,
    measured_at: session?.measured_at ?? null,
    note_ciphertext: session?.note_ciphertext ?? null,
    blank_photo_path: session?.blank_photo_path ?? null,
    blank_photo_iv: session?.blank_photo_iv ?? null,
    created_at: data.created_at as string,
  }
}
