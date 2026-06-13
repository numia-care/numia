import { getTranslations } from 'next-intl/server'
import Link from 'next/link'

import { buttonVariants } from '@/components/ui/button'
import { PushPromptCard } from '@/components/push/push-prompt-card'
import { MedicationCard } from '@/components/tracker/medication-card'
import { TodaySection } from '@/components/tracker/today-section'
import { listActiveMedications } from '@/lib/tracker/queries'

export default async function TrackerPage() {
  const t = await getTranslations('tracker')
  const meds = await listActiveMedications()

  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-10 sm:py-14">
      <header className="mb-8 flex items-center justify-between gap-4">
        <h1 className="font-heading text-3xl text-foreground sm:text-4xl">
          {t('title')}
        </h1>
        <Link
          href="/tracker/new"
          className={buttonVariants({ size: 'lg' })}
        >
          {t('addButton')}
        </Link>
      </header>

      {meds.length > 0 && <PushPromptCard />}
      {meds.length > 0 && <TodaySection />}

      {meds.length === 0 ? <EmptyState /> : <List meds={meds} />}
    </div>
  )
}

function List({
  meds,
}: {
  meds: Awaited<ReturnType<typeof listActiveMedications>>
}) {
  return (
    <div className="grid gap-3">
      {meds.map((m) => (
        <MedicationCard key={m.id} med={m} />
      ))}
    </div>
  )
}

async function EmptyState() {
  const t = await getTranslations('tracker')

  return (
    <div className="rounded-2xl bg-card p-8 text-center ring-1 ring-border">
      <div className="mb-3 text-3xl">{t('emptyIcon')}</div>
      <p className="mx-auto max-w-sm text-foreground/80">
        {t('emptyText')}
      </p>
      <div className="mt-6">
        <Link
          href="/tracker/new"
          className={buttonVariants({ size: 'lg' })}
        >
          {t('emptyButton')}
        </Link>
      </div>
    </div>
  )
}
