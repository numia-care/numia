import { format, parse } from 'date-fns'
import { ru } from 'date-fns/locale'
import { ImageIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { LabChart } from '@/components/labs/lab-chart'
import { LabNote } from '@/components/labs/lab-note'
import { ANALYTES, getAnalyte, unitLabel } from '@/lib/labs/catalog'
import type { LabResultRow } from '@/lib/labs/queries'

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

  return (
    <div className="space-y-10">
      {groupByAnalyte(numeric).map((group) => (
        <section key={group.key}>
          <h2 className="mb-4 font-heading text-xl text-foreground/70">
            {group.title}
          </h2>

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
                    {/* Фото по-прежнему просто бейджем: его блоб лежит в
                        Storage, открытие — отдельная задача. */}
                    {row.has_photo && (
                      <span className="text-xs text-foreground/40">
                        {t('photoBadge')}
                      </span>
                    )}
                  </div>
                  <time
                    className="shrink-0 text-sm text-foreground/60"
                    dateTime={row.measured_at ?? undefined}
                  >
                    {formatDate(row.measured_at, t('noDate'))}
                  </time>
                </div>

                <LabNote ciphertext={row.note_ciphertext} />
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
                  <time
                    className="shrink-0 text-sm text-foreground/60"
                    dateTime={row.measured_at ?? undefined}
                  >
                    {formatDate(row.measured_at, t('noDate'))}
                  </time>
                </div>

                <LabNote ciphertext={row.note_ciphertext} />
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
