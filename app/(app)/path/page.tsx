import { getTranslations } from 'next-intl/server'

import { PathFeed } from '@/components/path/path-feed'
import { AddLink } from '@/components/ui/add-link'

// Серверная оболочка: заголовок + кнопка добавления. Сама лента — клиентская
// (PathFeed): расшифровка идёт на устройстве ключом из PIN-сессии, на сервере
// контента нет. Кнопка ведёт в /path/new (поток добавления фото — этап 4).
export default async function PathPage() {
  const t = await getTranslations('path')

  return (
    <div className="relative overflow-hidden">
      {/* Пастельные блобы-свечения за дорожкой (эллипсы Кая), дешёвый CSS. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 right-[-90px] h-72 w-96 rounded-full bg-chip-blue/40"
        style={{ filter: 'blur(90px)' }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-[40%] left-[-100px] h-80 w-96 rounded-full bg-accent/50"
        style={{ filter: 'blur(90px)' }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-[-40px] right-[-60px] h-72 w-80 rounded-full bg-chip-pink/40"
        style={{ filter: 'blur(90px)' }}
      />

      <div className="relative mx-auto w-full max-w-2xl px-5 py-10 sm:py-14">
        {/* Заголовок по центру (по фрейму), «+» — справа. */}
        <header className="relative mb-8 flex items-center justify-center">
          <h1 className="text-[28px] font-medium tracking-[-0.02em] text-foreground">
            {t('title')}
          </h1>
          <div className="absolute right-0">
            <AddLink href="/path/new" label={t('addButton')} />
          </div>
        </header>

        <PathFeed />
      </div>
    </div>
  )
}
