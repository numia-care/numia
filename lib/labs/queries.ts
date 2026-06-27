import { createClient } from '@/lib/supabase/server'

// Серверное чтение анализов для рендера списка/истории.
//
// Читаем только ОТКРЫТЫЕ поля (числа, единица, дата) — они под RLS, не E2E.
// note_ciphertext / blank_photo_path берём лишь чтобы показать наличие
// вложений (бейдж), сам контент тут не расшифровываем. Мутации и E2E-запись —
// в lib/labs/records.ts (клиент).

export interface LabResultRow {
  id: string
  analyte: string
  analyte_custom_name: string | null
  value: number
  unit: string
  measured_at: string // 'yyyy-MM-dd'
  has_note: boolean
  has_photo: boolean
  created_at: string
}

export async function listLabResults(): Promise<LabResultRow[]> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  // RLS отбивает чужие ряды; userId в коде не дублируем (как в трекере/«Пути»).
  const { data, error } = await supabase
    .from('lab_results')
    .select(
      'id, analyte, analyte_custom_name, value, unit, measured_at, note_ciphertext, blank_photo_path, created_at',
    )
    .order('measured_at', { ascending: false })
    .order('created_at', { ascending: false })

  if (error || !data) return []

  return data.map((r) => ({
    id: r.id as string,
    analyte: r.analyte as string,
    analyte_custom_name: (r.analyte_custom_name as string | null) ?? null,
    value: Number(r.value),
    unit: r.unit as string,
    measured_at: r.measured_at as string,
    // Только наличие вложений — сам шифротекст наружу не отдаём.
    has_note: r.note_ciphertext != null,
    has_photo: r.blank_photo_path != null,
    created_at: r.created_at as string,
  }))
}
