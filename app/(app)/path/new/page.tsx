import { getTranslations } from 'next-intl/server'
import Link from 'next/link'

import { NewEntry } from '@/components/path/new-entry'

// Добавление записи в «Путь» (фото, голос или дневник). Шапка по PNG-эталону:
// «← в Путь» слева серым, заголовок и подзаголовок по центру. Оболочка
// серверная, формы клиентские (шифрование на устройстве). ?mode=diary
// открывает сразу дневник (вечерний заход с дашборда).
export default async function NewPathEntryPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>
}) {
  const t = await getTranslations('path.new')
  const { mode } = await searchParams
  const initialMode = mode === 'diary' || mode === 'voice' ? mode : 'photo'

  return (
    <div className="page-shell py-8 sm:py-12">
      <header className="mb-7">
        <Link
          href="/path"
          className="inline-block text-sm text-black/40 transition-colors hover:text-foreground"
        >
          {t('backLink')}
        </Link>
        <h1 className="mt-1 text-center text-[28px] font-medium tracking-[-0.02em] text-foreground">
          {t('title')}
        </h1>
        <p className="mx-auto mt-2 max-w-[270px] text-center text-[11px] leading-relaxed text-black/40">
          {t('subtitle')}
        </p>
      </header>

      <NewEntry initialMode={initialMode} />
    </div>
  )
}
