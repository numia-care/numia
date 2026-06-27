import { getTranslations } from 'next-intl/server'
import Link from 'next/link'

import { buttonVariants } from '@/components/ui/button'

// ЗАГЛУШКА на этот фрагмент: только заголовок + кнопка добавления, чтобы раздел
// был достижим из навигации и форма /labs/new тестировалась. Список записей по
// показателям и графики динамики — СЛЕДУЮЩИЙ шаг (заменят этот плейсхолдер).
export default async function LabsPage() {
  const t = await getTranslations('labs')

  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-10 sm:py-14">
      <header className="mb-8 flex items-center justify-between gap-4">
        <h1 className="font-heading text-3xl text-foreground sm:text-4xl">
          {t('title')}
        </h1>
        <Link href="/labs/new" className={buttonVariants({ size: 'lg' })}>
          {t('addButton')}
        </Link>
      </header>

      <div className="rounded-2xl bg-card p-8 text-center ring-1 ring-border">
        <p className="mx-auto max-w-sm text-foreground/80">{t('listSoon')}</p>
      </div>
    </div>
  )
}
