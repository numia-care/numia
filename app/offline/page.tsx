import { connection } from 'next/server'

// Страница, которая показывается когда юзер офлайн и нужного кеша нет.
// Намеренно без зависимостей от Supabase / клиентского JS — чтобы рендерилась
// в любом состоянии. SW кеширует её на install.
export default async function OfflinePage() {
  // Динамический рендер (не prerender): CSP-nonce генерится per-request в
  // proxy.ts, а в prerendered HTML скрипты Next остались бы без nonce и
  // блокировались бы. SW кеширует страницу целиком с install — консистентно.
  await connection()
  return (
    <div className="flex flex-1 items-center justify-center bg-background px-6 py-16">
      <main className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-black/[0.04]">
        <div className="mb-6 flex items-center justify-center gap-2 text-foreground">
          <span className="text-2xl">✦</span>
          <span className="text-sm uppercase tracking-widest">Numia</span>
        </div>

        <h1 className="mb-3 text-2xl font-medium text-foreground">Без сети</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Соединения нет. Numia подождёт
        </p>
        {/* Намеренно hard navigation (<a>, не <Link>): нужен полный page reload
            чтобы SW перехватил запрос и отдал кеш или сходил в сеть свежим. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/"
          className="inline-block rounded-xl border border-border bg-white px-4 py-2 text-sm text-foreground hover:bg-background"
        >
          Попробовать снова
        </a>
      </main>
    </div>
  )
}
