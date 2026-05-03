import { signInWithMagicLink } from './actions'

// Next.js 16: searchParams приходит как Promise, нужен await.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>
}) {
  const { sent, error } = await searchParams

  return (
    <div className="flex flex-1 items-center justify-center bg-[#FAF6F0] px-6 py-16">
      <main className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm ring-1 ring-black/[0.04]">
        <div className="mb-6 flex items-center gap-2 text-[#5A6B4A]">
          <span className="text-2xl">✦</span>
          <span className="text-sm uppercase tracking-widest">Numia</span>
        </div>

        <h1 className="mb-1 text-2xl font-medium text-[#3A3A3A]">Вход</h1>
        <p className="mb-8 text-sm text-[#7A7A7A]">
          Получи ссылку на почту — пароль не нужен.
        </p>

        {sent ? (
          <div className="space-y-4">
            <div className="rounded-xl bg-[#FAF6F0] p-4 text-sm text-[#3A3A3A]">
              <p className="mb-1 font-medium text-[#5A6B4A]">✓ Ссылка отправлена</p>
              <p className="text-[#7A7A7A]">
                Открой почту <span className="text-[#3A3A3A]">{sent}</span> и перейди по ссылке. Если письма нет — проверь спам.
              </p>
            </div>
            <a
              href="/login"
              className="block text-center text-sm text-[#7A7A7A] underline-offset-4 hover:text-[#5A6B4A] hover:underline"
            >
              Отправить ещё раз
            </a>
          </div>
        ) : (
          <form action={signInWithMagicLink} className="space-y-4">
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

            {error && (
              <p className="text-sm text-rose-600">{error}</p>
            )}

            <button
              type="submit"
              className="w-full rounded-xl bg-[#5A6B4A] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-[#4A5A3A] focus:outline-none focus:ring-2 focus:ring-[#C9B6E4]/60"
            >
              Получить ссылку
            </button>
          </form>
        )}

        <p className="mt-6 text-xs leading-relaxed text-[#7A7A7A]">
          Можно использовать одноразовый email (SimpleLogin, AnonAddy) — мы не блокируем по домену.
        </p>
      </main>
    </div>
  )
}
