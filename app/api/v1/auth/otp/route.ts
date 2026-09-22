import { mapAuthError } from '@/lib/api/auth'
import { OTP_PER_EMAIL, OTP_PER_IP } from '@/lib/api/auth-flow'
import { apiNoContent, parseJsonBody, withErrorBoundary } from '@/lib/api/http'
import { clientIp, enforceRateLimits } from '@/lib/api/rate-limit'
import { OtpRequestSchema } from '@/lib/api/schemas'
import { createAnonClient } from '@/lib/supabase/bff'

/**
 * POST /api/v1/auth/otp — отправить 6-значный код на почту.
 *
 * Повторяет вход веба (app/(auth)/login/login-form.tsx): signInWithOtp без
 * ссылки. Для нового адреса Supabase заодно создаёт аккаунт.
 *
 * Ответ ВСЕГДА 204, существует адрес или нет. Если отвечать по-разному,
 * через этот эндпоинт можно выяснять, кто пользуется приложением, — а для
 * этой аудитории сам факт аккаунта уже чувствительная информация.
 */
export const POST = withErrorBoundary(async (request: Request) => {
  const parsed = await parseJsonBody(request, OtpRequestSchema)
  if ('response' in parsed) return parsed.response
  const { email } = parsed.data

  const limited = enforceRateLimits([
    [OTP_PER_EMAIL, email],
    [OTP_PER_IP, clientIp(request)],
  ])
  if (limited) return limited

  const { error } = await createAnonClient().auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  })

  if (error) {
    return mapAuthError(error, () => {
      // Остальные ошибки наружу не показываем (см. про 204 выше), но в лог
      // пишем — иначе сломанную почтовую рассылку никто не заметит.
      // Сам адрес в лог не попадает.
      console.error('otp send failed:', error.code ?? error.status)
      return apiNoContent()
    })
  }
  return apiNoContent()
})
