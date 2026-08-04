import { ImageIcon, LineChartIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'

import { ExampleChart } from '@/components/labs/example-chart'
import { LabsHistory } from '@/components/labs/labs-history'
import { buttonVariants } from '@/components/ui/button'
import { listLabResults } from '@/lib/labs/queries'
import { cn } from '@/lib/utils'

// История анализов: рендер вынесен в LabsHistory (переиспользуется в табе
// «Анализы» экрана препаратов). Здесь — заголовок, кнопка добавления и пустой
// экран с ценностью и примером графика.
export default async function LabsPage() {
  const t = await getTranslations('labs')
  const { numeric, photoOnly } = await listLabResults()
  const isEmpty = numeric.length === 0 && photoOnly.length === 0

  return (
    <div className="page-shell py-10 sm:py-14">
      <header className="mb-6 flex items-center justify-between gap-4">
        <h1 className="font-heading text-3xl text-foreground sm:text-4xl">
          {t('title')}
        </h1>
        <Link href="/labs/new" className={buttonVariants({ size: 'lg' })}>
          {t('addButton')}
        </Link>
      </header>

      {isEmpty ? (
        <EmptyState />
      ) : (
        <LabsHistory numeric={numeric} photoOnly={photoOnly} />
      )}
    </div>
  )
}

// ── Пустой экран: ценность + пример графика + два явных пути ──────────────────

async function EmptyState() {
  const t = await getTranslations('labs')
  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-card p-6 text-center ring-1 ring-border">
        <h2 className="font-heading text-2xl text-foreground">
          {t('emptyTitle')}
        </h2>
        <p className="mx-auto mt-2 max-w-md leading-relaxed text-foreground/80">
          {t('emptyText')}
        </p>

        {/* Пример-заглушка: как будет выглядеть динамика. */}
        <div className="mt-5 rounded-2xl bg-background/60 p-4 ring-1 ring-border">
          <p className="mb-2 text-left text-xs uppercase tracking-wide text-muted-foreground">
            {t('emptyExampleLabel')}
          </p>
          <ExampleChart />
        </div>
      </div>

      {/* Два явных пути добавления. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          href="/labs/new"
          className={cn(
            buttonVariants({ size: 'lg' }),
            'h-auto flex-col items-center gap-1 py-4',
          )}
        >
          <LineChartIcon className="size-5" />
          {t('emptyByValues')}
        </Link>
        <Link
          href="/labs/new?mode=photo"
          className={cn(
            buttonVariants({ variant: 'outline', size: 'lg' }),
            'h-auto flex-col items-center gap-1 py-4',
          )}
        >
          <ImageIcon className="size-5" />
          {t('emptyByPhoto')}
        </Link>
      </div>
    </div>
  )
}
