import { Suspense } from 'react'

import { DateBadge } from '@/components/dashboard/date-badge'
import { Greeting } from '@/components/dashboard/greeting'
import { MoodQuickEntry } from '@/components/dashboard/mood-quick-entry'
import { OnboardingCurtain } from '@/components/dashboard/onboarding-curtain'
import { PathPreview } from '@/components/dashboard/path-preview'
import { QueerHistoryCard } from '@/components/dashboard/queer-history-card'
import { TodayMeds } from '@/components/dashboard/today-meds'
import { WikiCard } from '@/components/dashboard/wiki-card'

// Главный экран «Сегодня» — точка входа в приложение (после login + PIN).
// Этот дроб: приветствие + каркас блоков с тёплыми пустыми состояниями.
// Реальные данные (сегодняшние приёмы, превью «Пути») и карточка квир-истории —
// следующим шагом.
export default async function TodayPage() {
  return (
    // Фон ровный: размытые пятна убраны в полировке «убрать лишнее»
    // (заход 1, 2026-08-04) — вставлялись бессистемно. На «Пути» они
    // сохранены намеренно.
    <div className="relative overflow-hidden">
      {/* Занавес первого входа — сам решает, показываться ли (клиент). */}
      <OnboardingCurtain />
      <div className="page-shell relative space-y-6 py-10 sm:py-14">
        <FadeIn>
          {/* Шапка: ✦ и кнопка профиля убраны в полировке. Профиль и так есть
              в таб-баре внизу — кнопка сверху его дублировала. */}
          <Greeting />
          {/* Бейдж даты — по центру под приветствием (замер эталона: 12.6
              от текста выше). Раньше стоял в ряду слева от карточки
              настроения — это была раскладка раннего фрейма. */}
          <div className="mt-[13px] flex justify-center">
            <DateBadge />
          </div>
        </FadeIn>

        {/* Настроение — во всю ширину (бейдж уехал под приветствие). */}
        <FadeIn delayMs={60}>
          <MoodQuickEntry />
        </FadeIn>

        {/* Квир-история дня. */}
        <FadeIn delayMs={120}>
          <QueerHistoryCard />
        </FadeIn>

        {/* Сегодняшние приёмы — реальная сводка (заглушка внутри, если пусто).
            Единственный серверный компонент с данными на этой странице —
            за Suspense, чтобы каркас дашборда не ждал БД (перф-репорт беты). */}
        <FadeIn delayMs={160}>
          <Suspense fallback={<TodayMedsSkeleton />}>
            <TodayMeds />
          </Suspense>
        </FadeIn>

        {/* Нижний ряд: «Вики» и «Путь» рядом (замер эталона: карточки ~160 и
            ~164 шириной, зазор 12.6 → равные колонки с gap-3).

            БЕЗ delayMs, в отличие от рядов выше. Здесь стояло 240мс, и это
            давало «мигание»: animation-fill-mode: both держит блок невидимым
            всю задержку, то есть на месте он оказывался только через ~740мс,
            и лесенка переигрывалась при каждом заходе на «Сегодня» (клиентская
            навигация монтирует заново).

            Ключевое: задержка — чистый CSS, она НЕ откладывает монтирование.
            PathPreview всё это время уже грузил и расшифровывал данные, просто
            под невидимым слоем. Получалось «пустое место → блок появился →
            тут же дёрнулся содержимым», потому что к 240мс запрос успевал
            вернуться. Без задержки виден скелетон, пока идёт загрузка, — то
            есть ожидание показано честно, а не спрятано. */}
        <FadeIn>
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
