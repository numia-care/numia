import { redirect } from 'next/navigation'

import { PinGate } from '@/components/pin-gate'
import { TimezoneSync } from '@/components/timezone-sync'
import { createClient } from '@/lib/supabase/server'

// Layout для защищённых страниц приложения. Два слоя защиты:
//   1. СЕРВЕР: Supabase auth (этот файл). Без cookie сессии → /login.
//   2. КЛИЕНТ: PinGate. Без recent PIN-unlock в сессии → /pin.
// Плюс невидимый TimezoneSync — обновляет profiles.timezone из браузера.
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
      {children}
    </PinGate>
  )
}
