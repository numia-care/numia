'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { lock } from '@/lib/crypto/session'
import { createClient } from '@/lib/supabase/client'

/**
 * Кнопка «Выйти». Завершает Supabase-сессию и уводит на /login.
 *
 * lock() забывает in-memory crypto-ключ и флаг разблокировки сессии. PIN на
 * устройстве НЕ удаляем — это не «забыл PIN», а обычный выход: при следующем
 * входе тем же устройством снова попросят тот же PIN (см. forgot-flow в
 * (auth)/pin/form.tsx — там PIN как раз чистится, здесь нет).
 */
export function SignOutButton() {
  const t = useTranslations('settings')
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const onSignOut = () => {
    startTransition(async () => {
      lock()
      const supabase = createClient()
      await supabase.auth.signOut()
      router.replace('/login')
    })
  }

  return (
    <Button
      variant="outline"
      size="lg"
      className="w-full"
      disabled={isPending}
      onClick={onSignOut}
    >
      {isPending ? t('signingOut') : t('signOut')}
    </Button>
  )
}
