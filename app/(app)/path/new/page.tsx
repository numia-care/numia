import { getTranslations } from 'next-intl/server'
import Link from 'next/link'

import { NewEntry } from '@/components/path/new-entry'

// Добавление записи в «Путь» (фото, голос или дневник). Оболочка серверная
// (заголовок), формы клиентские: сжатие/запись, шифрование и загрузка идут на
// устройстве. ?mode=diary открывает сразу вкладку дневника (вечерний заход с
// дашборда «Как прошёл день?»).
export default async function NewPathEntryPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>
}) {
  const t = await getTranslations('path.new')
  const { mode } = await searchParams
  const initialMode = mode === 'diary' || mode === 'voice' ? mode : 'photo'

  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-10 sm:py-14">
      <header className="mb-8">
        <Link
          href="/path"
          className="mb-3 inline-block text-sm text-muted-foreground hover:text-foreground"
        >
          {t('backLink')}
        </Link>
        <h1 className="font-heading text-3xl text-foreground sm:text-4xl">
          {t('title')}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      <NewEntry initialMode={initialMode} />
    </div>
  )
}
