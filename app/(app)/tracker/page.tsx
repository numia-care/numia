import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { Suspense } from 'react'

import { LabsHistory } from '@/components/labs/labs-history'
import { PushPromptCard } from '@/components/push/push-prompt-card'
import { MedicationCard } from '@/components/tracker/medication-card'
import { TodaySection } from '@/components/tracker/today-section'
import { TrackerTabs } from '@/components/tracker/tracker-tabs'
import { listLabResults } from '@/lib/labs/queries'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import { getUserTimezoneServer } from '@/lib/timezone-server'
import { listActiveMedications } from '@/lib/tracker/queries'
import { generateSlotsForActiveMeds } from '@/lib/tracker/slot-generator'
import { getTodaySlots } from '@/lib/tracker/today'

// Экран «Препараты» по финальному макету Кая (фрейм 571:2): центрированный
// заголовок, сегмент-контрол Сегодня/Все/Анализы + круглый «+», карточки-
// препараты с голубым градиентом. «Анализы» — таб внутри препаратов (IA Кая:
// анализы живут здесь, не в отдельном разделе).
//
// Перф (репорт беты 2026-07-22): каркас отдаётся мгновенно, данные за Suspense.
// auth/tz кэшированы на запрос. Генерация слотов с 2026-07-29 идёт синхронно
// перед чтением списка — иначе «слоты ещё не создались» неотличимо от «приёмов
// сегодня нет» (см. комментарий в TrackerData).
export default async function TrackerPage() {
  const t = await getTranslations('tracker')

  return (
    <div className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-36 left-1/2 h-80 w-[480px] -translate-x-1/2 rounded-full bg-white/70"
        style={{ filter: 'blur(90px)' }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-[-60px] left-[-80px] h-80 w-[460px] rounded-full bg-accent/60"
        style={{ filter: 'blur(90px)' }}
      />

      <div className="page-shell relative py-6 sm:py-10">
        {/* Заголовок по фрейму: по центру, Inter Medium ~28px. */}
        <h1 className="mb-6 text-center text-[28px] font-medium tracking-[-0.02em] text-foreground">
          {t('title')}
        </h1>

        <Suspense fallback={<TrackerSkeleton />}>
          <TrackerData />
        </Suspense>
      </div>
    </div>
  )
}

// Работа с данными — за Suspense-границей, чтобы не задерживать каркас.
async function TrackerData() {
  const t = await getTranslations('tracker')
  const user = await getAuthUser()
  if (!user) return null

  // Параллельно: препараты, таймзона, анализы.
  const [meds, tz, labs] = await Promise.all([
    listActiveMedications(),
    getUserTimezoneServer(),
    listLabResults(),
  ])

  const supabase = await createClient()

  // Генерация слотов идёт СИНХРОННО, до чтения списка (решение 2026-07-29).
  //
  // Раньше она стояла в after(), то есть выполнялась уже после ответа: на
  // первом заходе слотов в БД ещё не было, и пустой список был неотличим от
  // «на сегодня приёмов нет». Из-за этого экран показывал «расписание
  // готовится» тем, у кого приёмов сегодня действительно нет.
  //
  // Теперь к моменту getTodaySlots результат окончательный, и slots.length === 0
  // значит ровно одно: принимать сегодня нечего.
  //
  // Цена — 3 последовательных запроса (препараты, сверка, upsert) на пути
  // данных вкладки. Каркас страницы это не задерживает: TrackerData за
  // Suspense-границей. Ошибку глотаем — показать список из того, что уже есть
  // в БД, лучше, чем уронить вкладку целиком.
  if (meds.length > 0) {
    try {
      await generateSlotsForActiveMeds(supabase, user.id, tz, 1)
    } catch (e) {
      console.error('slot generation before tracker render failed:', e)
    }
  }

  const slots = meds.length > 0 ? await getTodaySlots(tz) : []
  const hasMeds = meds.length > 0
  const labsEmpty = labs.numeric.length === 0 && labs.photoOnly.length === 0

  return (
    <>
      {hasMeds && <PushPromptCard />}
      <TrackerTabs
        initial={hasMeds ? 'today' : 'all'}
        labels={{
          today: t('tabToday'),
          all: t('tabAll'),
          analyses: t('tabAnalyses'),
        }}
        addHref="/tracker/new"
        addLabel={t('addButton')}
        today={
          hasMeds ? <TodaySection slots={slots} timezone={tz} /> : <MedsEmpty />
        }
        all={hasMeds ? <AllMeds meds={meds} /> : <MedsEmpty />}
        analyses={
          labsEmpty ? (
            <AnalysesEmpty />
          ) : (
            <LabsHistory numeric={labs.numeric} photoOnly={labs.photoOnly} />
          )
        }
      />
    </>
  )
}

function AllMeds({
  meds,
}: {
  meds: Awaited<ReturnType<typeof listActiveMedications>>
}) {
  return (
    // Зазор 4 — замер эталона преппараты2 (3.3–4.6), было 10.
    <div className="grid gap-1">
      {meds.map((m) => (
        <MedicationCard key={m.id} med={m} />
      ))}
    </div>
  )
}

async function MedsEmpty() {
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

async function AnalysesEmpty() {
  const t = await getTranslations('tracker')
  return (
    <div className="card-glass p-8 text-center">
      <p className="mx-auto max-w-sm text-foreground/80">{t('analysesEmpty')}</p>
      <div className="mt-6">
        <Link
          href="/labs/new"
          className="inline-block rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {t('addButton')}
        </Link>
      </div>
    </div>
  )
}

// Скелетон: сегмент-контрол + строки-карточки той же геометрии.
function TrackerSkeleton() {
  return (
    <div aria-hidden className="animate-pulse">
      {/* Геометрия — как у настоящих табов (62×57 r:16, «+» d=47), иначе при
          подмене скелетона на контент ряд прыгает. */}
      <div className="mb-6 flex items-center gap-[9px]">
        <div className="h-[57px] w-[62px] rounded-[16px] bg-black/[0.06]" />
        <div className="h-[57px] w-[62px] rounded-[16px] bg-black/[0.06]" />
        <div className="h-[57px] w-[62px] rounded-[16px] bg-black/[0.06]" />
        <div className="ml-auto size-[47px] rounded-full bg-black/[0.06]" />
      </div>
      <div className="grid gap-2.5">
        <div className="h-[52px] rounded-[25px] bg-black/[0.06]" />
        <div className="h-[52px] rounded-[25px] bg-black/[0.06]" />
        <div className="h-[52px] rounded-[25px] bg-black/[0.06]" />
      </div>
    </div>
  )
}
