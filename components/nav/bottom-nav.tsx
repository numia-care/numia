'use client'

import {
  EllipsisIcon,
  LeafIcon,
  RouteIcon,
  SparklesIcon,
  type LucideIcon,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { cn } from '@/lib/utils'

/**
 * Нижнее таб-меню — тёмная плавающая пилюля (концепция Кая, фрейм «сегодня»):
 * #1A1A1A, r:31, только иконки (подписи — в aria-label), активная вкладка
 * подсвечена синеватой плашкой #375E70/20.
 *
 * Массив TABS — задел под будущие вкладки: добавить пункт = одна строка.
 * iOS safe-area снизу; контент не перекрывается — за это отвечает
 * padding-bottom обёртки в (app)/layout.
 */

type Tab = {
  href: string
  /** ключ в messages.nav */
  key: 'today' | 'tracker' | 'path' | 'more'
  icon: LucideIcon
  /** доп. пути, при которых таб считается активным (для «Ещё»: его разделы) */
  match?: string[]
}

const TABS: Tab[] = [
  { href: '/', key: 'today', icon: SparklesIcon },
  { href: '/tracker', key: 'tracker', icon: LeafIcon },
  { href: '/path', key: 'path', icon: RouteIcon },
  // «Ещё» подсвечивается и на своих разделах (Анализы, Вики, Настройки).
  { href: '/more', key: 'more', icon: EllipsisIcon, match: ['/labs', '/wiki', '/settings'] },
]

export function BottomNav() {
  const t = useTranslations('nav')
  const pathname = usePathname()

  return (
    <nav className="fixed inset-x-0 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-6">
      <ul className="flex h-[62px] w-full max-w-sm items-center justify-around rounded-full bg-nav px-3 shadow-lg">
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
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                aria-label={t(tab.key)}
                className={cn(
                  'flex size-12 items-center justify-center rounded-full transition-colors',
                  // Активная — синеватая плашка из макета (#375E70 @20%).
                  active
                    ? 'bg-[#375E70]/20 text-nav-foreground'
                    : 'text-nav-foreground/60 hover:text-nav-foreground',
                )}
              >
                <Icon className="size-6" />
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
