import { getTranslations } from 'next-intl/server'
import Link from 'next/link'

import { PushPromptCard } from '@/components/push/push-prompt-card'
import { AddLink } from '@/components/ui/add-link'
import { MedicationCard } from '@/components/tracker/medication-card'
import { TodaySection } from '@/components/tracker/today-section'
import { listActiveMedications } from '@/lib/tracker/queries'

// Экран «Препараты» по фрейму Кая (288:357 / 306:34): ✦ по центру сверху,
// заголовок 30px, тёмная круглая «+» справа, слоты и препараты — строки-пилюли.
export default async function TrackerPage() {
  const t = await getTranslations('tracker')
  const meds = await listActiveMedications()

  return (
    <div className="relative overflow-hidden">
      {/* Атмосферные пятна фона — как на дашборде, дешёвый CSS. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-36 left-1/2 h-80 w-[480px] -translate-x-1/2 rounded-full bg-white/70"
        style={{ filter: 'blur(90px)' }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-[-60px] left-[-80px] h-80 w-[460px] rounded-full bg-[#EAE0D0]/80"
        style={{ filter: 'blur(90px)' }}
      />

      <div className="relative mx-auto w-full max-w-2xl px-5 py-6 sm:py-10">
        <div className="text-center text-2xl text-foreground" aria-hidden>
          <span className="star-breathe">✦</span>
        </div>

        <header className="mb-6 mt-6 flex items-center justify-between gap-4">
          <h1 className="text-3xl tracking-[-0.02em] text-foreground">
            {t('title')}
          </h1>
          <AddLink href="/tracker/new" label={t('addButton')} />
        </header>

        {meds.length > 0 && <PushPromptCard />}
        {meds.length > 0 && <TodaySection />}

        {meds.length === 0 ? <EmptyState /> : <List meds={meds} label={t('allLabel')} />}
      </div>
    </div>
  )
}

function List({
  meds,
  label,
}: {
  meds: Awaited<ReturnType<typeof listActiveMedications>>
  label: string
}) {
  return (
    <section>
      {/* Ярлык-пилюля секции — как «Сегодня» в макете. */}
      <span className="inline-block rounded-full border border-border bg-white/90 px-4 py-1.5 text-sm text-[#242424] shadow-card">
        {label}
      </span>
      <div className="mt-3 grid gap-2.5">
        {meds.map((m) => (
          <MedicationCard key={m.id} med={m} />
        ))}
      </div>
    </section>
  )
}

async function EmptyState() {
  const t = await getTranslations('tracker')

  return (
    <div className="card-glass p-8 text-center">
      <div className="mb-3 text-3xl">{t('emptyIcon')}</div>
      <p className="mx-auto max-w-sm text-foreground/80">{t('emptyText')}</p>
      <div className="mt-6">
        <Link
          href="/tracker/new"
          className="inline-block rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {t('emptyButton')}
        </Link>
      </div>
    </div>
  )
}
