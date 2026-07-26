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
 * Нижнее таб-меню — СВЕТЛАЯ стеклянная пилюля по финальному макету Кая
 * (фрейм «сегодня итог» 570:1691): белое стекло ~68% + backdrop-blur, r:31,
 * тень-card; иконка + подпись, тёмные чернила навигации. Активный таб —
 * приподнятая белая плашка.
 *
 * Фон пилюли — через токен --kai-glass-nav (тема может переопределить).
 * iOS safe-area снизу; контент не перекрывается благодаря padding-bottom
 * обёртки в (app)/layout.
 */

type Tab = {
  href: string
  key: 'today' | 'tracker' | 'path' | 'profile'
  icon: LucideIcon
  match?: string[]
}

const TABS: Tab[] = [
  { href: '/', key: 'today', icon: SparklesIcon },
  { href: '/tracker', key: 'tracker', icon: LeafIcon },
  { href: '/path', key: 'path', icon: RouteIcon },
  {
    href: '/profile',
    key: 'profile',
    icon: UserRoundIcon,
    match: ['/labs', '/wiki', '/settings', '/safety', '/more'],
  },
]

export function BottomNav() {
  const t = useTranslations('nav')
  const pathname = usePathname()

  return (
    <nav className="fixed inset-x-0 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-6">
      <ul
        className="shadow-card flex w-full max-w-sm items-center justify-around gap-1 rounded-[31px] border border-border px-2 py-2 backdrop-blur-[9px]"
        style={{ backgroundColor: 'var(--kai-glass-nav)' }}
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
                  'flex flex-col items-center gap-0.5 rounded-[22px] py-1.5 transition-colors',
                  // Активный — приподнятая белая плашка + тёмные чернила.
                  active
                    ? 'shadow-soft bg-white/70 text-foreground'
                    : 'text-foreground/55 hover:text-foreground',
                )}
              >
                <Icon className="size-5" />
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
