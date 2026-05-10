import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { cancelOtp, requestOtp, resendOtp, verifyOtp } from './actions'

const OTP_COOKIE_NAME = 'numia_otp_email'

// Двухшаговый OTP flow: ?step=verify рендерит шаг ввода кода, иначе шаг email.
// State между шагами хранится в httpOnly cookie с email — не в URL,
// чтобы email не светился в истории/скриншотах.
//
// Если юзер уже залогинен — редирект на /, чтобы не висел на форме входа.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string; error?: string; resent?: string }>
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user) {
    redirect('/')
  }

  const { step, error, resent } = await searchParams

  if (step === 'verify') {
    const cookieStore = await cookies()
    const email = cookieStore.get(OTP_COOKIE_NAME)?.value
    if (!email) {
      // Cookie протухла или сюда пришли минуя шаг 1 — возвращаемся на email.
      redirect('/login')
    }
    return <VerifyStep email={email} error={error} resent={Boolean(resent)} />
  }

  return <EmailStep error={error} />
}

function Brand() {
  return (
    <div className="mb-6 flex items-center gap-2 text-[#5A6B4A]">
      <span className="text-2xl">✦</span>
      <span className="text-sm uppercase tracking-widest">Numia</span>
    </div>
  )
}

function EmailStep({ error }: { error?: string }) {
  return (
    <div className="flex flex-1 items-center justify-center bg-[#FAF6F0] px-6 py-16">
      <main className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm ring-1 ring-black/[0.04]">
        <Brand />
        <h1 className="mb-1 text-2xl font-medium text-[#3A3A3A]">Вход</h1>
        <p className="mb-8 text-sm text-[#7A7A7A]">
          Получи 6-значный код на почту — пароль не нужен.
        </p>

        <form action={requestOtp} className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm text-[#3A3A3A]">Email</span>
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="ты@почта.com"
              className="w-full rounded-xl border border-[#E8E2D8] bg-white px-4 py-3 text-[#3A3A3A] outline-none placeholder:text-[#B8B0A4] focus:border-[#9CAF88] focus:ring-2 focus:ring-[#C9B6E4]/40"
            />
          </label>

          {error && <p className="text-sm text-rose-600">{error}</p>}

          <button
            type="submit"
            className="w-full rounded-xl bg-[#5A6B4A] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-[#4A5A3A] focus:outline-none focus:ring-2 focus:ring-[#C9B6E4]/60"
          >
            Получить код
          </button>
        </form>

        <p className="mt-6 text-xs leading-relaxed text-[#7A7A7A]">
          Можно использовать одноразовый email (SimpleLogin, AnonAddy) — мы не блокируем по домену.
        </p>
      </main>
    </div>
  )
}

function VerifyStep({
  email,
  error,
  resent,
}: {
  email: string
  error?: string
  resent: boolean
}) {
  return (
    <div className="flex flex-1 items-center justify-center bg-[#FAF6F0] px-6 py-16">
      <main className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm ring-1 ring-black/[0.04]">
        <Brand />
        <h1 className="mb-1 text-2xl font-medium text-[#3A3A3A]">Введи код</h1>
        <p className="mb-6 text-sm text-[#7A7A7A]">
          Код отправлен на <span className="text-[#3A3A3A]">{email}</span>.
          Проверь почту, в т.ч. папку спам.
        </p>

        {resent && (
          <div className="mb-4 rounded-xl bg-[#FAF6F0] p-3 text-sm text-[#5A6B4A]">
            ✓ Новый код отправлен
          </div>
        )}

        <form action={verifyOtp} className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm text-[#3A3A3A]">Код</span>
            <input
              name="token"
              type="text"
              required
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="123456"
              className="w-full rounded-xl border border-[#E8E2D8] bg-white px-4 py-3 text-center text-2xl tracking-[0.5em] text-[#3A3A3A] outline-none placeholder:text-[#B8B0A4] placeholder:tracking-normal focus:border-[#9CAF88] focus:ring-2 focus:ring-[#C9B6E4]/40"
            />
          </label>

          {error && <p className="text-sm text-rose-600">{error}</p>}

          <button
            type="submit"
            className="w-full rounded-xl bg-[#5A6B4A] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-[#4A5A3A] focus:outline-none focus:ring-2 focus:ring-[#C9B6E4]/60"
          >
            Войти
          </button>
        </form>

        <div className="mt-6 flex items-center justify-between text-sm">
          <form action={resendOtp}>
            <button
              type="submit"
              className="text-[#7A7A7A] underline-offset-4 hover:text-[#5A6B4A] hover:underline"
            >
              Отправить новый код
            </button>
          </form>
          <form action={cancelOtp}>
            <button
              type="submit"
              className="text-[#7A7A7A] underline-offset-4 hover:text-[#5A6B4A] hover:underline"
            >
              Изменить email
            </button>
          </form>
        </div>
      </main>
    </div>
  )
}
