import { getTranslations } from 'next-intl/server'
import Link from 'next/link'

import { LabForm } from '@/components/labs/lab-form'

// Добавление анализа. Оболочка серверная (заголовок), форма клиентская:
// шифрование заметки/фото идёт на устройстве (lib/labs/records).
// ?mode=photo открывает форму сразу в режиме «фото бланка» (из пустого экрана).
export default async function NewLabResultPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>
}) {
  const t = await getTranslations('labs.new')
  const { mode } = await searchParams
  const initialMode = mode === 'photo' ? 'photo' : 'values'

  return (
    <div className="page-shell py-10 sm:py-14">
      <header className="mb-6">
        <Link
          href="/tracker?tab=analyses"
          className="mb-3 inline-block text-sm text-muted-foreground hover:text-foreground"
        >
          {t('backLink')}
        </Link>
        <h1 className="font-heading text-3xl text-foreground sm:text-4xl">
          {t('title')}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      <LabForm initialMode={initialMode} />
    </div>
  )
}
