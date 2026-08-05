import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { Suspense } from 'react'

import { LabsHistory } from '@/components/labs/labs-history'
import { PushPromptCard } from '@/components/push/push-prompt-card'
import { HistorySection } from '@/components/tracker/history-section'
import { MedicationCard } from '@/components/tracker/medication-card'
import { TodaySection } from '@/components/tracker/today-section'
import { TrackerAddButton } from '@/components/tracker/tracker-add-button'
import { TrackerTabProvider } from '@/components/tracker/tracker-tab-context'
import { TrackerTabs } from '@/components/tracker/tracker-tabs'
import { listLabResults } from '@/lib/labs/queries'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import { getUserTimezoneServer } from '@/lib/timezone-server'
import { listActiveMedications } from '@/lib/tracker/queries'
import { generateSlotsForActiveMeds } from '@/lib/tracker/slot-generator'
// Модуль БЕЗ 'use client' — из клиентского контекста эту функцию звать нельзя,
// см. шапку lib/tracker/tab-key.ts.
import { parseTabKey } from '@/lib/tracker/tab-key'
import { getSlotsInRange, getTodayRange, getTodaySlots } from '@/lib/tracker/today'

// Нижняя граница «всей истории». Эпоха, а не вычисленная дата первого приёма:
// иначе понадобился бы отдельный запрос min(scheduled_at) ради значения,
// которое Postgres и так отфильтрует по индексу.
const HISTORY_START = new Date(0)

// Экран «Препараты» по финальному макету Кая (фрейм 571:2): центрированный
// заголовок, сегмент-контрол Сегодня/Все/Анализы + круглый «+», карточки-
// препараты с голубым градиентом. «Анализы» — таб внутри препаратов (IA Кая:
// анализы живут здесь, не в отдельном разделе).
//
// Перф (репорт беты 2026-07-22): каркас отдаётся мгновенно, данные за Suspense.
// auth/tz кэшированы на запрос. Генерация слотов с 2026-07-29 идёт синхронно
// перед чтением списка — иначе «слоты ещё не создались» неотличимо от «приёмов
// сегодня нет» (см. комментарий в TrackerData).
export default async function TrackerPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const t = await getTranslations('tracker')

  // ?tab=analyses — возврат на нужную вкладку после формы анализа. Читается
  // ОДИН раз, здесь; дальше вкладки переключаются локально через setTab, без
  // навигации. Мусор в параметре parseTabKey отсеет, и провайдер возьмёт свой
  // дефолт «Сегодня».
  const { tab } = await searchParams
  const initialTab = parseTabKey(tab)

  return (
    // Фон ровный: размытые пятна убраны в полировке «убрать лишнее»
    // (заход 1, 2026-08-04). На «Пути» они сохранены намеренно.
    <div className="relative overflow-hidden">
      <div className="page-shell relative py-10 sm:py-14">
        {/* Провайдер оборачивает и заголовок, и Suspense: активную вкладку
            читают оба — пилюли внутри Suspense и круглый «+» снаружи.
            TrackerData проезжает сквозь клиентский провайдер как children,
            поэтому остаётся серверным компонентом. */}
        <TrackerTabProvider initial={initialTab}>
          {/* Заголовок по фрейму: по центру, Inter Medium ~28px.
              Круглый «+» d=52 — справа в этой же строке. Переехал
              сюда из ряда табов, когда вкладок стало четыре: в ряду он
              переставал влезать на 375px и обрезался (расклад в
              tracker-tabs.tsx). Паттерн «контент по центру, действие absolute
              справа» — тот же, что в шапке карточки препаратов на дашборде
              (today-meds.tsx). Стоит ВНЕ Suspense, поэтому появляется сразу
              со скелетоном. */}
          <div className="relative mb-6 flex min-h-[52px] items-center justify-center">
            <h1 className="text-[28px] font-medium tracking-[-0.02em] text-foreground">
              {t('title')}
            </h1>
            <TrackerAddButton
              medicationLabel={t('addButton')}
              labLabel={t('addLabButton')}
            />
          </div>

          <Suspense fallback={<TrackerSkeleton />}>
            <TrackerData />
          </Suspense>
        </TrackerTabProvider>
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

  // «Сегодня» и «История» читаются параллельно — история не удлиняет путь.
  // Её читаем всегда, даже без активных препаратов: приёмы остановленного или
  // удалённого препарата — тоже история, и пропадать вместе с ним не должны.
  // Верхняя граница — конец сегодняшнего дня юзера: будущие слоты это ещё не
  // история.
  const [slots, historySlots] = await Promise.all([
    meds.length > 0 ? getTodaySlots(tz) : Promise.resolve([]),
    getSlotsInRange(HISTORY_START, getTodayRange(tz).end, 'desc'),
  ])
  const hasMeds = meds.length > 0
  const labsEmpty = labs.numeric.length === 0 && labs.photoOnly.length === 0

  return (
    <>
      {hasMeds && <PushPromptCard />}
      <TrackerTabs
        labels={{
          today: t('tabToday'),
          all: t('tabAll'),
          analyses: t('tabAnalyses'),
          history: t('tabHistory'),
        }}
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
        history={<HistorySection slots={historySlots} timezone={tz} />}
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
      {/* Геометрия — как у настоящих табов (62×57 r:16, зазор 9), иначе при
          подмене скелетона на контент ряд прыгает. Четыре пилюли, без «+»:
          он теперь в строке заголовка, вне Suspense, и рисуется сразу. */}
      <div className="mb-6 flex items-center gap-[9px]">
        <div className="h-[57px] w-[62px] rounded-[16px] bg-black/[0.06]" />
        <div className="h-[57px] w-[62px] rounded-[16px] bg-black/[0.06]" />
        <div className="h-[57px] w-[62px] rounded-[16px] bg-black/[0.06]" />
        <div className="h-[57px] w-[62px] rounded-[16px] bg-black/[0.06]" />
      </div>
      <div className="grid gap-2.5">
        <div className="h-[52px] rounded-[25px] bg-black/[0.06]" />
        <div className="h-[52px] rounded-[25px] bg-black/[0.06]" />
        <div className="h-[52px] rounded-[25px] bg-black/[0.06]" />
      </div>
    </div>
  )
}
