'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export async function signInWithMagicLink(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim()
  if (!email) {
    redirect(`/login?error=${encodeURIComponent('Введи email')}`)
  }

  // Восстанавливаем origin из заголовков — нужен чтобы emailRedirectTo
  // указывал на правильный домен и в dev (localhost), и в prod.
  const headersList = await headers()
  const host = headersList.get('host') ?? 'localhost:3000'
  const proto = headersList.get('x-forwarded-proto') ?? 'http'
  const origin = `${proto}://${host}`

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${origin}/auth/callback`,
    },
  })

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`)
  }

  redirect(`/login?sent=${encodeURIComponent(email)}`)
}
