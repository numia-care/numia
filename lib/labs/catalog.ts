// Каталог лабораторных показателей — ЕДИНСТВЕННЫЙ источник единиц и
// коэффициентов конверсии. Правится/расширяется здесь, не в БД.
//
// Конверсия детерминированная (через коэффициент, без AI) и применяется ТОЛЬКО
// для отображения на графике. В БД значение и единица хранятся как ввёл юзер —
// исходник не искажаем.
//
// Ни один показатель не обязателен: юзер трекает хоть один (напр. только
// эстрадиол). Добавить показатель = одна запись в ANALYTES.

export interface LabUnit {
  // Стабильный код единицы — он же хранится в lab_results.unit для каталожных
  // показателей. Не меняем после релиза (иначе старые записи «потеряют» единицу).
  code: string
  // Отображаемая подпись (RU).
  label: string
  // Множитель перевода значения ИЗ этой единицы в базовую (units[0]).
  // База имеет toBase = 1. Перевод между единицами:
  //   base   = value * from.toBase
  //   target = base / to.toBase
  toBase: number
}

export interface ReferenceRange {
  min: number
  max: number
  unitCode: string
}

export interface Analyte {
  // Код показателя — хранится в lab_results.analyte.
  code: string
  // Отображаемое имя (RU, гендерно-нейтральное).
  name: string
  // Единицы показателя. units[0] — базовая И дефолтная в форме. Пустой массив
  // только у 'other' (единицу юзер вписывает свободно).
  units: LabUnit[]
  // true только для 'other' — произвольные название и единица.
  allowCustom?: boolean
  // ── ЗАДЕЛ НА БУДУЩЕЕ: целевой коридор ─────────────────────────────────────
  // Структура есть, но ВЫКЛЮЧЕНА (null у всех). График референсные полосы НЕ
  // рисует. Чтобы зажечь — заполнить { min, max, unitCode } у нужного
  // показателя; больше нигде править не надо (график прочитает отсюда).
  referenceRange: ReferenceRange | null
}

// Коэффициенты конверсии (комментарий = заданное направление):
//   Эстрадиол:    пг/мл → пмоль/л  × 3.67
//   Тестостерон:  нг/дл → нмоль/л  × 0.0347
//   Пролактин:    нг/мл → мЕд/л    × 21.2   (стандарт ВОЗ)
// Для ЛГ/ФСГ (мЕд/мл = МЕ/л, численно равны) и ГСПГ (нмоль/л) конверсия не
// применяется — одна единица.
//
// toBase у альтернативной единицы = 1 / коэффициент, т.к. база — «from»-единица:
//   напр. пмоль/л → пг/мл = value / 3.67, значит toBase(пмоль/л) = 1/3.67.
export const ANALYTES: Analyte[] = [
  {
    code: 'estradiol',
    name: 'Эстрадиол (E2)',
    units: [
      { code: 'pg_ml', label: 'пг/мл', toBase: 1 },
      { code: 'pmol_l', label: 'пмоль/л', toBase: 1 / 3.67 },
    ],
    referenceRange: null,
  },
  {
    code: 'testosterone',
    name: 'Тестостерон (T)',
    units: [
      { code: 'ng_dl', label: 'нг/дл', toBase: 1 },
      { code: 'nmol_l', label: 'нмоль/л', toBase: 1 / 0.0347 },
    ],
    referenceRange: null,
  },
  {
    code: 'prolactin',
    name: 'Пролактин',
    units: [
      { code: 'ng_ml', label: 'нг/мл', toBase: 1 },
      { code: 'miu_l', label: 'мЕд/л', toBase: 1 / 21.2 },
    ],
    referenceRange: null,
  },
  {
    code: 'lh',
    name: 'ЛГ (LH)',
    units: [{ code: 'miu_ml', label: 'мЕд/мл', toBase: 1 }],
    referenceRange: null,
  },
  {
    code: 'fsh',
    name: 'ФСГ (FSH)',
    units: [{ code: 'miu_ml', label: 'мЕд/мл', toBase: 1 }],
    referenceRange: null,
  },
  {
    code: 'shbg',
    name: 'ГСПГ (SHBG)',
    units: [{ code: 'nmol_l', label: 'нмоль/л', toBase: 1 }],
    referenceRange: null,
  },
  {
    code: 'other',
    name: 'Другое',
    units: [],
    allowCustom: true,
    referenceRange: null,
  },
]

export function getAnalyte(code: string): Analyte | undefined {
  return ANALYTES.find((a) => a.code === code)
}

// Дефолтная единица показателя (база). undefined для 'other'.
export function defaultUnitCode(analyte: Analyte): string | undefined {
  return analyte.units[0]?.code
}

// Подпись единицы по коду в рамках показателя; fallback — сам код (для 'other'
// там лежит произвольная строка, её и показываем).
export function unitLabel(analyte: Analyte, unitCode: string): string {
  return analyte.units.find((u) => u.code === unitCode)?.label ?? unitCode
}

/**
 * Перевести значение между единицами показателя. Детерминированно, через
 * коэффициенты выше. Если единицы совпадают или одна неизвестна (напр. 'other')
 * — возвращаем значение как есть. Используется ТОЛЬКО для отображения.
 */
export function convertValue(
  value: number,
  fromCode: string,
  toCode: string,
  analyte: Analyte,
): number {
  if (fromCode === toCode) return value
  const from = analyte.units.find((u) => u.code === fromCode)
  const to = analyte.units.find((u) => u.code === toCode)
  if (!from || !to) return value
  return (value * from.toBase) / to.toBase
}
