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

// Презентационный список истории анализов: числовые записи сгруппированы по
// показателю (порядок каталога), внутри — по дате (новые сверху), с графиком
// динамики от 2 точек. Записи «только фото бланка» — отдельной секцией.
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

  return (
    <div className="space-y-10">
      {groupByAnalyte(numeric).map((group) => (
        <section key={group.key}>
          <h2 className="mb-4 font-heading text-xl text-foreground/70">
            {group.title}
          </h2>

          {/* Коридор — только у каталожных показателей. У «другого» ключ
              группы вида other:<название>, и коридор для него не поддержан:
              (user_id, analyte) склеил бы разные кастомные показатели. */}
          {!group.key.startsWith('other:') && (
            <LabRangeEditor
              analyteCode={group.key}
              range={ranges?.[group.key] ?? null}
              unavailable={ranges === null}
            />
          )}

          <ChartFromRows rows={group.rows} />

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

// ── Форматирование ───────────────────────────────────────────────────────────

function ChartFromRows({ rows }: { rows: LabResultRow[] }) {
  const dated = rows.filter((r) => r.measured_at != null && r.value != null)
  if (dated.length < 2) return null
  return (
    <LabChart
      analyteCode={dated[0].analyte ?? 'other'}
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
