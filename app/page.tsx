import { createClient } from '@/lib/supabase/server'

// Временная страница: визуальная проверка что Supabase реально подключён.
// Будет заменена на реальный лендинг/редирект на /login после magic link auth.
export default async function Home() {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getSession()

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const projectHost = url ? new URL(url).hostname : '—'
  const ok = !error

  return (
    <div className="flex flex-1 items-center justify-center bg-[#FAF6F0] px-6 py-16">
      <main className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm ring-1 ring-black/[0.04]">
        <div className="mb-6 flex items-center gap-2 text-[#5A6B4A]">
          <span className="text-2xl">✦</span>
          <span className="text-sm uppercase tracking-widest">Numia</span>
        </div>

        <h1 className="mb-1 text-2xl font-medium text-[#3A3A3A]">
          Проверка соединения
        </h1>
        <p className="mb-8 text-sm text-[#7A7A7A]">
          Server component → <code className="rounded bg-[#FAF6F0] px-1.5 py-0.5 text-xs">supabase.auth.getSession()</code>
        </p>

        <dl className="space-y-3 text-sm">
          <Row label="Статус">
            {ok ? (
              <span className="font-medium text-[#5A6B4A]">✓ подключено</span>
            ) : (
              <span className="font-medium text-rose-600">✗ ошибка</span>
            )}
          </Row>
          <Row label="Проект">
            <code className="text-[#3A3A3A]">{projectHost}</code>
          </Row>
          <Row label="Сессия">
            <span className="text-[#3A3A3A]">
              {data?.session ? `user ${data.session.user.id.slice(0, 8)}…` : 'нет (ожидаемо — auth ещё не подключён)'}
            </span>
          </Row>
          {error && (
            <Row label="Ошибка">
              <span className="text-rose-600">{error.message}</span>
            </Row>
          )}
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
