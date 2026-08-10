import { format, parse } from 'date-fns'
import { ru } from 'date-fns/locale'
import { ImageIcon, PencilIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'

import { LabChart } from '@/components/labs/lab-chart'
import { LabNote } from '@/components/labs/lab-note'
import { LabPhoto } from '@/components/labs/lab-photo'
import { LabRangeEditor } from '@/components/labs/lab-range-editor'
import { ANALYTES, getAnalyte, unitLabel } from '@/lib/labs/catalog'
import { listLabRangesServer, type LabResultRow } from '@/lib/labs/queries'
import type { LabRanges } from '@/lib/labs/ranges'
import { computeLabDelta, type UserRange } from '@/lib/labs/stats'

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

  return (
    <div className="space-y-10">
      {groups.map((group) => (
        <section key={group.key}>
          <h2 className="mb-4 font-heading text-xl text-foreground/70">
            {group.title}
          </h2>

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
            {group.rows.map((row) => (
              // Карточка стала колонкой: значение и дата в верхней строке как
              // раньше, раскрытая заметка — под ними. Иначе развёрнутому тексту
              // некуда встать, он ломал бы ряд по базовой линии.
              <div
                key={row.id}
                className="rounded-2xl bg-card px-4 py-3 ring-1 ring-border"
              >
                <div className="flex items-baseline justify-between gap-4">
                  <div className="flex items-baseline gap-2">
                    <span className="text-lg text-foreground">
                      {formatNumber(row.value)}
                    </span>
                    <span className="text-sm text-foreground/60">
                      {displayUnit(row)}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Delta value={deltas.get(row.id)} />
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
            ))}
          </div>
        </section>
      ))}

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
 * 11px (--kai-tab-today и --kai-glow-green — светлые заливки, на кремовом фоне
 * такой текст не прочитать), а во-вторых зелёный «вверх» читался бы как
 * одобрение — и для тестостерона или пролактина это было бы ровно наоборот.
 * Цвет к направлению вернём, когда для него появится осмысленный токен.
 */
function Delta({ value }: { value: number | undefined }) {
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

  return (
    <LabChart
      analyteCode={analyteCode}
      range={range}
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
