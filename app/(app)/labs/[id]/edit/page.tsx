import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { LabDeleteButton } from '@/components/labs/lab-delete-button'
import { LabForm, type LabFormValues } from '@/components/labs/lab-form'
import { ANALYTES, defaultUnitCode, getAnalyte } from '@/lib/labs/catalog'
import { getLabResultForEdit, type LabResultForEdit } from '@/lib/labs/queries'

// Редактирование показателя. Калька с /tracker/[id]/edit: серверная страница
// читает ряд, notFound() если нет, маппит в значения формы.
//
// ОТЛИЧИЕ ОТ ФОРМЫ ПРЕПАРАТА: заметку сюда подставить нельзя — она E2E, и
// сервер её не читает. Отдаём форме ШИФРОТЕКСТ, форма расшифровывает его на
// клиенте при монтировании. Отсюда же PIN-гейт: у записи с заметкой без
// разблокированного хранилища форму открыть нечем, и LabForm уводит на /pin.
//
// Фото в этом заходе не редактируется (заход C), но и не страдает:
// updateLabResult не трогает колонки blank_photo_*.
export default async function EditLabResultPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const row = await getLabResultForEdit(id)
  if (!row) notFound()

  const t = await getTranslations('labs.edit')

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

      <LabForm mode="edit" editId={row.id} initialValues={toFormValues(row)} />

      {/* Удаление — из захода A, остаётся на этом же экране. Отделено от
          формы: это не часть сохранения, а отдельное необратимое действие. */}
      <div className="mt-10 border-t border-border pt-6">
        <LabDeleteButton id={row.id} blankPhotoPath={row.blank_photo_path} />
      </div>
    </div>
  )
}

/**
 * Ряд БД → значения формы.
 *
 * Тонкости раскладки:
 *   • Запись без числа — это «только фото бланка», у неё formMode='photo' и
 *     числовые поля не показываются. Значения для них всё равно заполняем
 *     дефолтами, чтобы форма не работала с пустым каталогом.
 *   • У analyte='other' единица хранится свободной строкой — она едет в
 *     customUnit, а не в unitCode (там код из каталога).
 *   • measured_at = null значит «дата не указана» → noDate=true, а в поле
 *     даты кладём сегодняшнюю, чтобы календарь не открывался пустым, если
 *     галочку снимут.
 *   • Заметка НЕ расшифровывается: отдаём шифротекст как есть.
 */
function toFormValues(row: LabResultForEdit): LabFormValues {
  const isNumeric = row.value != null
  const analyte = row.analyte ? getAnalyte(row.analyte) : undefined
  const isOther = Boolean(analyte?.allowCustom)

  return {
    formMode: isNumeric ? 'values' : 'photo',
    analyteCode: analyte?.code ?? ANALYTES[0].code,
    customName: row.analyte_custom_name ?? '',
    value: row.value == null ? '' : String(row.value),
    unitCode: isOther
      ? (defaultUnitCode(analyte ?? ANALYTES[0]) ?? '')
      : (row.unit ?? defaultUnitCode(analyte ?? ANALYTES[0]) ?? ''),
    customUnit: isOther ? (row.unit ?? '') : '',
    date: row.measured_at ?? today(),
    noDate: row.measured_at == null,
    noteCiphertext: row.note_ciphertext,
    // Путь и IV — форма по ним скачает и расшифрует картинку на клиенте.
    // Ходят парой (констрейнт blank_photo_path_iv_together).
    blankPhotoPath: row.blank_photo_path,
    blankPhotoIv: row.blank_photo_iv,
  }
}

function today(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}
