import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PinUnlockForm } from './form'

// Разблокировка по PIN — экран который показывается при:
//   - открытии PWA с валидной Supabase-сессией но без recent unlock
//   - возврате из фона после истечения UNLOCK_TTL_MS
//   - попытке зайти на защищённую страницу до unlock
export default async function PinPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return <PinUnlockForm />
}
