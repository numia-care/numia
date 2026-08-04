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
  measured_at: string | null // 'yyyy-MM-dd' или null (дата не указана)
  /**
   * E2E-заметка как есть: base64(iv‖ct) из encryptText. Сервер её прочитать
   * не может — DEK живёт только в памяти вкладки, — поэтому отдавать её на
   * клиент безопасно, и только так заметку вообще можно показать. Ровно то
   * же делает лента «Пути» (lib/path/entries.ts). Расшифровка —
   * decryptLabNote (lib/labs/notes.ts), исключительно в браузере.
   */
  note_ciphertext: string | null
  /** Производное от note_ciphertext — для бейджа, чтобы не тянуть строку. */
  has_note: boolean
  has_photo: boolean
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

  // RLS отбивает чужие ряды. Сортировка по дате: новые сверху, записи без
  // даты (nullsFirst:false) — в конце, тай-брейк по времени создания.
  const { data, error } = await supabase
    .from('lab_results')
    .select(
      'id, analyte, analyte_custom_name, value, unit, measured_at, note_ciphertext, blank_photo_path, created_at',
    )
    .order('measured_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (error || !data) return { numeric: [], photoOnly: [] }

  const rows: LabResultRow[] = data.map((r) => ({
    id: r.id as string,
    analyte: (r.analyte as string | null) ?? null,
    analyte_custom_name: (r.analyte_custom_name as string | null) ?? null,
    value: r.value == null ? null : Number(r.value),
    unit: (r.unit as string | null) ?? null,
    measured_at: (r.measured_at as string | null) ?? null,
    // Шифротекст заметки отдаём как есть — расшифровать его может только
    // клиент с DEK в памяти. Раньше здесь оставался лишь флаг, и заметку
    // физически нечем было открыть: запись работала, чтения не было.
    note_ciphertext: (r.note_ciphertext as string | null) ?? null,
    has_note: r.note_ciphertext != null,
    // Фото по-прежнему только флагом: его блоб лежит в Storage и тянется
    // отдельным запросом, а не этим списком.
    has_photo: r.blank_photo_path != null,
    created_at: r.created_at as string,
  }))

  return {
    numeric: rows.filter((r) => r.value != null),
    photoOnly: rows.filter((r) => r.value == null),
  }
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

  const { data, error } = await supabase
    .from('lab_results')
    .select(
      'id, analyte, analyte_custom_name, value, unit, measured_at, note_ciphertext, blank_photo_path, blank_photo_iv, created_at',
    )
    .eq('id', id)
    .maybeSingle()

  if (error || !data) return null

  return {
    id: data.id as string,
    analyte: (data.analyte as string | null) ?? null,
    analyte_custom_name: (data.analyte_custom_name as string | null) ?? null,
    value: data.value == null ? null : Number(data.value),
    unit: (data.unit as string | null) ?? null,
    measured_at: (data.measured_at as string | null) ?? null,
    note_ciphertext: (data.note_ciphertext as string | null) ?? null,
    blank_photo_path: (data.blank_photo_path as string | null) ?? null,
    blank_photo_iv: (data.blank_photo_iv as string | null) ?? null,
    created_at: data.created_at as string,
  }
}
