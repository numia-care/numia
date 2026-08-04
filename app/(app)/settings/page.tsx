import { getTranslations } from 'next-intl/server'

import { BiometricToggle } from '@/components/settings/biometric-toggle'
import { SignOutButton } from '@/components/settings/sign-out-button'

/**
 * Настройки: секция безопасности (биометрия) + выход + список будущих
 * разделов. Остальные (напоминания, смена PIN, язык) подключим позже.
 */
export default async function SettingsPage() {
  const t = await getTranslations('settings')

  const future: Array<'reminders' | 'pin' | 'language'> = [
    'reminders',
    'pin',
    'language',
  ]

  return (
    <div className="page-shell py-10 sm:py-14">
      <header className="mb-6">
        <h1 className="font-heading text-3xl text-foreground sm:text-4xl">
          {t('title')}
        </h1>
      </header>

      <section className="mb-8">
        <p className="mb-3 text-sm text-muted-foreground">
          {t('securityTitle')}
        </p>
        <div className="overflow-hidden rounded-2xl bg-card ring-1 ring-border">
          <BiometricToggle />
        </div>
      </section>

      {/* Будущие разделы — видны, но неактивны, с пометкой «скоро». */}
      <section className="mb-8">
        <p className="mb-3 text-sm text-muted-foreground">{t('futureTitle')}</p>
        <ul className="overflow-hidden rounded-2xl bg-card ring-1 ring-border">
          {future.map((key) => (
            <li
              key={key}
              className="flex items-center justify-between border-b border-border px-5 py-4 text-foreground/70 last:border-b-0"
            >
              <span>{t(key)}</span>
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
                {t('soon')}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <SignOutButton />
    </div>
  )
}
