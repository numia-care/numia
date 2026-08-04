import {
  ChevronRightIcon,
  SettingsIcon,
  ShieldCheckIcon,
  type LucideIcon,
} from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'

import { ProfileForm } from '@/components/profile/profile-form'

// Профиль — дом для всего личного и служебного (вкладка таб-бара вместо
// бывшего «Ещё»). Сверху — про себя (имя, форма обращения), ниже — разделы:
// Безопасность и Настройки. Тон тёплый.
//
// «Анализы» и «Вики» убраны в полировке «убрать лишнее» (заход 1,
// 2026-08-04): анализы живут вкладкой внутри «Препаратов» (IA Кая), а вики
// раздела пока нет вовсе — строчка «скоро» была обещанием без содержимого.
export default async function ProfilePage() {
  const t = await getTranslations('profile')

  return (
    <div className="page-shell py-10 sm:py-14">
      <header className="mb-6">
        <h1 className="font-heading text-3xl text-foreground sm:text-4xl">
          {t('title')}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      <ProfileForm />

      {/* Разделы бывшего «Ещё» — список-пилюли, как раньше на /more. */}
      <ul className="mt-10 overflow-hidden rounded-2xl bg-card ring-1 ring-border">
        <Row href="/safety" icon={ShieldCheckIcon} label={t('safety')} />
        <Row href="/settings" icon={SettingsIcon} label={t('settings')} />
      </ul>
    </div>
  )
}

function Row({
  href,
  icon: Icon,
  label,
}: {
  href: string
  icon: LucideIcon
  label: string
}) {
  return (
    <li className="border-b border-border last:border-b-0">
      <Link
        href={href}
        className="flex items-center gap-3 px-5 py-4 text-foreground transition-colors hover:bg-muted/40"
      >
        <Icon className="size-5 text-moss" />
        <span className="flex-1">{label}</span>
        <ChevronRightIcon className="size-4 text-muted-foreground" />
      </Link>
    </li>
  )
}

// SoonRow («Вики — скоро») удалён вместе с самим пунктом: других
// неактивных строк на этом экране не осталось.
