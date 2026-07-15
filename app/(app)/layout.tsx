import { redirect } from 'next/navigation'

import { BiometricOffer } from '@/components/biometric-offer'
import { BottomNav } from '@/components/nav/bottom-nav'
import { PinGate } from '@/components/pin-gate'
import { PushSelfHeal } from '@/components/push/push-self-heal'
import { TimezoneSync } from '@/components/timezone-sync'
import { createClient } from '@/lib/supabase/server'

// Layout для защищённых страниц приложения. Два слоя защиты:
//   1. СЕРВЕР: Supabase auth (этот файл). Без cookie сессии → /login.
//   2. КЛИЕНТ: PinGate. Без recent PIN-unlock в сессии → /pin.
// Плюс невидимый TimezoneSync — обновляет profiles.timezone из браузера,
// и PushSelfHeal — поддерживает push-подписку живой.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <PinGate>
      <TimezoneSync />
      <PushSelfHeal />
      <BiometricOffer />
      {/* padding-bottom = плавающая пилюля (62px) + её отступ + запас + iOS
          safe-area, чтобы BottomNav не перекрывал контент в самом низу. */}
      <div className="min-h-dvh pb-[calc(6.5rem+env(safe-area-inset-bottom))]">
        {children}
      </div>
      <BottomNav />
    </PinGate>
  )
}
