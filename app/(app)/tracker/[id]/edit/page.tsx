import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { MedicationForm } from '@/components/tracker/medication-form'
import type { MedicationFormValues } from '@/components/tracker/medication-form-schema'
import { getMedicationForEdit, type MedicationRow } from '@/lib/tracker/queries'

export default async function EditMedicationPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const med = await getMedicationForEdit(id)
  if (!med) notFound()

  const t = await getTranslations('tracker.edit')

  return (
    <div className="page-shell py-10 sm:py-14">
      <header className="mb-8">
        <Link
          href="/tracker"
          className="mb-3 inline-block text-sm text-muted-foreground hover:text-foreground"
        >
          {t('backLink')}
        </Link>
        <h1 className="font-heading text-3xl text-foreground sm:text-4xl">
          {t('title')}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{med.name}</p>
      </header>

      <MedicationForm
        mode="edit"
        editId={id}
        initialValues={medicationToFormValues(med)}
      />
    </div>
  )
}

/**
 * Маппинг ряда БД → значения формы.
 * Schedule уже распарсен через parseSchedule в queries. notes: null → ''
 * (форма не любит null в текстовых полях).
 */
function medicationToFormValues(med: MedicationRow): MedicationFormValues {
  return {
    name: med.name,
    kind: med.kind,
    form: med.form,
    dose_amount: med.dose_amount,
    dose_unit: med.dose_unit,
    schedule: med.schedule,
    start_date: med.start_date,
    notes: med.notes ?? '',
  }
}
