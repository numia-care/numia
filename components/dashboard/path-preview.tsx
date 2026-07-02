'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'

import { getCryptoKey } from '@/lib/crypto/session'
import { listEntries, type PathEntry } from '@/lib/path/entries'
import { PathPreviewItem } from './path-preview-item'

// Превью «Пути» на дашборде: 1–2 последние записи с расшифровкой. Нет записей
// (или нечем расшифровать) → тёплая заглушка. Вся карточка — ссылка в «Путь».
type State = { kind: 'loading' } | { kind: 'ready'; entries: PathEntry[] }

export function PathPreview() {
  const t = useTranslations('dashboard')
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false

    // Функция внутри эффекта, setState только после await (правило
    // react-hooks/set-state-in-effect).
    async function run() {
      try {
        const entries = await listEntries()
        if (cancelled) return
        // DEK нужен для расшифровки превью; нет в памяти → показываем заглушку
        // (на дашборде PinGate его гарантирует, это страховка).
        if (!getCryptoKey()) {
          setState({ kind: 'ready', entries: [] })
          return
        }
        setState({ kind: 'ready', entries: entries.slice(0, 2) })
      } catch {
        if (!cancelled) setState({ kind: 'ready', entries: [] })
      }
    }
    run()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <Link
      href="/path"
      className="block rounded-2xl bg-card p-5 ring-1 ring-border transition-colors hover:ring-sage/50"
    >
      <h2 className="font-heading text-lg text-foreground">{t('pathTitle')}</h2>

      {state.kind === 'loading' ? (
        <div className="mt-3 h-14 animate-pulse rounded-xl bg-muted/40" />
      ) : state.entries.length === 0 ? (
        <p className="mt-1 text-sm text-foreground/70">{t('pathEmpty')}</p>
      ) : (
        <div className="mt-3 space-y-3">
          {state.entries.map((entry) => (
            <PathPreviewItem key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </Link>
  )
}
