import type {
  DoseUnit,
  MedicationForm,
  MedicationKind,
} from './queries'

/**
 * Каталог популярных препаратов со smart defaults.
 *
 * На v1 — захардкоженный. На этапе 5 (вики) — динамический.
 *
 * Каждый препарат → дефолты для kind, form, dose_unit, dose_default.
 * При выборе из каталога форма автозаполняется — юзер экономит 10 секунд.
 * При ручном вводе (нет в каталоге) — детали раскрываются для ввода.
 */
export interface MedicationCatalogEntry {
  name: string
  kind: MedicationKind
  form: MedicationForm
  dose_unit: DoseUnit
  dose_default: number
}

export const MEDICATION_CATALOG: readonly MedicationCatalogEntry[] = [
  // Эстрогены
  { name: 'Эстрадиол валерат', kind: 'estrogen', form: 'tablet', dose_unit: 'mg', dose_default: 2 },
  { name: 'Эстрадиол гемигидрат', kind: 'estrogen', form: 'tablet', dose_unit: 'mg', dose_default: 2 },
  { name: 'Эстрадиола ципионат', kind: 'estrogen', form: 'injection', dose_unit: 'mg', dose_default: 5 },
  { name: 'Эстрадиола энантат', kind: 'estrogen', form: 'injection', dose_unit: 'mg', dose_default: 5 },
  // Длинный эфир: колют раз в 2-4 недели, отсюда дефолт выше энантата/ципионата.
  { name: 'Эстрадиола ундецилат', kind: 'estrogen', form: 'injection', dose_unit: 'mg', dose_default: 40 },
  { name: 'Эстрадиол (гель)', kind: 'estrogen', form: 'gel', dose_unit: 'mg', dose_default: 1.5 },
  { name: 'Эстрадиол (пластырь)', kind: 'estrogen', form: 'patch', dose_unit: 'mcg', dose_default: 100 },
  { name: 'Эстрадиол (спрей)', kind: 'estrogen', form: 'spray', dose_unit: 'puff', dose_default: 3 },
  // Антиандрогены
  { name: 'Ципротерона ацетат', kind: 'antiandrogen', form: 'tablet', dose_unit: 'mg', dose_default: 25 },
  { name: 'Спиронолактон', kind: 'antiandrogen', form: 'tablet', dose_unit: 'mg', dose_default: 100 },
  { name: 'Бикалутамид', kind: 'antiandrogen', form: 'tablet', dose_unit: 'mg', dose_default: 25 },
  // Прогестероны
  { name: 'Прогестерон микронизированный', kind: 'progesterone', form: 'capsule', dose_unit: 'mg', dose_default: 100 },
  { name: 'Дидрогестерон', kind: 'progesterone', form: 'tablet', dose_unit: 'mg', dose_default: 10 },
  { name: 'Медроксипрогестерона ацетат', kind: 'progesterone', form: 'tablet', dose_unit: 'mg', dose_default: 5 },
  // Тестостероны
  { name: 'Тестостерона энантат', kind: 'testosterone', form: 'injection', dose_unit: 'mg', dose_default: 250 },
  { name: 'Тестостерона ципионат', kind: 'testosterone', form: 'injection', dose_unit: 'mg', dose_default: 200 },
  { name: 'Тестостерона ундеканоат', kind: 'testosterone', form: 'injection', dose_unit: 'mg', dose_default: 1000 },
  { name: 'Тестостерон (гель)', kind: 'testosterone', form: 'gel', dose_unit: 'mg', dose_default: 50 },
  // GnRH-аналоги
  { name: 'Трипторелин', kind: 'antiandrogen', form: 'injection', dose_unit: 'mg', dose_default: 3.75 },
  { name: 'Гозерелин', kind: 'antiandrogen', form: 'injection', dose_unit: 'mg', dose_default: 3.6 },
  { name: 'Лейпрорелин', kind: 'antiandrogen', form: 'injection', dose_unit: 'mg', dose_default: 3.75 },
]

export const POPULAR_MEDICATIONS: readonly string[] = MEDICATION_CATALOG.map((e) => e.name)

/**
 * Быстрый поиск дефолтов по точному названию.
 * Возвращает undefined для пользовательских (не из каталога) препаратов.
 */
export function findCatalogDefaults(name: string): MedicationCatalogEntry | undefined {
  return MEDICATION_CATALOG.find((e) => e.name === name)
}

export const KIND_LABELS_RU: Record<MedicationKind, string> = {
  estrogen: 'эстроген',
  antiandrogen: 'антиандроген',
  progesterone: 'прогестерон',
  testosterone: 'тестостерон',
  other: 'другое',
}

export const FORM_LABELS_RU: Record<MedicationForm, string> = {
  tablet: 'таблетка',
  capsule: 'капсула',
  injection: 'инъекция',
  gel: 'гель',
  patch: 'пластырь',
  drops: 'капли',
  spray: 'спрей',
  other: 'другое',
}

export const UNIT_LABELS_RU: Record<DoseUnit, string> = {
  mg: 'мг',
  mcg: 'мкг',
  ml: 'мл',
  iu: 'МЕ',
  drop: 'кап.',
  puff: 'пшик',
  tablet: 'таб.',
}

export const KINDS_ORDERED: MedicationKind[] = [
  'estrogen',
  'antiandrogen',
  'progesterone',
  'testosterone',
  'other',
]

export const FORMS_ORDERED: MedicationForm[] = [
  'tablet',
  'capsule',
  'injection',
  'gel',
  'patch',
  'drops',
  'spray',
  'other',
]

export const UNITS_ORDERED: DoseUnit[] = [
  'mg',
  'mcg',
  'ml',
  'iu',
  'tablet',
  'drop',
  'puff',
]
