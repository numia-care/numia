import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PinSetupForm } from './form'

// Создание PIN — после первого OTP-логина на устройстве.
// Server-side проверяем что есть Supabase-сессия (без неё нечего защищать PIN'ом).
// Случай "PIN уже создан, юзер случайно пришёл сюда" обрабатывает клиентский
// PinGate в (app)/layout — он бы не пустил юзера сюда обычным флоу.
export default async function PinSetupPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return <PinSetupForm />
}
