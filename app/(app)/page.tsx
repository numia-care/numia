import { UserIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { Suspense } from 'react'

import { DateBadge } from '@/components/dashboard/date-badge'
import { EveningNudge } from '@/components/dashboard/evening-nudge'
import { Greeting } from '@/components/dashboard/greeting'
import { MoodQuickEntry } from '@/components/dashboard/mood-quick-entry'
import { OnboardingCurtain } from '@/components/dashboard/onboarding-curtain'
import { PathPreview } from '@/components/dashboard/path-preview'
import { RetroCard } from '@/components/dashboard/retro-card'
import { QueerHistoryCard } from '@/components/dashboard/queer-history-card'
import { TodayMeds } from '@/components/dashboard/today-meds'
import { WikiCard } from '@/components/dashboard/wiki-card'

// Главный экран «Сегодня» — точка входа в приложение (после login + PIN).
// Этот дроб: приветствие + каркас блоков с тёплыми пустыми состояниями.
// Реальные данные (сегодняшние приёмы, превью «Пути») и карточка квир-истории —
// следующим шагом.
export default async function TodayPage() {
  const t = await getTranslations('dashboard')

  return (
    // Атмосфера по фрейму Кая: тёплый крем + размытые пятна на фоне.
    <div className="relative overflow-hidden">
      {/* Фоновые пятна (эллипсы макета) — под стеклом карточек, чтобы blur
          было что размывать. Тёплый беж снизу и в середине, белое свечение
          сверху. style-blur вместо blur-3xl: в макете радиус ~100px. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-36 left-1/2 h-80 w-[480px] -translate-x-1/2 rounded-full bg-white/70"
        style={{ filter: 'blur(90px)' }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute right-[-120px] top-[30%] h-72 w-96 rounded-full bg-accent/80"
        style={{ filter: 'blur(90px)' }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-[-60px] left-[-80px] h-80 w-[460px] rounded-full bg-accent/80"
        style={{ filter: 'blur(90px)' }}
      />

      {/* Занавес первого входа — сам решает, показываться ли (клиент). */}
      <OnboardingCurtain />
      <div className="page-shell relative space-y-6 py-6 sm:py-10">
        <FadeIn>
          {/* Шапка по макету: ✦ по центру (дышит), профиль — тёмный кружок справа. */}
          <div className="relative">
            <div className="text-center text-2xl text-foreground">
              <span className="star-breathe">✦</span>
            </div>
            {/* По фрейму: кольцо-обводка с тёмной иконкой, не залитый кружок. */}
            <Link
              href="/profile"
              aria-label={t('profileLink')}
              className="absolute right-0 top-8 flex size-10 items-center justify-center rounded-full border-2 border-foreground text-foreground transition-colors hover:bg-foreground/5"
            >
              <UserIcon className="size-5" />
            </Link>
          </div>
          <div className="mt-6">
            <Greeting />
          </div>
          {/* Бейдж даты — по центру под приветствием (замер эталона: 12.6
              от текста выше). Раньше стоял в ряду слева от карточки
              настроения — это была раскладка раннего фрейма. */}
          <div className="mt-[13px] flex justify-center">
            <DateBadge />
          </div>
          {/* Вечерний мягкий заход на дневник — сам решает, показываться ли. */}
          <EveningNudge />
        </FadeIn>

        {/* Настроение — во всю ширину (бейдж уехал под приветствие). */}
        <FadeIn delayMs={60}>
          <MoodQuickEntry />
        </FadeIn>

        {/* Квир-история дня. */}
        <FadeIn delayMs={120}>
          <QueerHistoryCard />
        </FadeIn>

        {/* Ретроспектива «Месяц/Год назад» — сама решает, показываться ли
            (клиент; null → не занимает места). Анимация появления у неё
            внутри, поэтому без FadeIn-обёртки. */}
        <RetroCard />

        {/* Сегодняшние приёмы — реальная сводка (заглушка внутри, если пусто).
            Единственный серверный компонент с данными на этой странице —
            за Suspense, чтобы каркас дашборда не ждал БД (перф-репорт беты). */}
        <FadeIn delayMs={160}>
          <Suspense fallback={<TodayMedsSkeleton />}>
            <TodayMeds />
          </Suspense>
        </FadeIn>

        {/* Нижний ряд: «Вики» и «Путь» рядом (замер эталона: карточки ~160 и
            ~164 шириной, зазор 12.6 → равные колонки с gap-3). */}
        <FadeIn delayMs={240}>
          <div className="grid grid-cols-2 gap-3">
            <WikiCard />
            <PathPreview />
          </div>
        </FadeIn>
      </div>
    </div>
  )
}

// Скелетон сводки приёмов — та же геометрия, что у готовой карточки (иконка
// в шапке, кружок-стрелка справа, 3 ряда × 2 колонки), чтобы вёрстка не прыгала.
function TodayMedsSkeleton() {
  return (
    <div aria-hidden className="card-glass animate-pulse px-5 py-3.5">
      <div className="relative flex items-center justify-center">
        <div className="size-[19px] rounded bg-black/[0.06]" />
        <div className="absolute right-0 size-[38px] rounded-full bg-black/[0.06]" />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-4 rounded bg-black/[0.06]" />
        ))}
      </div>
    </div>
  )
}

// Плавное появление блока со сдвигом снизу. Лёгкое (CSS-анимация из
// tw-animate-css), без тяжёлых эффектов — PWA на слабых телефонах.
function FadeIn({
  children,
  delayMs = 0,
}: {
  children: React.ReactNode
  delayMs?: number
}) {
  return (
    <div
      className="animate-in fade-in slide-in-from-bottom-3 duration-500"
      style={{ animationDelay: `${delayMs}ms`, animationFillMode: 'both' }}
    >
      {children}
    </div>
  )
}
