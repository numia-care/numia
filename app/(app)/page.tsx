import { UserIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'

import { Greeting } from '@/components/dashboard/greeting'
import { PathPreview } from '@/components/dashboard/path-preview'
import { QueerHistoryCard } from '@/components/dashboard/queer-history-card'
import { TodayMeds } from '@/components/dashboard/today-meds'

// Главный экран «Сегодня» — точка входа в приложение (после login + PIN).
// Этот дроб: приветствие + каркас блоков с тёплыми пустыми состояниями.
// Реальные данные (сегодняшние приёмы, превью «Пути») и карточка квир-истории —
// следующим шагом.
export default async function TodayPage() {
  const t = await getTranslations('dashboard')

  return (
    // Мягкий пастельный градиент — базовый атмосферный слой (дизайнер усилит).
    <div className="bg-gradient-to-b from-background to-secondary/25">
      <div className="mx-auto w-full max-w-2xl space-y-6 px-5 py-10 sm:py-14">
        <FadeIn>
          <div className="flex items-start justify-between gap-4">
            <Greeting />
            {/* Профиль — личное пространство; быстрый доступ с дашборда. */}
            <Link
              href="/profile"
              aria-label={t('profileLink')}
              className="mt-1 shrink-0 rounded-full p-2 text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
            >
              <UserIcon className="size-5" />
            </Link>
          </div>
        </FadeIn>

        {/* Квир-история дня. */}
        <FadeIn delayMs={80}>
          <QueerHistoryCard />
        </FadeIn>

        {/* Сегодняшние приёмы — реальная сводка (заглушка внутри, если пусто). */}
        <FadeIn delayMs={160}>
          <TodayMeds />
        </FadeIn>

        {/* Последнее из «Пути» — превью 1–2 записей (заглушка, если пусто). */}
        <FadeIn delayMs={240}>
          <PathPreview />
        </FadeIn>
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
