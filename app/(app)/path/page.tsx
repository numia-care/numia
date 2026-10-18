import { getTranslations } from 'next-intl/server'

import { PathFeed } from '@/components/path/path-feed'

// Серверная оболочка: заголовок + кнопка добавления. Сама лента — клиентская
// (PathFeed): расшифровка идёт на устройстве ключом из PIN-сессии, на сервере
// контента нет. Кнопка ведёт в /path/new (поток добавления фото — этап 4).
export default async function PathPage() {
  const t = await getTranslations('path')

  return (
    <div className="relative overflow-hidden">
      {/* Пастельные эллипсы-свечения за лентой (эллипсы макета): нежный зелёный и
          розовый чередуются сверху вниз, попеременно у левого и правого края.
          Позиции в % — фон тянется вместе с лентой, сколько бы записей ни было.
          Дёшево для слабых телефонов: только blur, без анимации. */}
      {[
        { top: '4%', side: 'right', color: 'var(--brand-glow-green)' },
        { top: '26%', side: 'left', color: 'var(--brand-chip-pink)' },
        { top: '48%', side: 'right', color: 'var(--brand-glow-green)' },
        { top: '70%', side: 'left', color: 'var(--brand-chip-pink)' },
        { top: '90%', side: 'right', color: 'var(--brand-glow-green)' },
      ].map((blob, i) => (
        <div
          key={i}
          aria-hidden
          className="pointer-events-none absolute h-72 w-80 rounded-full opacity-55"
          style={{
            top: blob.top,
            [blob.side]: '-90px',
            background: blob.color,
            filter: 'blur(90px)',
          }}
        />
      ))}

      <div className="page-shell relative py-10 sm:py-14">
        {/* Заголовок по центру (по фрейму); тулбар с «+» — внутри PathFeed. */}
        <header className="mb-6 flex items-center justify-center">
          <h1 className="text-[28px] font-medium tracking-[-0.02em] text-foreground">
            {t('title')}
          </h1>
        </header>

        <PathFeed />
      </div>
    </div>
  )
}
