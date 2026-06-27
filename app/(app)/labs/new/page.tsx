import { getTranslations } from 'next-intl/server'
import Link from 'next/link'

import { LabForm } from '@/components/labs/lab-form'

// Добавление лабораторного показателя. Оболочка серверная (заголовок), форма
// клиентская: шифрование заметки/фото идёт на устройстве (lib/labs/records).
export default async function NewLabResultPage() {
  const t = await getTranslations('labs.new')

  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-10 sm:py-14">
      <header className="mb-8">
        <Link
          href="/labs"
          className="mb-3 inline-block text-sm text-muted-foreground hover:text-foreground"
        >
          {t('backLink')}
        </Link>
        <h1 className="font-heading text-3xl text-foreground sm:text-4xl">
          {t('title')}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      <LabForm />
    </div>
  )
}
