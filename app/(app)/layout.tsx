import { redirect } from 'next/navigation'

import { BottomNav } from '@/components/nav/bottom-nav'
import { PinGate } from '@/components/pin-gate'
import { ProfileSync } from '@/components/profile-sync'
import { PushSelfHeal } from '@/components/push/push-self-heal'
import { TimezoneSync } from '@/components/timezone-sync'
import { getAuthUser } from '@/lib/supabase/server'

// Layout для защищённых страниц приложения. Два слоя защиты:
//   1. СЕРВЕР: Supabase auth (этот файл). Без cookie сессии → /login.
//   2. КЛИЕНТ: PinGate. Без recent PIN-unlock в сессии → /pin.
// Плюс невидимые: TimezoneSync — обновляет profiles.timezone из браузера,
// PushSelfHeal — поддерживает push-подписку живой, ProfileSync — тянет/
// поднимает E2E-профиль (имя + форма обращения) после разблокировки.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // getAuthUser кэширован на запрос — страницы под layout'ом переиспользуют
  // этот же результат, не бегая в Supabase Auth ещё раз.
  const user = await getAuthUser()
  if (!user) redirect('/login')

  return (
    <PinGate>
      <TimezoneSync />
      <PushSelfHeal />
      <ProfileSync />
      {/* padding-bottom = плавающая пилюля (62px) + её отступ + запас + iOS
          safe-area, чтобы BottomNav не перекрывал контент в самом низу. */}
      <div className="min-h-dvh pb-[calc(6.5rem+env(safe-area-inset-bottom))]">
        {children}
      </div>
      <BottomNav />
    </PinGate>
  )
}
