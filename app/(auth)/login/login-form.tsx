'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// Клиентский логин-флоу (OTP-код, без magic link).
//
// Почему клиент, а не server actions + redirect (как было раньше): нужен живой
// обратный отсчёт на кнопке resend, блокировка кнопки на время запроса и
// корректный переход на ввод кода даже когда повторные нажатия ловят rate
// limit. Всё это — клиентский стейт. Сессию ставит браузерный supabase-клиент
// (@supabase/ssr пишет те же куки, что читает сервер), как в pin-флоу.
//
// Email живёт в React-стейте (юзер сам его ввёл) — в URL/историю не попадает,
// поэтому httpOnly-cookie из старого флоу больше не нужна.

// Дефолтное окно перед повторной отправкой, если Supabase не сказал точное N.
// Совпадает с типичным rate-limit окном Supabase на отправку письма.
const RESEND_COOLDOWN = 60

type Step = 'email' | 'verify'

export function LoginForm() {
  const router = useRouter()
  const [supabase] = useState(() => createClient())

  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // Момент (epoch ms), до которого resend заблокирован; 0 — можно отправлять.
  // Храним АБСОЛЮТНЫЙ дедлайн, а не счётчик секунд: setInterval в фоновой вкладке
  // тормозится/замораживается, счётчик «отстаёт» от реального времени — из-за
  // этого таймер висел после возврата спустя минуты. От стенных часов остаток
  // считается верно при любой заморозке.
  const [cooldownUntil, setCooldownUntil] = useState(0)
  // «Сейчас» — тикает раз в секунду, пока активен дедлайн. Нужен только чтобы
  // перерисовывать счётчик; само число секунд — производное (ниже).
  const [now, setNow] = useState(() => Date.now())

  // Оставшиеся секунды считаем В РЕНДЕРЕ из дедлайна и текущего времени — без
  // отдельного стейта и без setState в эффекте (тот давал каскадные ререндеры).
  const cooldown = cooldownUntil > now ? Math.ceil((cooldownUntil - now) / 1000) : 0

  useEffect(() => {
    if (cooldownUntil <= 0) return
    const id = setInterval(() => {
      const t = Date.now()
      setNow(t)
      if (t >= cooldownUntil) setCooldownUntil(0) // окно истекло — гасим таймер
    }, 1000)
    // Возврат вкладки из фона: интервал мог простоять — подтягиваем время сразу,
    // иначе кнопка осталась бы заблокированной дольше, чем реально нужно.
    const onVisible = () => {
      if (!document.hidden) setNow(Date.now())
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [cooldownUntil])

  // Отправка/переотправка кода. isResend — для текста уведомления.
  async function send(isResend: boolean) {
    // Защита от множественных нажатий: пока идёт запрос или тикает таймер —
    // молча выходим (плюс кнопка disabled, это второй слой).
    if (loading || cooldown > 0) return

    const target = email.trim()
    if (!target) {
      setError('Введи email')
      return
    }

    setLoading(true)
    setError(null)
    setNotice(null)

    // shouldCreateUser: true (это и дефолт) — для НОВЫХ юзеров signInWithOtp
    // создаёт аккаунт и шлёт код (шаблон "Confirm signup"). Для существующих —
    // шлёт код (шаблон "Magic Link"). Никаких magic link: emailRedirectTo не задаём.
    const { error: err } = await supabase.auth.signInWithOtp({
      email: target,
      options: { shouldCreateUser: true },
    })

    setLoading(false)

    if (err) {
      if (isRateLimit(err)) {
        // Rate limit на ОТПРАВКУ означает, что код недавно уже улетел. Ведём
        // юзера на ввод кода (а не оставляем на email с ошибкой) и заводим
        // таймер resend. Это и есть фикс «код пришёл, а ввести негде».
        const secs = parseRetryAfter(err) ?? RESEND_COOLDOWN
        setNow(Date.now())
        setCooldownUntil(Date.now() + secs * 1000)
        setStep('verify')
        setNotice('Код уже отправлен — проверь почту, в т.ч. спам.')
        return
      }
      setError(translateAuthError(err))
      return
    }

    // Успех: код ушёл, переходим на ввод и блокируем resend на окно отправки.
    setNow(Date.now())
    setCooldownUntil(Date.now() + RESEND_COOLDOWN * 1000)
    setStep('verify')
    if (isResend) setNotice('Новый код отправлен')
  }

  async function verify() {
    if (loading) return
    const token = code.replace(/\s/g, '')
    if (!/^\d{6}$/.test(token)) {
      setError('Введи 6-значный код')
      return
    }

    setLoading(true)
    setError(null)

    const { error: err } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token,
      type: 'email',
    })

    if (err) {
      setLoading(false)
      setError(translateAuthError(err))
      return
    }

    // Сессия записана в куки браузерным клиентом — уходим в приложение.
    router.replace('/')
  }

  function changeEmail() {
    setStep('email')
    setCode('')
    setError(null)
    setNotice(null)
    // cooldown намеренно НЕ сбрасываем — rate limit у Supabase общий, не дадим
    // обойти его сменой шага.
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-background px-6 py-16">
      <main className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm ring-1 ring-black/[0.04]">
        <div className="mb-6 flex items-center gap-2 text-foreground">
          <span className="text-2xl">✦</span>
          <span className="text-sm uppercase tracking-widest">Numia</span>
        </div>

        {step === 'email' ? (
          <>
            <h1 className="mb-1 text-2xl font-medium text-foreground">Вход</h1>
            <p className="mb-8 text-sm text-muted-foreground">
              Получи 6-значный код на почту — пароль не нужен.
            </p>

            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                send(false)
              }}
            >
              <label className="block">
                <span className="mb-1.5 block text-sm text-foreground">Email</span>
                <input
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="ты@почта.com"
                  disabled={loading}
                  className="w-full rounded-xl border border-border bg-white px-4 py-3 text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/40 disabled:opacity-60"
                />
              </label>

              {error && <p className="text-sm text-rose-600">{error}</p>}

              <button
                type="submit"
                disabled={loading || cooldown > 0}
                className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-ring/60"
              >
                {loading
                  ? 'Отправляем…'
                  : cooldown > 0
                    ? `Подожди ${cooldown} с`
                    : 'Получить код'}
              </button>
            </form>

            {/* Обещание прозрачности с /safety — говорим сразу, на входе. */}
            <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
              Почта нужна только для входа. Это единственное, что связывает
              аккаунт с тобой, поэтому можно любую, хоть одноразовую
              (SimpleLogin, AnonAddy). Не блокируем ✦
            </p>
          </>
        ) : (
          <>
            <h1 className="mb-1 text-2xl font-medium text-foreground">Введи код</h1>
            <p className="mb-6 text-sm text-muted-foreground">
              Код отправлен на <span className="text-foreground">{email}</span>.
              Проверь почту, в т.ч. папку спам.
            </p>

            {notice && (
              <div className="mb-4 rounded-xl bg-background p-3 text-sm text-foreground">
                ✓ {notice}
              </div>
            )}

            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                verify()
              }}
            >
              <label className="block">
                <span className="mb-1.5 block text-sm text-foreground">Код</span>
                <input
                  name="token"
                  type="text"
                  required
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="123456"
                  disabled={loading}
                  className="w-full rounded-xl border border-border bg-white px-4 py-3 text-center text-2xl tracking-[0.5em] text-foreground outline-none placeholder:text-muted-foreground placeholder:tracking-normal focus:border-ring focus:ring-2 focus:ring-ring/40 disabled:opacity-60"
                />
              </label>

              {error && <p className="text-sm text-rose-600">{error}</p>}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-ring/60"
              >
                {loading ? 'Проверяем…' : 'Войти'}
              </button>
            </form>

            <div className="mt-6 flex items-center justify-between text-sm">
              <button
                type="button"
                onClick={() => send(true)}
                disabled={loading || cooldown > 0}
                className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
              >
                {cooldown > 0
                  ? `Отправить заново через ${cooldown} с`
                  : 'Отправить код заново'}
              </button>
              <button
                type="button"
                onClick={changeEmail}
                disabled={loading}
                className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
              >
                Изменить email
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  )
}

// ── Разбор и перевод ошибок Supabase ────────────────────────────────────────

interface AuthErrorLike {
  message: string
  status?: number
}

// Rate limit на отправку: 429 либо знакомая формулировка Supabase.
function isRateLimit(err: AuthErrorLike): boolean {
  return (
    err.status === 429 ||
    /rate limit|after \d+ seconds|for security purposes/i.test(err.message)
  )
}

// "For security purposes, you can only request this after 58 seconds." → 58.
function parseRetryAfter(err: AuthErrorLike): number | null {
  const m = err.message.match(/after (\d+) seconds?/i)
  return m ? parseInt(m[1], 10) : null
}

// Англоязычные сообщения Supabase → мягкий русский.
function translateAuthError(err: AuthErrorLike): string {
  if (isRateLimit(err)) {
    return 'Слишком часто. Подожди немного и попробуй снова.'
  }
  const msg = err.message.toLowerCase()
  if (msg.includes('expired') || msg.includes('invalid')) {
    return 'Код неверный или устарел. Запроси новый.'
  }
  return 'Не получилось. Попробуй ещё раз.'
}
