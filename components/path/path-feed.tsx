'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { toast } from 'sonner'

import { getCryptoKey } from '@/lib/crypto/session'
import { deleteEntry, listEntries, type PathEntry } from '@/lib/path/entries'
import { buttonVariants } from '@/components/ui/button'
import { DiaryCard } from './diary-card'
import { EntryMedia } from './entry-media'

// Окно «Отменить» после подтверждения удаления: запись уже скрыта из ленты,
// но реально удаляется только по истечении. Совпадает с duration тоста.
const UNDO_MS = 5000

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

  // ── Отложенное удаление с «Отменить» ────────────────────────────────────────
  // Подтверждение → запись сразу скрыта из ленты, но реальное удаление (ряд +
  // шифроблоб) откладывается на UNDO_MS. «Отменить» в тосте возвращает запись —
  // к серверу ещё не ходили, отменять нечего. Случайный тап перестаёт быть
  // необратимым.

  // Записи, ждущие реального удаления: id → {entry, timer}.
  const pendingRef = useRef(new Map<string, { entry: PathEntry; timer: number }>())

  // Уход со страницы (unmount) до истечения окна: удаляем сразу, fire-and-
  // forget. Иначе таймеры умрут с компонентом, записи «воскреснут» при
  // следующем заходе, хотя юзер видел «Запись убрана».
  useEffect(() => {
    const pending = pendingRef.current
    return () => {
      for (const { entry, timer } of pending.values()) {
        clearTimeout(timer)
        void deleteEntry(entry).catch(() => {
          // Не удалилась — запись просто останется в ленте при следующем
          // заходе. Fail-safe в сторону сохранности данных.
        })
      }
      pending.clear()
    }
  }, [])

  function hideEntry(id: string) {
    setState((s) =>
      s.kind === 'ready'
        ? { kind: 'ready', entries: s.entries.filter((e) => e.id !== id) }
        : s,
    )
  }

  // Вернуть запись на место (undo): вставляем и восстанавливаем порядок ленты
  // (occurred_at desc — ISO-строки сравнимы лексикографически).
  function restoreEntry(entry: PathEntry) {
    setState((s) =>
      s.kind === 'ready'
        ? {
            kind: 'ready',
            entries: [...s.entries, entry].sort((a, b) =>
              b.occurredAt.localeCompare(a.occurredAt),
            ),
          }
        : s,
    )
  }

  function undoDelete(id: string) {
    const p = pendingRef.current.get(id)
    if (!p) return // окно уже истекло, запись удалена по-настоящему
    clearTimeout(p.timer)
    pendingRef.current.delete(id)
    restoreEntry(p.entry)
  }

  function scheduleDelete(entry: PathEntry) {
    hideEntry(entry.id)

    const timer = window.setTimeout(async () => {
      pendingRef.current.delete(entry.id)
      try {
        await deleteEntry(entry)
      } catch {
        // Реальное удаление не удалось — честно возвращаем запись в ленту.
        restoreEntry(entry)
        toast.error(t('delete.error'))
      }
    }, UNDO_MS)

    pendingRef.current.set(entry.id, { entry, timer })

    toast.success(t('delete.success'), {
      action: { label: t('delete.undo'), onClick: () => undoDelete(entry.id) },
      duration: UNDO_MS,
    })
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

  return <Timeline entries={state.entries} onDelete={scheduleDelete} />
}

// ── Лента, сгруппированная по месяцам (новые сверху) ─────────────────────────

function Timeline({
  entries,
  onDelete,
}: {
  entries: PathEntry[]
  onDelete: (entry: PathEntry) => void
}) {
  const groups = groupByMonth(entries)

  return (
    <div className="space-y-10">
      {groups.map((group) => (
        <section key={group.key}>
          <h2 className="mb-4 font-heading text-xl capitalize text-foreground/70">
            {group.label}
          </h2>
          <div className="space-y-5">
            {group.items.map((entry) =>
              entry.entryType === 'diary' ? (
                <DiaryCard key={entry.id} entry={entry} onDelete={onDelete} />
              ) : (
                <EntryMedia key={entry.id} entry={entry} onDelete={onDelete} />
              ),
            )}
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
