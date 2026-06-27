import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PinUnlockForm } from './form'

// Разблокировка по PIN — экран который показывается при:
//   - холодном старте / reload PWA (DEK в памяти потерян)
//   - возврате из фона после грейс-периода (дольше LOCK_GRACE_MS)
//   - попытке зайти на защищённую страницу до unlock
export default async function PinPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return <PinUnlockForm />
}
