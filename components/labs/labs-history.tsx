import { format, parse } from 'date-fns'
import { ru } from 'date-fns/locale'
import { ImageIcon, PencilIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'

import {
  LabsAccordion,
  type AccordionItem,
} from '@/components/labs/labs-accordion'
import { LabMetricChart } from '@/components/labs/lab-metric-chart'
import { LabNote } from '@/components/labs/lab-note'
import { LabPhoto } from '@/components/labs/lab-photo'
import { LabPositionPill } from '@/components/labs/lab-position-pill'
import { LabRangeEditor } from '@/components/labs/lab-range-editor'
import {
  ANALYTES,
  defaultUnitCode,
  getAnalyte,
  unitLabel,
} from '@/lib/labs/catalog'
import { listLabRangesServer, type LabResultRow } from '@/lib/labs/queries'
import type { LabRanges } from '@/lib/labs/ranges'
import {
  computeLabDelta,
  computeLabTrend,
  convertStrict,
  positionInRange,
  type UserRange,
} from '@/lib/labs/stats'

// Презентационный список истории анализов: числовые записи сгруппированы по
// показателю (порядок каталога), внутри — по дате (новые сверху), с графиком
// динамики и полосой персонального коридора. Записи «только фото бланка» —
// отдельной секцией.
// Данные приходят сверху; используется и на /labs, и в табе «Анализы» трекера.
export async function LabsHistory({
  numeric,
  photoOnly,
}: {
  numeric: LabResultRow[]
  photoOnly: LabResultRow[]
}) {
  const t = await getTranslations('labs')

  // Коридоры читаются ОДИН раз на весь экран и раздаются островкам пропсом.
  // Иначе каждый редактор ходил бы за ними сам — четыре-шесть одинаковых
  // запросов и мигание при загрузке.
  //
  // Ловим намеренно: listLabRangesServer бросает при ошибке (чтобы пустой
  // ответ не прочитался как «коридор не задан» и не дал затереть границы), но
  // уронить из-за коридора весь экран трекера было бы хуже той проблемы.
  // null здесь — это «не знаем», и редактор в таком виде правку не предлагает.
  let ranges: LabRanges | null = null
  try {
    ranges = await listLabRangesServer()
  } catch {
    ranges = null
  }

  const groups = groupByAnalyte(numeric)

  // Дельты считаются один раз на весь экран, ключ — id строки. Так JSX ниже
  // остаётся прежним: в цикле по группам не появляется тела с вычислениями.
  const deltas = computeDeltas(groups)

  // Панели собираются ЗДЕСЬ, на сервере, и уезжают в аккордеон готовыми
  // узлами — тот же приём, что у TrackerTabs. Содержимое панели на этом шаге
  // не менялось: коридор, график, список замеров ровно как были. Изменилось
  // только то, что заголовок группы уехал в кнопку аккордеона.
  const items: AccordionItem[] = groups.map((group) => ({
    key: group.key,
    title: group.title,
    summary: (
      <CollapsedSummary
        group={group}
        range={isOtherGroup(group) ? null : (ranges?.[group.key] ?? null)}
        deltas={deltas}
      />
    ),
    panel: (
      <>
        <MetricSummary
          group={group}
          range={isOtherGroup(group) ? null : (ranges?.[group.key] ?? null)}
          deltas={deltas}
        />

        {/* Коридор — только у каталожных показателей. У «другого» ключ
            группы вида other:<название>, и коридор для него не поддержан:
            (user_id, analyte) склеил бы разные кастомные показатели. */}
        {!isOtherGroup(group) && (
          <LabRangeEditor
            analyteCode={group.key}
            range={ranges?.[group.key] ?? null}
            unavailable={ranges === null}
          />
        )}

        <ChartFromRows
          rows={group.rows}
          analyteCode={isOtherGroup(group) ? 'other' : group.key}
          range={isOtherGroup(group) ? null : (ranges?.[group.key] ?? null)}
        />

        <div className="space-y-2">
          {group.rows.map((row) => {
            const approx = approxInCanonical(row)

            return (
            // Карточка стала колонкой: значение и дата в верхней строке как
            // раньше, раскрытая заметка — под ними. Иначе развёрнутому тексту
            // некуда встать, он ломал бы ряд по базовой линии.
            <div
              key={row.id}
              className="rounded-2xl bg-card px-4 py-3 ring-1 ring-border"
            >
              <div className="flex items-baseline justify-between gap-4">
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-lg text-foreground">
                      {formatNumber(row.value)}
                    </span>
                    <span className="text-sm text-foreground/60">
                      {displayUnit(row)}
                    </span>
                  </div>

                  {/* Пересчёт в опорную единицу показателя — ПРОИЗВОДНОЕ
                      число, а не второй замер. Границу держат «≈» и
                      приглушённость: введённое значение остаётся крупным и
                      первичным, его мы не искажаем. */}
                  {approx && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t('metric.approx', approx)}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Delta value={deltas.get(row.id)} unit={displayUnit(row)} />
                  <time
                    className="text-sm text-foreground/60"
                    dateTime={row.measured_at ?? undefined}
                  >
                    {formatDate(row.measured_at, t('noDate'))}
                  </time>
                  <EditLink id={row.session_id} label={t('editLink')} />
                </div>
              </div>

              {/* Заметка и бланк — раскрывающиеся, под строкой: развёрнутому
                  содержимому нужна ширина карточки. Оба — самостоятельные
                  кнопки-соседи, вложенной интерактивности нет (строку целиком
                  в ссылку мы намеренно не оборачиваем). */}
              <LabNote ciphertext={row.note_ciphertext} />
              <LabPhoto path={row.blank_photo_path} iv={row.blank_photo_iv} />
            </div>
            )
          })}
        </div>
      </>
    ),
  }))

  return (
    <div className="space-y-10">
      <LabsAccordion items={items} initialKey={latestGroupKey(groups)} />

      {photoOnly.length > 0 && (
        <section>
          <h2 className="mb-4 font-heading text-xl text-foreground/70">
            {t('photoSectionTitle')}
          </h2>
          <div className="space-y-2">
            {photoOnly.map((row) => (
              <div
                key={row.id}
                className="rounded-2xl bg-card px-4 py-3 ring-1 ring-border"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2 text-foreground">
                    <ImageIcon className="size-4 text-lavender-deep" />
                    <span className="text-sm">{t('photoOnlyCard')}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <time
                      className="text-sm text-foreground/60"
                      dateTime={row.measured_at ?? undefined}
                    >
                      {formatDate(row.measured_at, t('noDate'))}
                    </time>
                    <EditLink id={row.session_id} label={t('editLink')} />
                  </div>
                </div>

                <LabNote ciphertext={row.note_ciphertext} />
                <LabPhoto path={row.blank_photo_path} iv={row.blank_photo_iv} />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// ── Свёрнутая строка показателя ──────────────────────────────────────────────

/**
 * Строка неактивного показателя в аккордеоне: слева название и границы
 * коридора, справа последнее значение с дельтой.
 *
 * Смысл — не разворачивать показатель ради одной цифры: что сейчас и куда
 * сдвинулось, видно прямо в свёрнутом виде.
 *
 * Собирается на СЕРВЕРЕ и уезжает в LabsAccordion готовым узлом. Ни коридоры,
 * ни дельты на клиент не переезжают: аккордеон только показывает то, что
 * получил, и дорисовывает шеврон.
 *
 * ⚠️ Копирайт границ: «коридор 100–160 пг/мл». Не «обычный» и не «норма» —
 * и то и другое было бы оценкой, а это просто числа, которые человек задал
 * сам. Коридор не задан — строки границ нет вовсе, без плейсхолдера: пустая
 * подпись «границы не заданы» в свёрнутом виде только шумит, а поставить их
 * можно в раскрытой панели.
 *
 * Разметка на span, а не div: узел рендерится внутри <button> аккордеона, где
 * допустим только phrasing content.
 */
async function CollapsedSummary({
  group,
  range,
  deltas,
}: {
  group: Group
  range: UserRange | null
  deltas: Map<string, number>
}) {
  const t = await getTranslations('labs')
  const analyte = getAnalyte(isOtherGroup(group) ? 'other' : group.key)
  const latest = latestRow(group.rows)

  // Границы — в той единице, в которой их задали. У «другого» коридора нет по
  // построению (ключ (user_id, analyte) склеил бы кастомные показатели), у
  // остальных он может быть просто не задан.
  const bounds =
    range && analyte
      ? t('range.compact', {
          min: numberFmt.format(range.min),
          max: numberFmt.format(range.max),
          unit: unitLabel(analyte, range.unitCode),
        })
      : null

  return (
    <span className="flex items-center justify-between gap-3">
      <span className="min-w-0">
        <span className="block truncate font-heading text-xl text-foreground/70">
          {group.title}
        </span>
        {bounds && (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {bounds}
          </span>
        )}
      </span>

      {latest && latest.value != null && (
        <span className="flex shrink-0 items-baseline gap-2">
          <span className="text-lg text-foreground">
            {formatNumber(latest.value)}
          </span>
          <span className="text-sm text-foreground/60">
            {displayUnit(latest)}
          </span>
          <Delta
            value={deltas.get(latest.id)}
            unit={displayUnit(latest)}
            showUnit={false}
          />
        </span>
      )}
    </span>
  )
}

// ── Карточка активного показателя ────────────────────────────────────────────

/**
 * Шапка раскрытой панели: крупное значение последнего замера, пилюля положения
 * относительно коридора и подпись «дельта + тренд».
 *
 * ⚠️ Приложение НЕ оценивает значения. Здесь три факта и ни одного суждения:
 * сколько сейчас, где это относительно ГРАНИЦ, КОТОРЫЕ ЗАДАЛ САМ ЧЕЛОВЕК, и
 * куда движется ряд. Ни «в норме», ни «стабильно», ни «хорошо» — направление
 * показываем, валентность нет. Тот же принцип, что у пилюли (2d) и дельты (2e):
 * для эстрадиола и тестостерона одно и то же движение означает
 * противоположное, и оценивать за человека мы не вправе.
 *
 * Серверный компонент: getTranslations и вся арифметика идут на сервере, на
 * клиент уезжает только пилюля (ей нужен useTranslations).
 */
async function MetricSummary({
  group,
  range,
  deltas,
}: {
  group: Group
  range: UserRange | null
  deltas: Map<string, number>
}) {
  const t = await getTranslations('labs')
  const analyte = getAnalyte(isOtherGroup(group) ? 'other' : group.key)

  const latest = latestRow(group.rows)
  if (!latest || latest.value == null) return null

  // Положение считает positionInRange, здесь ничего не вычисляется заново.
  // Отдаём ИСХОДНЫЕ value/unit — функция сама приведёт значение к единице
  // коридора, а не наоборот.
  const position =
    range && analyte
      ? positionInRange(latest.value, latest.unit ?? '', range, analyte)
      : null

  // Тренд — по датированным точкам группы, тот же массив, что кормит график.
  // Имена полей MeasuredPoint совпадают с LabResultRow, перекладывать нечего.
  const trend = analyte
    ? computeLabTrend(
        group.rows
          .filter((r) => r.measured_at != null && r.value != null)
          .map((r) => ({
            value: r.value!,
            unit: r.unit ?? '',
            measured_at: r.measured_at!,
          })),
        analyte,
      )
    : null

  const delta = deltas.get(latest.id)

  // Первая часть подписи: когда и насколько изменилось. Дельты может не быть
  // (самый старый замер, несопоставимые единицы) — тогда остаётся только дата.
  const factParts = [
    latest.measured_at ? formatDate(latest.measured_at, t('noDate')) : null,
    delta === undefined
      ? null
      : t('metric.deltaToPrev', {
          delta: deltaFmt.format(delta),
          unit: displayUnit(latest),
        }),
  ].filter((part): part is string => part !== null)

  // Вторая часть — серия. Только up/down: flat это не движение, а его
  // отсутствие, и дельта «0» рядом уже сказала то же самое.
  const trendText =
    trend && trend.direction !== 'flat'
      ? t(`trend.${trend.direction}`, { n: String(trend.streak + 1) })
      : null

  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <p className="flex items-baseline gap-2">
          <span className="text-[54px] leading-[0.86] text-foreground">
            {formatNumber(latest.value)}
          </span>
          <span className="text-sm text-foreground/60">
            {displayUnit(latest)}
          </span>
        </p>

        <LabPositionPill position={position} />
      </div>

      {(factParts.length > 0 || trendText) && (
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {factParts.join(' · ')}
          {trendText ? `${factParts.length > 0 ? '. ' : ''}${trendText}` : ''}
        </p>
      )}
    </div>
  )
}

/**
 * Последний замер показателя: самый свежий по measured_at, тай-брейк по
 * created_at.
 *
 * Недатированные в расчёт не идут, пока есть хоть один датированный: у них нет
 * положения во времени, и назвать такой замер «последним» было бы выдумкой.
 * Если датированных нет вовсе — берём самый поздний по created_at, иначе
 * крупное значение не показать вообще.
 */
function latestRow(rows: LabResultRow[]): LabResultRow | null {
  const withValue = rows.filter((r) => r.value != null)
  const dated = withValue.filter((r) => r.measured_at != null)
  const pool = dated.length > 0 ? dated : withValue
  if (pool.length === 0) return null

  return pool.reduce((a, b) => {
    const am = a.measured_at ?? ''
    const bm = b.measured_at ?? ''
    if (am !== bm) return am > bm ? a : b
    return String(a.created_at) >= String(b.created_at) ? a : b
  })
}

// ── Группировка ──────────────────────────────────────────────────────────────

interface Group {
  key: string
  title: string
  rows: LabResultRow[]
}

function groupByAnalyte(rows: LabResultRow[]): Group[] {
  const map = new Map<string, Group>()

  for (const row of rows) {
    const analyte = row.analyte ?? 'other'
    const isOther = analyte === 'other'
    const key = isOther ? `other:${row.analyte_custom_name ?? ''}` : analyte
    const existing = map.get(key)
    if (existing) {
      existing.rows.push(row)
    } else {
      map.set(key, { key, title: groupTitle(row), rows: [row] })
    }
  }

  const order = (g: Group): number => {
    const code = g.key.startsWith('other:') ? 'other' : g.key
    const idx = ANALYTES.findIndex((a) => a.code === code)
    return idx === -1 ? ANALYTES.length : idx
  }
  return [...map.values()].sort((a, b) => order(a) - order(b))
}

/**
 * Какой показатель раскрыт по умолчанию — тот, куда попала САМАЯ СВЕЖАЯ по
 * created_at запись, то есть последняя, которую человек вносил.
 *
 * Не «первый по каталогу» и не «с самым свежим measured_at»: дату замера
 * можно не указывать вовсе или вписать задним числом, а created_at всегда
 * есть и всегда означает «вот с этим я работал только что».
 *
 * Фолбэк — первая группа по порядку каталога.
 */
function latestGroupKey(groups: Group[]): string | null {
  let bestKey: string | null = null
  let bestCreatedAt = ''

  for (const group of groups) {
    for (const row of group.rows) {
      const createdAt = String(row.created_at)
      if (createdAt > bestCreatedAt) {
        bestCreatedAt = createdAt
        bestKey = group.key
      }
    }
  }

  return bestKey ?? groups[0]?.key ?? null
}

/**
 * Группа «другого»: ключ вида other:<название>. Коридор для неё не
 * поддержан — (user_id, analyte) склеил бы разные кастомные показатели.
 */
function isOtherGroup(group: Group): boolean {
  return group.key.startsWith('other:')
}

function groupTitle(row: LabResultRow): string {
  if ((row.analyte ?? 'other') === 'other') {
    return row.analyte_custom_name?.trim() || getAnalyte('other')?.name || 'Другое'
  }
  return getAnalyte(row.analyte!)?.name ?? row.analyte!
}

/**
 * Точка входа в редактирование — отдельная иконка, а НЕ ссылка на всю строку.
 *
 * Ведёт на правку СДАЧИ, а не отдельного показателя: дата, заметка и бланк
 * принадлежат сдаче, и править их по одному показателю значило бы менять их
 * у соседей вслепую. Поэтому и у сдачи «только бланк» карандаш теперь есть —
 * session_id есть у любой записи.
 *
 * У трёх показателей одной сдачи будет три карандаша на один экран. Это
 * намеренно: тап у эстрадиола открывает ту сдачу, из которой он взялся, и
 * сразу видно, что дата и бланк общие для всех трёх.
 *
 * Обернуть строку целиком нельзя: внутри неё живут кнопки раскрытия заметки и
 * бланка. Интерактивный элемент внутри ссылки — невалидная разметка, и тап по
 * заметке уводил бы на другой экран вместо того, чтобы её показать.
 */
function EditLink({ id, label }: { id: string; label: string }) {
  return (
    <Link
      href={`/labs/session/${id}/edit`}
      aria-label={label}
      title={label}
      // Тач-зона больше глифа: -m-2/p-2 дают 32px вокруг иконки 16px.
      className="-m-2 flex size-[38px] items-center justify-center text-foreground/35 transition-colors hover:text-foreground/70"
    >
      <PencilIcon className="size-4" strokeWidth={1.8} />
    </Link>
  )
}

// ── Пересчёт в опорную единицу ───────────────────────────────────────────────

/**
 * Значение замера в ОПОРНОЙ единице показателя — для строки «≈ 120 пг/мл» под
 * введённым числом.
 *
 * ⚠️ Это ПРОИЗВОДНОЕ число, а не второе измерение. Человек сдавал анализ один
 * раз и получил одно значение в одной единице; всё остальное — арифметика,
 * которую мы делаем за него для удобства сравнения. Отсюда «≈» и приглушённый
 * мелкий шрифт: введённое значение остаётся крупным и первичным, искажать его
 * нельзя, а пересчёт не должен выглядеть равноправным фактом.
 *
 * Опорная единица — дефолтная у аналита (units[0]), та же, с которой
 * открывается график. Так две записи одного показателя в разных единицах
 * можно сравнить глазами, не трогая ни исходники, ни переключатель.
 *
 * null (строки не будет) в четырёх случаях:
 *   • замер уже введён в опорной единице — сравнивать не с чем;
 *   • у показателя опорной единицы нет вовсе ('other' с пустым units);
 *   • единицы несопоставимы — convertStrict отдаёт null, и выдумывать
 *     коэффициент мы не станем;
 *   • у строки нет значения или показателя.
 */
function approxInCanonical(
  row: LabResultRow,
): { value: string; unit: string } | null {
  if (row.value == null || !row.analyte) return null

  const analyte = getAnalyte(row.analyte)
  if (!analyte) return null

  const canonical = defaultUnitCode(analyte)
  if (!canonical) return null

  const unit = row.unit ?? ''
  if (unit.trim() === canonical) return null

  // Строго convertStrict: нестрогий convertValue при невозможности перевода
  // молча вернул бы исходное число, и «≈ 440 пг/мл» под «440 пмоль/л»
  // читалось бы как факт, будучи бессмыслицей.
  const converted = convertStrict(row.value, unit, canonical, analyte)
  if (converted === null) return null

  return {
    value: numberFmt.format(converted),
    unit: unitLabel(analyte, canonical),
  }
}

// ── Дельта к предыдущему замеру ──────────────────────────────────────────────

/**
 * Разница с предыдущим по дате замером — по строке на каждый показатель.
 * Ключ Map — id строки (он уникален по всей выдаче, поэтому одной карты хватает
 * на все группы).
 *
 * Считает computeLabDelta из stats.ts, здесь ничего не вычисляется заново.
 * Единица — та, в которой строка ПОКАЗАНА, то есть введённая юзером: соседа
 * функция приведёт к ней сама, через convertStrict. Значит «+34» под значением
 * в пг/мл и правда означает 34 пг/мл, даже если прошлый замер вводился в
 * пмоль/л.
 *
 * Дельты не будет у трёх видов строк, и все три — молча, без прочерка:
 *   • у самого старого датированного замера соседа нет;
 *   • у недатированных: положения во времени нет, и MeasuredPoint.measured_at
 *     объявлен как string, а не string | null — тип такую точку не соберёт;
 *   • когда единицы несопоставимы (у 'other' с разными свободными единицами) —
 *     computeLabDelta отдаёт null, и это правильнее выдуманного числа.
 */
function computeDeltas(groups: Group[]): Map<string, number> {
  const out = new Map<string, number>()

  for (const group of groups) {
    // Сортируем сами, хотя listLabResults уже отдаёт по убыванию даты: тот же
    // приём, что в LabChart. Перепутанный порядок дал бы дельту к неверному
    // соседу молча, а это число рядом со словом «эстрадиол».
    const dated = group.rows
      .filter((r) => r.measured_at != null && r.value != null)
      .sort(
        (a, b) =>
          b.measured_at!.localeCompare(a.measured_at!) ||
          String(b.created_at).localeCompare(String(a.created_at)),
      )

    // Новые сверху → сосед по времени это следующий элемент массива.
    for (let i = 0; i < dated.length - 1; i++) {
      const cur = dated[i]
      const prev = dated[i + 1]
      const analyte = getAnalyte(cur.analyte ?? 'other')
      if (!analyte) continue

      const delta = computeLabDelta(
        { value: cur.value!, unit: cur.unit ?? '', measured_at: cur.measured_at! },
        { value: prev.value!, unit: prev.unit ?? '', measured_at: prev.measured_at! },
        cur.unit ?? '',
        analyte,
      )
      if (delta !== null) out.set(cur.id, delta)
    }
  }

  return out
}

/**
 * Дельта — ФАКТ о данных: разница двух чисел. Не оценка, поэтому здесь нет ни
 * «хорошо», ни «плохо», только знак и число.
 *
 * Различение направления сделано насыщенностью, а НЕ цветом. В макете рост
 * зелёный, но у нас, во-первых, в палитре нет зелёного, пригодного для текста
 * 11px (--brand-tab-today и --brand-glow-green — светлые заливки, на кремовом фоне
 * такой текст не прочитать), а во-вторых зелёный «вверх» читался бы как
 * одобрение — и для тестостерона или пролактина это было бы ровно наоборот.
 * Цвет к направлению вернём, когда для него появится осмысленный токен.
 */
function Delta({
  value,
  unit,
  showUnit = true,
}: {
  value: number | undefined
  /**
   * Единица СВОЕЙ строки — та же, что показана у значения рядом.
   *
   * Обязательный проп даже при showUnit={false}: так новая точка рендера не
   * сможет появиться, не объявив, в чём вообще её дельта. Скрыть подпись —
   * решение места, а не повод забыть про единицу.
   */
  unit: string
  /**
   * Показывать ли подпись единицы.
   *
   * По умолчанию да: голое «+108» не говорит, чего именно плюс сто восемь, а
   * рядом стоит график со своим переключателем пг/мл ↔ пмоль/л, за которым
   * дельта намеренно НЕ следует (решение 2e — она в единице своей строки).
   * Без подписи это выглядит как рассинхрон, хотя таковым не является.
   *
   * Выключается там, где сбить некому: в свёрнутой строке графика рядом нет,
   * а единица значения и дельты совпадает — «пг/мл пг/мл» подряд было бы
   * шумом без пользы.
   */
  showUnit?: boolean
}) {
  if (value === undefined) return null
  return (
    <span
      className={
        value > 0
          ? 'text-xs font-semibold text-foreground/80'
          : 'text-xs font-semibold text-muted-foreground'
      }
    >
      {deltaFmt.format(value)}
      {/* Единица приглушённее и мельче самого числа — как у значения выше. */}
      {showUnit && (
        <span className="ml-1 font-normal text-foreground/50">{unit}</span>
      )}
    </span>
  )
}

const deltaFmt = new Intl.NumberFormat('ru-RU', {
  maximumFractionDigits: 2,
  signDisplay: 'exceptZero',
})

// ── Форматирование ───────────────────────────────────────────────────────────

function ChartFromRows({
  rows,
  analyteCode,
  range,
}: {
  rows: LabResultRow[]
  analyteCode: string
  range: UserRange | null
}) {
  const dated = rows.filter((r) => r.measured_at != null && r.value != null)

  // Порог опущен со «двух точек» до «есть что показать».
  //
  // Было `dated.length < 2` — то есть заданный коридор не показывался, пока
  // человек не наберёт два датированных замера. Это та же связь «коридор ↔
  // число замеров», которую мы вычищали из копирайта («появится после трёх»),
  // только выраженная поведением: границы заданы, а увидеть их нельзя.
  // Коридор от количества замеров не зависит ни в текстах, ни в UI.
  //
  // Полоса рисуется и при нуле точек: домен графика тогда строится по самим
  // границам (в lab-chart Math.min на пустом массиве даёт Infinity и корректно
  // уступает коридору).
  if (dated.length === 0 && !range) return null

  // ⚠️ Этот массив — ПОЛНЫЙ, без окна. Обрезка по периоду живёт исключительно
  // внутри LabMetricChart и наружу не выходит. Сводить этот filter с тем, что
  // делает MetricSummary для тренда, НЕЛЬЗЯ: общий массив означал бы, что
  // период протекает в карточку и «растёт N-й замер подряд» начинает зависеть
  // от положения ползунка.
  //
  // today считаем на сервере и передаём вниз: обёртка рендерится и в SSR, и на
  // клиенте, а таймзоны у них разные — разъехавшийся new Date() дал бы
  // рассинхрон гидратации.
  return (
    <LabMetricChart
      analyteCode={analyteCode}
      range={range}
      today={format(new Date(), 'yyyy-MM-dd')}
      rows={dated.map((r) => ({
        value: r.value!,
        unit: r.unit ?? '',
        measuredAt: r.measured_at!,
      }))}
    />
  )
}

function displayUnit(row: LabResultRow): string {
  const analyte = row.analyte ? getAnalyte(row.analyte) : undefined
  const unit = row.unit ?? ''
  return analyte ? unitLabel(analyte, unit) : unit
}

const numberFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 })
function formatNumber(value: number | null): string {
  return value == null ? '' : numberFmt.format(value)
}

function formatDate(ymd: string | null, noDateLabel: string): string {
  if (!ymd) return noDateLabel
  return format(parse(ymd, 'yyyy-MM-dd', new Date()), 'd MMMM yyyy', { locale: ru })
}
