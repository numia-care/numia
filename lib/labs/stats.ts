import { convertValue, defaultUnitCode } from './catalog'
import type { Analyte } from './catalog'

/**
 * Расчёты по замерам анализов: дельта, тренд, попадание в коридор.
 *
 * Чистые детерминированные функции — ни запросов, ни БД, ни Date.now().
 * Одинаковый вход даёт одинаковый выход всегда.
 *
 * --- Про приватность (это влияет на сигнатуру) ---
 *
 * Функции принимают НЕ LabResultRow, а минимальную форму MeasuredPoint
 * {value, unit, measured_at}. Сужение намеренное, ровно как в
 * lib/tracker/stats.ts: так этот модуль структурно не может дотянуться до
 * note_ciphertext и blank_photo_path — а они E2E, расшифровываются только в
 * браузере с DEK в памяти, и статистике возле них делать нечего. Заодно сюда
 * не попадает analyte_custom_name: свободный текст, куда юзер пишет что
 * угодно, включая то, чего в аналитике быть не должно.
 *
 * Отсюда же следует, чего здесь НЕТ: чтения referenceRange из каталога и
 * любого автоподбора «нормы». Коридор в positionInRange приходит ТОЛЬКО
 * аргументом — его задаёт юзер руками (назначение врача). Приложение не
 * вычисляет границы по замерам ни при каких условиях: «твой обычный диапазон»,
 * посчитанный по трём точкам, читался бы как медицинская норма, которой он не
 * является. Нет аргумента — нет коридора, функция вернёт null.
 *
 * --- Про сопоставимость единиц (главное) ---
 *
 * convertValue из catalog.ts при невозможности перевода МОЛЧА возвращает
 * исходное число (catalog.ts:140) — для графика это безобидно, для вычитания
 * нет: разность посчиталась бы так, будто единицы совпадают. Поэтому здесь
 * есть свой convertStrict, который сначала проверяет сопоставимость и только
 * потом зовёт convertValue. Несопоставимо — возвращаем null, никогда число.
 *
 * Сопоставимыми считаются два случая:
 *   1) обе единицы есть в analyte.units — переводим коэффициентом каталога;
 *   2) строки единиц совпадают после trim — тождество, переводить нечего.
 * Случай (2) нужен для analyte='other': там в unit лежит произвольная строка
 * юзера, коэффициентов для неё нет и выдумывать их мы не будем. «мкг/л» и
 * «нг/мл» у 'other' — несопоставимы, точка.
 *
 * --- Про округление ---
 *
 * Не округляем нигде. Отдаём сырые числа с их плавающей запятой (см. пример 1
 * ниже: 6.400000000000034). Форматирование — забота UI, у него Intl и знание
 * контекста; округлять в расчётах значило бы копить ошибку молча.
 *
 * --- Примеры ---
 *
 * Тестов в проекте нет (нет раннера в devDependencies и скрипта test), поэтому
 * поведение зафиксировано здесь. Числа настоящие, посчитаны по коэффициентам
 * каталога.
 *
 * 1. Дельта при СМЕШАННЫХ единицах — прошлый замер в пг/мл, текущий в пмоль/л:
 *
 *      const e2 = getAnalyte('estradiol')!
 *      computeLabDelta(
 *        { value: 300, unit: 'pmol_l', measured_at: '2026-08-01' },
 *        { value: 80,  unit: 'pg_ml',  measured_at: '2026-05-01' },
 *        'pmol_l', e2,
 *      )
 *      // → 6.400000000000034   (80 пг/мл = 293.59999999999997 пмоль/л)
 *      // Без приведения получилось бы 300 − 80 = 220. Ради этого всё и затеяно.
 *
 * 2. Тренд по трём замерам подряд вверх (units смешаны, приводятся к базовой):
 *
 *      computeLabTrend([
 *        { value: 40,  unit: 'pg_ml',  measured_at: '2026-03-01' },
 *        { value: 220, unit: 'pmol_l', measured_at: '2026-05-01' },  // ≈59.9 пг/мл
 *        { value: 95,  unit: 'pg_ml',  measured_at: '2026-08-01' },
 *      ], e2)
 *      // → { direction: 'up', streak: 2 }   — два подъёма подряд, три точки
 *
 * 3. Коридор ЮЗЕРА, границы включительно:
 *
 *      const range = { min: 100, max: 250, unitCode: 'pmol_l' }
 *      positionInRange(250, 'pmol_l', range, e2)   // → 'inside'  (ровно граница)
 *      positionInRange(80,  'pg_ml',  range, e2)   // → 'above'   (293.6 > 250)
 *      positionInRange(50,  'pg_ml',  null,  e2)   // → null      (коридор не задан)
 *
 * 4. 'other' с несовпадающими единицами — молчим, а не считаем:
 *
 *      const other = getAnalyte('other')!
 *      computeLabDelta(
 *        { value: 30, unit: 'нг/мл', measured_at: '2026-08-01' },
 *        { value: 12, unit: 'мкг/л', measured_at: '2026-05-01' },
 *        'нг/мл', other,
 *      )
 *      // → null   (а НЕ 18: коэффициента между этими единицами мы не знаем)
 */

