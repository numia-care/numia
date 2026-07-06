import { connection } from 'next/server'
import Link from 'next/link'

// Кастомная 404. Существует в первую очередь ради CSP: дефолтная /_not-found
// пререндерится статически, и её скрипты остаются без per-request nonce
// (см. proxy.ts) — браузер их блокирует. connection() переводит страницу на
// динамический рендер, nonce свежий, консоль чистая.
export default async function NotFound() {
  await connection()

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <main className="w-full max-w-md rounded-2xl bg-card p-8 text-center ring-1 ring-border">
        <div className="mb-6 flex items-center justify-center gap-2 text-moss">
          <span className="text-2xl">✦</span>
          <span className="text-sm uppercase tracking-widest">Numia</span>
        </div>

        <h1 className="mb-3 font-heading text-2xl text-foreground">
          Такой страницы нет
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Может, ссылка устарела — или это тропинка, которой ещё не проложили.
        </p>
        <Link
          href="/"
          className="inline-block rounded-xl border border-border bg-card px-4 py-2 text-sm text-foreground transition-colors hover:bg-muted"
        >
          На главную
        </Link>
      </main>
    </div>
  )
}
