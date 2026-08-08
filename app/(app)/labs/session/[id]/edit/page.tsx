import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { LabDeleteButton } from '@/components/labs/lab-delete-button'
import {
  LabForm,
  type LabFormRow,
  type LabFormValues,
} from '@/components/labs/lab-form'
import { ANALYTES, defaultUnitCode, getAnalyte } from '@/lib/labs/catalog'
import { getLabSessionForEdit, type LabSessionForEdit } from '@/lib/labs/queries'

// Правка СДАЧИ целиком: дата, заметка и бланк общие, показателей сколько
// угодно. Единица правки — сдача, а не отдельный показатель, потому что
// общие поля физически принадлежат ей: бланк один, на нём сразу все значения.
//
// Отсюда же исчезла нужда в предупреждении «изменится у N показателей» —
// все показатели видны на экране, контекст не надо описывать словами.
//
// Сдача «только бланк» (ноль показателей) открывается этим же экраном: она
// перестала быть частным случаем.
//
// Заметку и фото сервер расшифровать не может — отдаём форме шифротекст,
// она разбирается на клиенте (PIN-гейт заметки, мягкий PIN фото).
export default async function EditLabSessionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const session = await getLabSessionForEdit(id)
  if (!session) notFound()

  const t = await getTranslations('labs.edit')

  return (
    <div className="page-shell py-10 sm:py-14">
      <header className="mb-6">
        <Link
          href="/tracker?tab=analyses"
          className="mb-3 inline-block text-sm text-muted-foreground hover:text-foreground"
        >
          {t('backLink')}
        </Link>
        <h1 className="font-heading text-3xl text-foreground sm:text-4xl">
          {t('title')}
        </h1>
      </header>

      <LabForm
        mode="edit"
        sessionId={session.id}
        initialValues={toFormValues(session)}
      />

      {/* Удаление пока сносит ОДИН показатель — переключение на удаление сдачи
          целиком идёт следующим заходом (5b-2). У сдачи без показателей
          удалять по строке нечего, поэтому кнопку там не показываем. */}
      {session.rows.length > 0 && (
        <div className="mt-10 border-t border-border pt-6">
          <LabDeleteButton
            id={session.rows[0].id}
            blankPhotoPath={session.blank_photo_path}
          />
        </div>
      )}
    </div>
  )
}

/**
 * Сдача из БД → значения формы.
 *
 * Тонкости раскладки:
 *   • Сдача без показателей — это «только бланк», formMode='photo'.
 *   • У analyte='other' единица хранится свободной строкой: она едет в
 *     customUnit, а не в unitCode (там код из каталога).
 *   • measured_at = null значит «дата не указана» → noDate=true, а в поле
 *     даты кладём сегодняшнюю, чтобы календарь не открывался пустым, если
 *     галочку снимут.
 *   • Заметка НЕ расшифровывается: отдаём шифротекст как есть.
 */
function toFormValues(session: LabSessionForEdit): LabFormValues {
  return {
    formMode: session.rows.length === 0 ? 'photo' : 'values',
    rows: session.rows.map(toFormRow),
    date: session.measured_at ?? today(),
    noDate: session.measured_at == null,
    noteCiphertext: session.note_ciphertext,
    // Путь и IV — форма по ним скачает и расшифрует картинку на клиенте.
    // Ходят парой (констрейнт lab_sessions_photo_path_iv_together).
    blankPhotoPath: session.blank_photo_path,
    blankPhotoIv: session.blank_photo_iv,
  }
}

function toFormRow(row: LabSessionForEdit['rows'][number]): LabFormRow {
  const analyte = row.analyte ? getAnalyte(row.analyte) : undefined
  const isOther = Boolean(analyte?.allowCustom)

  return {
    id: row.id,
    analyteCode: analyte?.code ?? ANALYTES[0].code,
    customName: row.analyte_custom_name ?? '',
    value: row.value == null ? '' : String(row.value),
    unitCode: isOther
      ? (defaultUnitCode(analyte ?? ANALYTES[0]) ?? '')
      : (row.unit ?? defaultUnitCode(analyte ?? ANALYTES[0]) ?? ''),
    customUnit: isOther ? (row.unit ?? '') : '',
  }
}

function today(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}