// ── Входные формы ────────────────────────────────────────────────────────────

/**
 * Минимум, нужный для расчёта. Намеренно уже, чем LabResultRow.
 *
 * measured_at здесь НЕ nullable, в отличие от LabResultRow — это и есть
 * гарантия инварианта «замеры без даты в дельте и тренде не участвуют»:
 * недатированный замер просто не проходит по типу. Фильтровать — работа
 * вызывающего, и она видна в его коде, а не спрятана здесь.
 */
export interface MeasuredPoint {
  value: number
  /** Код единицы для каталожных показателей, произвольная строка для 'other'. */
  unit: string
  /** 'yyyy-MM-dd'. */
  measured_at: string
}

/**
 * Границы коридора, ЗАДАННЫЕ ЮЗЕРОМ (назначение врача).
 *
 * Тип свой, а не ReferenceRange из каталога, и это принципиально: тот про
 * медицинскую норму показателя, этот — про личную цель конкретного человека.
 * Совпадение полей случайно, смешивать их нельзя.
 */
export interface UserRange {
  min: number
  max: number
  unitCode: string
}

export type RangePosition = 'below' | 'inside' | 'above'

export interface LabTrend {
  direction: 'up' | 'down' | 'flat'
  /**
   * Сколько подряд идущих ПЕРЕХОДОВ (шагов между соседними замерами) смотрят
   * в одну сторону, считая от последнего. Точек в серии на одну больше:
   * streak=2 значит три замера. Для 'flat' всегда 1 — равенство серию
   * обрывает, а не продолжает.
   */
  streak: number
}

// ── Публичные функции ────────────────────────────────────────────────────────

/**
 * Насколько текущий замер отличается от предыдущего, в единице displayUnit.
 *
 * Оба значения приводятся к displayUnit до вычитания. Возвращает сырую
 * разность: положительная — рост, отрицательная — падение.
 *
 * null, если хотя бы одно значение не приводится к displayUnit — сравнивать
 * несравнимое нельзя даже ценой «пустого места» в интерфейсе.
 */
export function computeLabDelta(
  current: MeasuredPoint,
  previous: MeasuredPoint,
  displayUnit: string,
  analyte: Analyte,
): number | null {
  if (!isUsable(current) || !isUsable(previous)) return null

  const a = convertStrict(current.value, current.unit, displayUnit, analyte)
  if (a === null) return null

  const b = convertStrict(previous.value, previous.unit, displayUnit, analyte)
  if (b === null) return null

  return a - b
}

/**
 * Направление и длина серии в конце ряда: «растёт третий замер подряд».
 *
 * Все точки приводятся к одной единице (базовой у каталожных показателей, к
 * единице последнего замера у 'other'), несопоставимые отбрасываются. Затем от
 * последнего перехода идём назад, пока направление не сменится.
 *
 * ⚠️ Отброшенные точки не оставляют «дырки»: если в середине ряда попался
 * замер в чужой единице, соседи по краям станут соседями друг другу и могут
 * дать серию, которой в исходном ряду не было. Показывать тренд вместе с
 * графиком, где видны все точки, — тогда расхождение заметно глазом.
 *
 * points ожидаются по возрастанию времени, но порядок мы всё равно
 * восстанавливаем сами (как это делает LabChart) — перепутанный ряд дал бы
 * бессмысленный тренд молча.
 *
 * null, если сопоставимых точек меньше двух: тренда из одной точки не бывает.
 */
