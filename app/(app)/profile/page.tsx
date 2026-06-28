import { getTranslations } from 'next-intl/server'

import { ProfileForm } from '@/components/profile/profile-form'

// Профиль — личное пространство (имя, форма обращения; позже добавим больше).
// Отдельно от Настроек: Настройки — техническое (PIN, напоминания), Профиль —
// про себя. Тон тёплый.
export default async function ProfilePage() {
  const t = await getTranslations('profile')

  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-10 sm:py-14">
      <header className="mb-8">
        <h1 className="font-heading text-3xl text-foreground sm:text-4xl">
          {t('title')} <span className="text-fairy">✦</span>
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      <ProfileForm />
    </div>
  )
}
