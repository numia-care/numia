'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'

import { decryptNote, type MoodLevel, type PathEntry } from '@/lib/path/entries'
import { MOOD_COLOR } from '@/lib/path/mood'
import { EntryDeleteButton } from './entry-delete-button'

// Карточка дневниковой записи в ленте «Пути»: индикатор настроения (если есть) +
// расшифрованный текст (если есть) + дата. Настроение открыто (edет в
// метаданных, расшифровка не нужна). Текст шифрован — расшифровываем лениво, как
// подпись фото: пока запись не подъехала к вьюпорту, шифротекст не трогаем.

const dayLabel = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' })

export function DiaryCard({
  entry,
  onDeleted,
}: {
  entry: PathEntry
  onDeleted: (id: string) => void
}) {
  const t = useTranslations('path')
  const tMood = useTranslations('path.mood')
  const containerRef = useRef<HTMLDivElement>(null)

  const [visible, setVisible] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  // Ленивость: грузим/расшифровываем текст, только когда карточка близко к экрану.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible(true)
          io.disconnect()
        }
      },
      { rootMargin: '200px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!visible || !entry.noteCiphertext) return
    let active = true
    async function load() {
      try {
        const text = await decryptNote(entry)
        if (active) setNote(text)
      } catch {
        if (active) setFailed(true)
      }
    }
    load()
    return () => {
      active = false
    }
  }, [visible, entry])

  const date = dayLabel.format(new Date(entry.occurredAt))
  const hasNote = entry.noteCiphertext !== null

  return (
    <div
      ref={containerRef}
      className="rounded-2xl bg-card p-4 ring-1 ring-border"
    >
      {/* «Ярлычок»-заголовок карточки — как в концепции макета. */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('diaryTag')}
        </span>
        <div className="flex items-center gap-2">
          <time className="text-sm text-foreground/60" dateTime={entry.occurredAt}>
            {date}
          </time>
          <EntryDeleteButton entry={entry} onDeleted={onDeleted} />
        </div>
      </div>

      {/* Индикатор настроения (если есть) — ✦ в цвете ступени + подпись,
          тот же язык, что в шкале ввода. */}
      {entry.mood != null && (
        <div className="mb-2 flex items-center gap-2">
          <span
            aria-hidden
            className="text-lg leading-none"
            style={{ color: MOOD_COLOR[entry.mood as MoodLevel] }}
          >
            ✦
          </span>
          <span className="text-sm text-foreground/80">
            {tMood(`level.${entry.mood}`)}
          </span>
        </div>
      )}

      {/* Текст (если есть). Пока расшифровывается — мягкий скелетон. */}
      {hasNote &&
        (failed ? (
          <p className="text-sm text-foreground/50">{t('thumbError')}</p>
        ) : note !== null ? (
          <p className="whitespace-pre-wrap text-foreground/90">{note}</p>
        ) : (
          <div className="h-5 w-2/3 animate-pulse rounded bg-foreground/5" />
        ))}
    </div>
  )
}