export function computeLabTrend(
  points: MeasuredPoint[],
  analyte: Analyte,
): LabTrend | null {
  const usable = points.filter(isUsable)
  if (usable.length < 2) return null

  // Копия: входной массив не наш, мутировать его нельзя.
  const ordered = [...usable].sort((a, b) =>
    a.measured_at.localeCompare(b.measured_at),
  )

  // Единица приведения. У каталожных — базовая. У 'other' базовой нет
  // (units пуст), поэтому берём единицу последнего замера: остальные точки
  // сойдутся с ней только при точном совпадении строки, что нам и нужно.
  const target =
    defaultUnitCode(analyte) ?? ordered[ordered.length - 1]!.unit

  const values: number[] = []
  for (const p of ordered) {
    const v = convertStrict(p.value, p.unit, target, analyte)
    if (v !== null) values.push(v)
  }
  if (values.length < 2) return null

  const stepDir = (i: number): LabTrend['direction'] => {
    const diff = values[i]! - values[i - 1]!
    if (diff > 0) return 'up'
    if (diff < 0) return 'down'
    return 'flat'
  }

  const last = values.length - 1
  const direction = stepDir(last)

  // Равенство серию обрывает: «не меняется» — это состояние, а не движение,
  // и складывать несколько таких подряд в «flat streak 3» значило бы придумать
  // динамику там, где её нет.
  if (direction === 'flat') return { direction, streak: 1 }

  let streak = 1
  for (let i = last - 1; i >= 1; i--) {
    if (stepDir(i) !== direction) break
    streak++
  }

  return { direction, streak }
}

/**
 * Где значение относительно коридора, заданного юзером.
 *
 * Границы ВКЛЮЧИТЕЛЬНО: ровно min и ровно max — это 'inside'.
 *
 * Коридор приходит аргументом и только аргументом. Функция не смотрит в
 * каталог, не считает перцентили по истории и вообще не знает, что кроме
 * этого значения существуют другие замеры.
 *
 * null, если: коридора нет (range == null), границы бессмысленны (не числа
 * или min > max), либо значение не приводится к range.unitCode.
 */
export function positionInRange(
  value: number,
  unit: string,
  range: UserRange | null | undefined,
  analyte: Analyte,
): RangePosition | null {
  if (!range) return null
  if (!Number.isFinite(value)) return null
  if (!Number.isFinite(range.min) || !Number.isFinite(range.max)) return null
  // Перевёрнутый коридор — ошибка ввода, а не повод гадать, что имелось в виду.
  if (range.min > range.max) return null

  const v = convertStrict(value, unit, range.unitCode, analyte)
  if (v === null) return null

  if (v < range.min) return 'below'
  if (v > range.max) return 'above'
  return 'inside'
}

// ── Внутреннее ───────────────────────────────────────────────────────────────

/**
 * Перевод со СТРОГОЙ проверкой сопоставимости — в отличие от convertValue,
 * который при неудаче молча отдаёт исходное число.
 *
 * Возвращает null всюду, где перевод не обоснован. Всё, что считает этот
 * модуль, проходит через эту функцию — другого пути к арифметике нет.
 */
export function convertStrict(
  value: number,
  fromUnit: string,
  toUnit: string,
  analyte: Analyte,
): number | null {
  if (!Number.isFinite(value)) return null

  const from = fromUnit.trim()
  const to = toUnit.trim()
  if (from === '' || to === '') return null

  // Тождество: единицы совпадают, переводить нечего. Работает и для 'other',
  // и для каталожного показателя с непонятной легаси-единицей — разность двух
  // значений в одной и той же единице осмысленна всегда.
  if (from === to) return value

  // Разные единицы — перевод возможен, только если ОБЕ известны каталогу.
  const known = (u: string) => analyte.units.some((x) => x.code === u)
  if (!known(from) || !known(to)) return null

  return convertValue(value, from, to, analyte)
}

/** Точка пригодна к расчёту: число конечно, единица и дата непусты. */
function isUsable(p: MeasuredPoint): boolean {
  return (
    Number.isFinite(p.value) &&
    typeof p.unit === 'string' &&
    p.unit.trim() !== '' &&
    typeof p.measured_at === 'string' &&
    p.measured_at.trim() !== ''
  )
}
