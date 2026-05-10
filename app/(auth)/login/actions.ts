'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

const OTP_COOKIE_NAME = 'numia_otp_email'
const OTP_COOKIE_MAX_AGE = 60 * 10 // 10 минут — достаточно ввести код в моменте

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: OTP_COOKIE_MAX_AGE,
  path: '/',
}

// Шаг 1: юзер ввёл email, шлём 6-значный код, кладём email в httpOnly cookie.
export async function requestOtp(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim()
  if (!email) {
    redirect(`/login?error=${encodeURIComponent('Введи email')}`)
  }

  const supabase = await createClient()
  // Без emailRedirectTo — Supabase отправит OTP-код вместо magic link.
  const { error } = await supabase.auth.signInWithOtp({ email })

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`)
  }

  // Email в httpOnly cookie — на шаге verify узнаем кому пришёл код,
  // не светя email в URL/истории/скриншотах.
  const cookieStore = await cookies()
  cookieStore.set(OTP_COOKIE_NAME, email, cookieOptions)

  redirect('/login?step=verify')
}

// Шаг 2: юзер ввёл код, проверяем у Supabase, создаём сессию.
export async function verifyOtp(formData: FormData) {
  const token = String(formData.get('token') ?? '').replace(/\s/g, '')
  if (!/^\d{6}$/.test(token)) {
    redirect(
      `/login?step=verify&error=${encodeURIComponent('Введи 6-значный код')}`,
    )
  }

  const cookieStore = await cookies()
  const email = cookieStore.get(OTP_COOKIE_NAME)?.value
  if (!email) {
    redirect(`/login?error=${encodeURIComponent('Код устарел. Запроси новый.')}`)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: 'email',
  })

  if (error) {
    redirect(`/login?step=verify&error=${encodeURIComponent(error.message)}`)
  }

  // Сессия создана — cookie с email больше не нужна.
  cookieStore.delete(OTP_COOKIE_NAME)
  redirect('/')
}

// Кнопка "Отправить новый код" на шаге verify.
export async function resendOtp() {
  const cookieStore = await cookies()
  const email = cookieStore.get(OTP_COOKIE_NAME)?.value
  if (!email) {
    redirect(
      `/login?error=${encodeURIComponent('Сессия запроса истекла. Введи email заново.')}`,
    )
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithOtp({ email })

  if (error) {
    redirect(`/login?step=verify&error=${encodeURIComponent(error.message)}`)
  }

  // Пролонгируем cookie ещё на 10 минут.
  cookieStore.set(OTP_COOKIE_NAME, email, cookieOptions)

  redirect('/login?step=verify&resent=1')
}

// Ссылка "Изменить email" на шаге verify — чистит cookie, возвращает на шаг 1.
export async function cancelOtp() {
  const cookieStore = await cookies()
  cookieStore.delete(OTP_COOKIE_NAME)
  redirect('/login')
}
