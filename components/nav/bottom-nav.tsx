'use client'

import {
  LeafIcon,
  RouteIcon,
  SparklesIcon,
  UserRoundIcon,
  type LucideIcon,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { cn } from '@/lib/utils'

/**
 * Нижнее таб-меню — СВЕТЛАЯ стеклянная пилюля по финальному макету
 * (фрейм «сегодня итог» 570:1691): белое стекло ~68% + backdrop-blur, r:31,
 * тень-card; иконка + подпись, тёмные чернила навигации. Активный таб —
 * приподнятая белая плашка.
 *
 * Фон пилюли — через токен --brand-glass-nav (тема может переопределить).
 * iOS safe-area снизу; контент не перекрывается благодаря padding-bottom
 * обёртки в (app)/layout.
 */

type Tab = {
  href: string
  key: 'today' | 'tracker' | 'path' | 'profile'
  icon: LucideIcon
  match?: string[]
}

// match — под-страницы, которые живут НЕ на своём префиксе, но принадлежат
// вкладке по смыслу. Правило простое: подсвечиваем ту вкладку, ИЗ КОТОРОЙ
// на страницу реально ведёт ссылка.
//
// /tracker/* и /path/* сюда не входят намеренно: их накрывает совпадение по
// собственному префиксу, отдельная строчка была бы дублем.
const TABS: Tab[] = [
  // /wiki — попадают из карточки «Вики» на дашборде (wiki-card.tsx), больше
  // ниоткуда.
  { href: '/', key: 'today', icon: SparklesIcon, match: ['/wiki'] },
  // /labs* — «Анализы» это вкладка внутри «Препаратов» (принятая IA), и «+» с неё
  // ведёт на /labs/new. Раньше строчка стояла у Профиля — верно для тех
  // времён, когда «Анализы» были пунктом его меню. Пункт убрали в полировке
  // 2026-08-04, а match забыли перенести, из-за чего на форме нового анализа
  // подсвечивался «Профиль».
  { href: '/tracker', key: 'tracker', icon: LeafIcon, match: ['/labs'] },
  { href: '/path', key: 'path', icon: RouteIcon },
  {
    href: '/profile',
    key: 'profile',
    icon: UserRoundIcon,
    // /more — редирект на /profile для старых бандлов; строчка безвредна.
    match: ['/settings', '/safety', '/more'],
  },
]

export function BottomNav() {
  const t = useTranslations('nav')
  const pathname = usePathname()

  return (
    <nav className="fixed inset-x-0 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-6">
      <ul
        className="shadow-card flex w-full max-w-sm items-center justify-around gap-1 rounded-[31px] border border-border px-2 py-2 backdrop-blur-[9px]"
        style={{ backgroundColor: 'var(--brand-glass-nav)' }}
      >
        {TABS.map((tab) => {
          const active =
            pathname === tab.href ||
            pathname.startsWith(`${tab.href}/`) ||
            (tab.match?.some(
              (p) => pathname === p || pathname.startsWith(`${p}/`),
            ) ??
              false)
          const Icon = tab.icon
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex flex-col items-center gap-1 py-1 transition-colors',
                  active ? 'text-foreground' : 'text-foreground/60 hover:text-foreground',
                )}
              >
                {/* Активный таб — белый круг за иконкой (по PNG-эталону). */}
                <span
                  className={cn(
                    'flex size-9 items-center justify-center rounded-full transition-colors',
                    active && 'shadow-soft -my-0.5 size-10 bg-white',
                  )}
                >
                  <Icon className="size-5" strokeWidth={1.8} />
                </span>
                <span className="text-[9px] font-semibold leading-none">
                  {t(tab.key)}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
