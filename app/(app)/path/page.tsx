import { getTranslations } from 'next-intl/server'

import { PathFeed } from '@/components/path/path-feed'
import { AddLink } from '@/components/ui/add-link'

// Серверная оболочка: заголовок + кнопка добавления. Сама лента — клиентская
// (PathFeed): расшифровка идёт на устройстве ключом из PIN-сессии, на сервере
// контента нет. Кнопка ведёт в /path/new (поток добавления фото — этап 4).
export default async function PathPage() {
  const t = await getTranslations('path')

  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-10 sm:py-14">
      <header className="mb-8 flex items-center justify-between gap-4">
        <h1 className="font-heading text-3xl text-foreground sm:text-4xl">
          {t('title')}
        </h1>
        <AddLink href="/path/new" label={t('addButton')} />
      </header>

      <PathFeed />
    </div>
  )
}
