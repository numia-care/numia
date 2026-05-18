import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PinGate } from '@/components/pin-gate'

// Layout для защищённых страниц приложения. Два слоя защиты:
//   1. СЕРВЕР: Supabase auth (этот файл). Без cookie сессии → /login.
//      Это настоящая проверка — Server Component, не обойти через клиент.
//   2. КЛИЕНТ: PinGate. Без recent PIN-unlock в текущей сессии → /pin.
//      Это второй фактор: даже если телефон украдут с активной сессией,
//      нужен PIN. Реальная защита данных при компрометации — RLS в Supabase.
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

  return <PinGate>{children}</PinGate>
}
