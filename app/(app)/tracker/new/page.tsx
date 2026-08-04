import { getTranslations } from 'next-intl/server'
import Link from 'next/link'

import { MedicationForm } from '@/components/tracker/medication-form'

export default async function NewMedicationPage() {
  const t = await getTranslations('tracker.new')

  return (
    <div className="page-shell py-10 sm:py-14">
      <header className="mb-6">
        <Link
          href="/tracker"
          className="mb-3 inline-block text-sm text-muted-foreground hover:text-foreground"
        >
          {t('backLink')}
        </Link>
        <h1 className="font-heading text-3xl text-foreground sm:text-4xl">
          {t('title')}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('subtitle')}
        </p>
      </header>

      <MedicationForm />
    </div>
  )
}
