import {
  BookOpenIcon,
  ChevronRightIcon,
  FlaskConicalIcon,
  SettingsIcon,
  ShieldCheckIcon,
  UserIcon,
  type LucideIcon,
} from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'

// «Ещё» — список второстепенных разделов, вынесенных из таб-бара: Анализы,
// Вики (заглушка пока), Настройки.
export default async function MorePage() {
  const t = await getTranslations('more')

  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-10 sm:py-14">
      <header className="mb-8">
        <h1 className="font-heading text-3xl text-foreground sm:text-4xl">
          {t('title')}
        </h1>
      </header>

      <ul className="overflow-hidden rounded-2xl bg-card ring-1 ring-border">
        <Row href="/profile" icon={UserIcon} label={t('profile')} />
        <Row href="/labs" icon={FlaskConicalIcon} label={t('labs')} />
        {/* Вики — раздела пока нет, показываем неактивным с пометкой «скоро». */}
        <SoonRow icon={BookOpenIcon} label={t('wiki')} soon={t('soon')} />
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

function SoonRow({
  icon: Icon,
  label,
  soon,
}: {
  icon: LucideIcon
  label: string
  soon: string
}) {
  return (
    <li className="flex items-center gap-3 border-b border-border px-5 py-4 text-foreground/50 last:border-b-0">
      <Icon className="size-5" />
      <span className="flex-1">{label}</span>
      <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
        {soon}
      </span>
    </li>
  )
}
