import { format, parse } from 'date-fns'
import { ru } from 'date-fns/locale'
import { ImageIcon, LineChartIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'

import { ExampleChart } from '@/components/labs/example-chart'
import { LabChart } from '@/components/labs/lab-chart'
import { buttonVariants } from '@/components/ui/button'
import { ANALYTES, getAnalyte, unitLabel } from '@/lib/labs/catalog'
import { listLabResults, type LabResultRow } from '@/lib/labs/queries'
import { cn } from '@/lib/utils'

// История анализов: числовые записи сгруппированы по показателю (порядок
// каталога), внутри по дате (новые сверху). Записи «только фото бланка» —
// отдельной секцией. Числа открыты; контент заметки/фото не показываем, только
// бейдж наличия. График динамики строится по точкам с датой.
export default async function LabsPage() {
  const t = await getTranslations('labs')
  const { numeric, photoOnly } = await listLabResults()
  const isEmpty = numeric.length === 0 && photoOnly.length === 0

  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-10 sm:py-14">
      <header className="mb-8 flex items-center justify-between gap-4">
        <h1 className="font-heading text-3xl text-foreground sm:text-4xl">
          {t('title')}
        </h1>
        <Link href="/labs/new" className={buttonVariants({ size: 'lg' })}>
          {t('addButton')}
        </Link>
      </header>

      {isEmpty ? (
        <EmptyState />
      ) : (
        <div className="space-y-10">
          {groupByAnalyte(numeric).map((group) => (
            <section key={group.key}>
              <h2 className="mb-4 font-heading text-xl text-foreground/70">
                {group.title}
              </h2>

              {/* График динамики — от 2 точек С ДАТОЙ. Без коридоров. */}
              <ChartFromRows rows={group.rows} />

              <div className="space-y-2">
                {group.rows.map((row) => (
                  <div
                    key={row.id}
                    className="flex items-baseline justify-between gap-4 rounded-2xl bg-card px-4 py-3 ring-1 ring-border"
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="text-lg text-foreground">
                        {formatNumber(row.value)}
                      </span>
                      <span className="text-sm text-foreground/60">
                        {displayUnit(row)}
                      </span>
                      {(row.has_note || row.has_photo) && (
                        <span className="text-xs text-foreground/40">
                          {[
                            row.has_note ? t('noteBadge') : null,
                            row.has_photo ? t('photoBadge') : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
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
                ))}
              </div>
            </section>
          ))}

          {/* Снимки бланков без ручного ввода чисел. */}
          {photoOnly.length > 0 && (
            <section>
              <h2 className="mb-4 font-heading text-xl text-foreground/70">
                {t('photoSectionTitle')}
              </h2>
              <div className="space-y-2">
                {photoOnly.map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center justify-between gap-4 rounded-2xl bg-card px-4 py-3 ring-1 ring-border"
                  >
                    <div className="flex items-center gap-2 text-foreground">
                      <ImageIcon className="size-4 text-moss" />
                      <span className="text-sm">{t('photoOnlyCard')}</span>
                      {row.has_note && (
                        <span className="text-xs text-foreground/40">
                          {t('noteBadge')}
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
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

// ── Пустой экран: ценность + пример графика + два явных пути ──────────────────

async function EmptyState() {
  const t = await getTranslations('labs')
  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-card p-6 text-center ring-1 ring-border">
        <h2 className="font-heading text-2xl text-foreground">
          {t('emptyTitle')}
        </h2>
        <p className="mx-auto mt-2 max-w-md leading-relaxed text-foreground/80">
          {t('emptyText')}
        </p>

        {/* Пример-заглушка: как будет выглядеть динамика. */}
        <div className="mt-5 rounded-2xl bg-background/60 p-4 ring-1 ring-border">
          <p className="mb-2 text-left text-xs uppercase tracking-wide text-muted-foreground">
            {t('emptyExampleLabel')}
          </p>
          <ExampleChart />
        </div>
      </div>

      {/* Два явных пути добавления. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          href="/labs/new"
          className={cn(
            buttonVariants({ size: 'lg' }),
            'h-auto flex-col items-center gap-1 py-4',
          )}
        >
          <LineChartIcon className="size-5" />
          {t('emptyByValues')}
        </Link>
        <Link
          href="/labs/new?mode=photo"
          className={cn(
            buttonVariants({ variant: 'outline', size: 'lg' }),
            'h-auto flex-col items-center gap-1 py-4',
          )}
        >
          <ImageIcon className="size-5" />
          {t('emptyByPhoto')}
        </Link>
      </div>
    </div>
  )
}

// ── Группировка ──────────────────────────────────────────────────────────────

interface Group {
  key: string
  title: string
  rows: LabResultRow[]
}

// Группируем числовые записи по показателю. Каталожные — в порядке каталога;
// «другое» — по своему названию, отдельными группами после каталожных.
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
  // rows внутри групп уже по дате desc (порядок запроса сохраняется при push).
  return [...map.values()].sort((a, b) => order(a) - order(b))
}

function groupTitle(row: LabResultRow): string {
  if ((row.analyte ?? 'other') === 'other') {
    return row.analyte_custom_name?.trim() || getAnalyte('other')?.name || 'Другое'
  }
  return getAnalyte(row.analyte!)?.name ?? row.analyte!
}

// ── Форматирование ───────────────────────────────────────────────────────────

// График строим только по точкам с датой (без даты не разместить на оси X);
// нужно ≥2 таких точки.
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
  // Для каталожных — подпись по коду единицы; иначе строка как есть.
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
