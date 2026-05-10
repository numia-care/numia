import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

// Защищённая корневая страница. Без сессии — редирект на /login.
// Используем getUser() (а не getSession) — он верифицирует токен на сервере
// Supabase, не доверяясь только cookie. Это рекомендация Supabase для
// защиты страниц в Server Components.
//
// Контент пока — временная "проверка соединения" (заменим на главный экран
// приложения когда дойдём до этапа 1). Сейчас служит как индикатор
// что юзер реально залогинен и Supabase ему отвечает.
export default async function Home() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const projectHost = url ? new URL(url).hostname : '—'

  return (
    <div className="flex flex-1 items-center justify-center bg-[#FAF6F0] px-6 py-16">
      <main className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm ring-1 ring-black/[0.04]">
        <div className="mb-6 flex items-center gap-2 text-[#5A6B4A]">
          <span className="text-2xl">✦</span>
          <span className="text-sm uppercase tracking-widest">Numia</span>
        </div>

        <h1 className="mb-1 text-2xl font-medium text-[#3A3A3A]">
          Ты вошла
        </h1>
        <p className="mb-8 text-sm text-[#7A7A7A]">
          Временная страница — будет заменена на главный экран приложения.
        </p>

        <dl className="space-y-3 text-sm">
          <Row label="Статус">
            <span className="font-medium text-[#5A6B4A]">✓ подключено</span>
          </Row>
          <Row label="Проект">
            <code className="text-[#3A3A3A]">{projectHost}</code>
          </Row>
          <Row label="Юзер">
            <span className="text-[#3A3A3A]">
              {user.email ?? `id ${user.id.slice(0, 8)}…`}
            </span>
          </Row>
        </dl>
      </main>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[#FAF6F0] pb-2 last:border-0">
      <dt className="text-[#7A7A7A]">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  )
}
