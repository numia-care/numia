import { format, parse } from 'date-fns'
import { ru } from 'date-fns/locale'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { LabDeleteButton } from '@/components/labs/lab-delete-button'
import { LabNote } from '@/components/labs/lab-note'
import { getAnalyte, unitLabel } from '@/lib/labs/catalog'
import { getLabResultForEdit, type LabResultForEdit } from '@/lib/labs/queries'

// Экран одного показателя. В ЭТОМ заходе — каркас: показывает запись и даёт
// её удалить. Форма редактирования приезжает следующим заходом (B), тогда
// сюда встанет <LabForm mode="edit" .../> по образцу /tracker/[id]/edit.
//
// Заметка показывается тем же раскрывающимся LabNote, что и в списке:
// расшифровать её можно только на клиенте, серверу шифротекст нечитаем.
export default async function EditLabResultPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const row = await getLabResultForEdit(id)
  if (!row) notFound()

  const t = await getTranslations('labs.edit')
  const tLabs = await getTranslations('labs')

  return (
    <div className="page-shell py-10 sm:py-14">
      <header className="mb-8">
        <Link
          href="/labs"
          className="mb-3 inline-block text-sm text-muted-foreground hover:text-foreground"
        >
          {t('backLink')}
        </Link>
        <h1 className="font-heading text-3xl text-foreground sm:text-4xl">
          {t('title')}
        </h1>
      </header>

      <div className="rounded-2xl bg-card px-4 py-4 ring-1 ring-border">
        <p className="text-sm text-foreground/60">{displayName(row, tLabs)}</p>

        {row.value != null && (
          <p className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl text-foreground">
              {numberFmt.format(row.value)}
            </span>
            <span className="text-sm text-foreground/60">
              {displayUnit(row)}
            </span>
          </p>
        )}

        <p className="mt-2 text-sm text-foreground/60">
          {formatDate(row.measured_at, tLabs('noDate'))}
        </p>

        {row.blank_photo_path && (
          <p className="mt-2 text-xs text-foreground/40">{tLabs('photoBadge')}</p>
        )}

        <LabNote ciphertext={row.note_ciphertext} />
      </div>

      {/* Форма редактирования — заход B. Пока только удаление. */}
      <div className="mt-8">
        <LabDeleteButton id={row.id} blankPhotoPath={row.blank_photo_path} />
      </div>
    </div>
  )
}

// Ниже — та же логика отображения, что в labs-history.tsx (groupTitle /
// displayUnit / formatDate). Сознательно продублирована, а не вынесена в
// общий модуль: в заходе B эта страница станет формой, и показывать она
// будет поля ввода, а не эти строки. Выносить общее ради временного каркаса
// значило бы создавать абстракцию, которая через заход исчезнет.

// Название показателя: из каталога, своё для analyte='other', либо «фото
// бланка» у записи без чисел.
function displayName(
  row: LabResultForEdit,
  tLabs: Awaited<ReturnType<typeof getTranslations>>,
): string {
  if (!row.analyte) return tLabs('photoOnlyCard')
  if (row.analyte === 'other') {
    return row.analyte_custom_name?.trim() || getAnalyte('other')?.name || 'Другое'
  }
  return getAnalyte(row.analyte)?.name ?? row.analyte
}

function displayUnit(row: LabResultForEdit): string {
  const analyte = row.analyte ? getAnalyte(row.analyte) : undefined
  const unit = row.unit ?? ''
  return analyte ? unitLabel(analyte, unit) : unit
}

const numberFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 })

function formatDate(ymd: string | null, noDateLabel: string): string {
  if (!ymd) return noDateLabel
  return format(parse(ymd, 'yyyy-MM-dd', new Date()), 'd MMMM yyyy', { locale: ru })
}
