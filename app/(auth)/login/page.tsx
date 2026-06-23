import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { LoginForm } from './login-form'

// Серверный гард: уже залогиненного юзера не держим на форме входа.
// Сам OTP-флоу (email → код, таймеры, переходы) — в клиентском LoginForm.
export default async function LoginPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user) {
    redirect('/')
  }

  return <LoginForm />
}
