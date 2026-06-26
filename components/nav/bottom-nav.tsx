'use client'

import { LeafIcon, RouteIcon, SettingsIcon, type LucideIcon } from 'lucide-react'
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
  key: 'tracker' | 'path' | 'settings'
  icon: LucideIcon
}

const TABS: Tab[] = [
  { href: '/tracker', key: 'tracker', icon: LeafIcon },
  { href: '/path', key: 'path', icon: RouteIcon },
  { href: '/settings', key: 'settings', icon: SettingsIcon },
  // место под будущие: Дневник, Вики
]

export function BottomNav() {
  const t = useTranslations('nav')
  const pathname = usePathname()

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <ul className="mx-auto flex max-w-2xl">
        {TABS.map((tab) => {
          const active =
            pathname === tab.href || pathname.startsWith(`${tab.href}/`)
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
