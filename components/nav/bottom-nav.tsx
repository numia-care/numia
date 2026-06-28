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
 * Нижнее таб-меню, фиксированное на всех экранах (app).
 *
 * Сейчас две вкладки. Массив TABS — задел под будущие (Путь, Дневник, Вики):
 * добавить пункт = одна строка, вёрстка (flex-1 на каждый) растянется сама.
 *
 * Активная вкладка — мох, неактивные — ink-soft. iOS safe-area снизу, чтобы
 * таб-бар не налезал на домашний индикатор (контент сверху не перекрывается —
 * за это отвечает padding-bottom обёртки в (app)/layout).
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
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <ul className="mx-auto flex max-w-2xl">
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
                  'flex flex-col items-center gap-1 py-2.5 text-xs font-medium transition-colors',
                  active ? 'text-moss' : 'text-ink-soft hover:text-moss/70',
                )}
              >
                <Icon className="size-5" />
                {t(tab.key)}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
