import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { after } from 'next/server'
import { Suspense } from 'react'

import { PushPromptCard } from '@/components/push/push-prompt-card'
import { MedicationCard } from '@/components/tracker/medication-card'
import { TodaySection } from '@/components/tracker/today-section'
import { AddLink } from '@/components/ui/add-link'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import { getUserTimezoneServer } from '@/lib/timezone-server'
import { listActiveMedications } from '@/lib/tracker/queries'
import { generateSlotsForActiveMeds } from '@/lib/tracker/slot-generator'
import { getTodaySlots } from '@/lib/tracker/today'

// Экран «Препараты» по фрейму Кая (288:357 / 306:34): ✦ по центру сверху,
// заголовок 30px, тёмная круглая «+» справа, слоты и препараты — строки-пилюли.
//
// Перф (репорт беты 2026-07-22: переход на вкладку занимал 2-3с):
//   • Каркас (шапка, фон) отдаётся МГНОВЕННО — данные стримятся следом за
//     Suspense со скелетоном. Ни одного похода в БД до первого байта.
//   • Внутри TrackerData критический путь ужат до трёх шагов:
//     auth (кэширован на запрос) → препараты ∥ таймзона → слоты дня.
//   • Генерация/сверка слотов ушла в after() — исполняется ПОСЛЕ отправки
//     ответа. Слоты на сегодня и так уже есть (суточный cron + генерация при
//     создании/правке препарата и смене tz); on-demand здесь — страховка
//     самолечения, её результат нужен к следующему визиту, не к этому.
export default async function TrackerPage() {
  const t = await getTranslations('tracker')

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
        className="pointer-events-none absolute bottom-[-60px] left-[-80px] h-80 w-[460px] rounded-full bg-accent/80"
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

        <Suspense fallback={<TrackerSkeleton />}>
          <TrackerData />
        </Suspense>
      </div>
    </div>
  )
}

// Вся работа с данными — за Suspense-границей, чтобы не задерживать каркас.
async function TrackerData() {
  const t = await getTranslations('tracker')
  const user = await getAuthUser()
  if (!user) return null

  // Параллельно: список препаратов и таймзона (раньше — последовательно,
  // с двумя лишними походами в Auth между ними).
  const [meds, tz] = await Promise.all([
    listActiveMedications(),
    getUserTimezoneServer(),
  ])

  // Клиент создаём ДО after(): внутри after cookies() из Server Component
  // недоступны, а замыкание на готовый клиент — ок.
  const supabase = await createClient()
  after(async () => {
    try {
      await generateSlotsForActiveMeds(supabase, user.id, tz, 1)
    } catch (e) {
      console.error('slot generation after tracker render failed:', e)
    }
  })

  const slots = meds.length > 0 ? await getTodaySlots(tz) : []

  return (
    <>
      {meds.length > 0 && <PushPromptCard />}
      {meds.length > 0 && <TodaySection slots={slots} timezone={tz} />}
      {meds.length === 0 ? (
        <EmptyState />
      ) : (
        <List meds={meds} label={t('allLabel')} />
      )}
    </>
  )
}

// Скелетон на время загрузки данных: пилюля-ярлык + строки-пилюли — та же
// геометрия, что у настоящих секций, чтобы контент не прыгал при появлении.
function TrackerSkeleton() {
  return (
    <div aria-hidden className="animate-pulse">
      <div className="h-8 w-24 rounded-full bg-black/[0.06]" />
      <div className="mt-3 grid gap-2.5">
        <div className="h-[52px] rounded-full bg-black/[0.06]" />
        <div className="h-[52px] rounded-full bg-black/[0.06]" />
      </div>
      <div className="mt-8 h-8 w-32 rounded-full bg-black/[0.06]" />
      <div className="mt-3 grid gap-2.5">
        <div className="h-[52px] rounded-full bg-black/[0.06]" />
        <div className="h-[52px] rounded-full bg-black/[0.06]" />
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
      <span className="inline-block rounded-full border border-border bg-white/90 px-4 py-1.5 text-sm text-foreground shadow-card">
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
