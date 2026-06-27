import { getTranslations } from 'next-intl/server'
import Link from 'next/link'

import { NewEntry } from '@/components/path/new-entry'

// Добавление записи в «Путь» (фото или голос). Оболочка серверная (заголовок),
// формы клиентские: сжатие/запись, шифрование и загрузка идут на устройстве.
export default async function NewPathEntryPage() {
  const t = await getTranslations('path.new')

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

      <NewEntry />
    </div>
  )
}
