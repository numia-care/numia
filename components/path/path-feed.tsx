'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'

import { getCryptoKey } from '@/lib/crypto/session'
import { listEntries, type PathEntry } from '@/lib/path/entries'
import { buttonVariants } from '@/components/ui/button'
import { EntryMedia } from './entry-media'

// Лента «Пути»: тянет МЕТАДАННЫЕ записей (listEntries не расшифровывает), затем
// каждая миниатюра лениво расшифровывается сама (PhotoThumb). Экран не блокируем.
//
// Состояния:
//   loading — пока грузятся метаданные
//   pin     — нет DEK в памяти (PIN-сессия пережила reload по TTL, но ключ
//             в памяти потерян) → расшифровать нечем, мягко просим PIN
//   error   — запрос метаданных упал
//   ready   — рендерим ленту (или тёплое пустое состояние)

type State =
  | { kind: 'loading' }
  | { kind: 'pin' }
  | { kind: 'error' }
  | { kind: 'ready'; entries: PathEntry[] }

export function PathFeed() {
  const t = useTranslations('path')
  const [state, setState] = useState<State>({ kind: 'loading' })
  // Счётчик перезагрузок: retry-кнопка инкрементит → эффект перезапускается.
  // Идиоматичный способ «дёрнуть» эффект заново, без вынесенной async-функции.
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false

    // Функция определена ВНУТРИ эффекта и все setState идут после await —
    // так требует правило react-hooks/set-state-in-effect (синхронный setState
    // в теле эффекта каскадит рендеры).
    async function run() {
      try {
        const entries = await listEntries()
        if (cancelled) return
        // DEK нужен для расшифровки превью. Нет в памяти → просим PIN, а не
        // показываем ленту с битыми миниатюрами (метаданные уже получены).
        if (!getCryptoKey()) {
          setState({ kind: 'pin' })
          return
        }
        setState({ kind: 'ready', entries })
      } catch {
        if (!cancelled) setState({ kind: 'error' })
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  function retry() {
    setState({ kind: 'loading' })
    setReloadKey((k) => k + 1)
  }

  if (state.kind === 'loading') return <FeedSkeleton />

  if (state.kind === 'pin') {
    return (
      <Notice
        title={t('pinTitle')}
        text={t('pinText')}
        action={
          <Link href="/pin" className={buttonVariants({ size: 'lg' })}>
            {t('pinButton')}
          </Link>
        }
      />
    )
  }

  if (state.kind === 'error') {
    return (
      <Notice
        text={t('errorText')}
        action={
          <button
            type="button"
            onClick={retry}
            className={buttonVariants({ size: 'lg', variant: 'secondary' })}
          >
            {t('retry')}
          </button>
        }
      />
    )
  }

  if (state.entries.length === 0) return <EmptyState />

  return <Timeline entries={state.entries} />
}

// ── Лента, сгруппированная по месяцам (новые сверху) ─────────────────────────

function Timeline({ entries }: { entries: PathEntry[] }) {
  const groups = groupByMonth(entries)

  return (
    <div className="space-y-10">
      {groups.map((group) => (
        <section key={group.key}>
          <h2 className="mb-4 font-heading text-xl capitalize text-foreground/70">
            {group.label}
          </h2>
          <div className="space-y-5">
            {group.items.map((entry) => (
              <EntryMedia key={entry.id} entry={entry} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

// Группировка по «год-месяц». entries уже отсортированы occurred_at desc
// (listEntries), поэтому группы и записи внутри идут от новых к старым.
function groupByMonth(
  entries: PathEntry[],
): { key: string; label: string; items: PathEntry[] }[] {
  const monthLabel = new Intl.DateTimeFormat('ru-RU', {
    month: 'long',
    year: 'numeric',
  })
  const groups: { key: string; label: string; items: PathEntry[] }[] = []

  for (const entry of entries) {
    const d = new Date(entry.occurredAt)
    const key = `${d.getFullYear()}-${d.getMonth()}`
    const last = groups[groups.length - 1]
    if (last && last.key === key) {
      last.items.push(entry)
    } else {
      groups.push({ key, label: monthLabel.format(d), items: [entry] })
    }
  }
  return groups
}

// ── Вспомогательные состояния экрана ─────────────────────────────────────────

function EmptyState() {
  const t = useTranslations('path')
  return (
    <div className="rounded-2xl bg-card p-8 text-center ring-1 ring-border">
      <div className="mb-3 text-3xl">✦</div>
      <h2 className="mb-2 font-heading text-xl text-foreground">
        {t('emptyTitle')}
      </h2>
      <p className="mx-auto max-w-sm text-foreground/80">{t('emptyText')}</p>
      <div className="mt-6">
        <Link href="/path/new" className={buttonVariants({ size: 'lg' })}>
          {t('emptyButton')}
        </Link>
      </div>
    </div>
  )
}

// Общая карточка-уведомление для pin/error состояний.
function Notice({
  title,
  text,
  action,
}: {
  title?: string
  text: string
  action: React.ReactNode
}) {
  return (
    <div className="rounded-2xl bg-card p-8 text-center ring-1 ring-border">
      {title && (
        <h2 className="mb-2 font-heading text-xl text-foreground">{title}</h2>
      )}
      <p className="mx-auto max-w-sm text-foreground/80">{text}</p>
      <div className="mt-6">{action}</div>
    </div>
  )
}

// Скелетон ленты на время загрузки метаданных — пара «карточек-призраков».
function FeedSkeleton() {
  return (
    <div className="space-y-5" aria-hidden>
      {[0, 1].map((i) => (
        <div
          key={i}
          className="aspect-[4/3] w-full animate-pulse rounded-2xl bg-card ring-1 ring-border"
        />
      ))}
    </div>
  )
}
