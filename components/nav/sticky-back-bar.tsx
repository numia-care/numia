'use client'

import { ArrowLeftIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'

// Закреплённая полоса с «← назад» для длинных контент-страниц (/safety):
// при скролле навигации нет, а страница длинная — без этого некуда вернуться
// (фидбек тестера). sticky top-0, полупрозрачный блюр-фон под тему.
//
// router.back() возвращает туда, откуда пришли (из /profile — на /profile,
// из публичного входа — на предыдущую). Если истории нет (открыли по прямой
// ссылке) — уводим на fallbackHref.
export function StickyBackBar({
  label = 'назад',
  fallbackHref = '/',
}: {
  label?: string
  fallbackHref?: string
}) {
  const router = useRouter()

  function onBack() {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
    } else {
      router.push(fallbackHref)
    }
  }

  return (
    <div className="sticky top-0 z-20 border-b border-border/60 bg-background/80 backdrop-blur-sm">
      <div className="mx-auto w-full max-w-2xl px-5 py-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm text-moss underline-offset-4 transition-colors hover:text-foreground hover:underline"
        >
          <ArrowLeftIcon className="size-4" />
          {label}
        </button>
      </div>
    </div>
  )
}
