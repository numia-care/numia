import { format, parse } from 'date-fns'
import { ru } from 'date-fns/locale'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'

import { buttonVariants } from '@/components/ui/button'
import { ANALYTES, getAnalyte, unitLabel } from '@/lib/labs/catalog'
import { listLabResults, type LabResultRow } from '@/lib/labs/queries'

// История анализов: записи сгруппированы по показателю (порядок каталога),
// внутри — по дате (новые сверху, как отдаёт запрос). Числа открыты, контент
// заметки/фото не показываем — только бейдж наличия. График динамики —
// следующий, отдельный фрагмент (этот список его НЕ содержит).
export default async function LabsPage() {
  const t = await getTranslations('labs')
  const rows = await listLabResults()

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

      {rows.length === 0 ? (
        <div className="rounded-2xl bg-card p-8 text-center ring-1 ring-border">
          <div className="mb-3 text-3xl">✦</div>
          <p className="mx-auto max-w-sm text-foreground/80">{t('empty')}</p>
        </div>
      ) : (
        <div className="space-y-10">
          {groupByAnalyte(rows).map((group) => (
            <section key={group.key}>
              <h2 className="mb-4 font-heading text-xl text-foreground/70">
                {group.title}
              </h2>
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
                      dateTime={row.measured_at}
                    >
                      {formatDate(row.measured_at)}
                    </time>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
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

// Группируем по показателю. Каталожные — в порядке каталога; «другое» —
// по своему названию (разные кастомные показатели не сваливаем в кучу),
// отдельными группами после каталожных.
function groupByAnalyte(rows: LabResultRow[]): Group[] {
  const map = new Map<string, Group>()

  for (const row of rows) {
    const isOther = row.analyte === 'other'
    const key = isOther ? `other:${row.analyte_custom_name ?? ''}` : row.analyte
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
  if (row.analyte === 'other') {
    return row.analyte_custom_name?.trim() || getAnalyte('other')?.name || 'Другое'
  }
  return getAnalyte(row.analyte)?.name ?? row.analyte
}

// ── Форматирование ───────────────────────────────────────────────────────────

function displayUnit(row: LabResultRow): string {
  const analyte = getAnalyte(row.analyte)
  // Для каталожных — подпись по коду единицы; для «другое» — строка как есть.
  return analyte ? unitLabel(analyte, row.unit) : row.unit
}

const numberFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 })
function formatNumber(value: number): string {
  return numberFmt.format(value)
}

function formatDate(ymd: string): string {
  return format(parse(ymd, 'yyyy-MM-dd', new Date()), 'd MMMM yyyy', { locale: ru })
}
