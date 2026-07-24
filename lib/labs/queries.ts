import { createClient } from '@/lib/supabase/server'

// Серверное чтение анализов для рендера списка/истории.
//
// Читаем только ОТКРЫТЫЕ поля (числа, единица, дата) — они под RLS, не E2E.
// note_ciphertext / blank_photo_path берём лишь чтобы показать наличие
// вложений (бейдж), сам контент тут не расшифровываем. Мутации и E2E-запись —
// в lib/labs/records.ts (клиент).
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
    // Только наличие вложений — сам шифротекст наружу не отдаём.
    has_note: r.note_ciphertext != null,
    has_photo: r.blank_photo_path != null,
    created_at: r.created_at as string,
  }))

  return {
    numeric: rows.filter((r) => r.value != null),
    photoOnly: rows.filter((r) => r.value == null),
  }
}
