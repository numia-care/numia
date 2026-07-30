'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'

import { decryptNote, type MoodLevel, type PathEntry } from '@/lib/path/entries'
import { cn } from '@/lib/utils'
import { MoodBadge } from './mood-badge'

// Дневниковая карточка по PNG-эталону «путь1/3»: чистая белая карточка r:20,
// текст 12px (обрезан многоточием), внизу дата (ДД.ММ.ГГ, semibold) слева и
// муд-бейдж справа. Без ярлыка «Дневник» — тип читается по виду. Кнопок в
// карточке нет (как в макете): тап открывает полный просмотр.
// Текст шифрован — расшифровываем лениво (когда карточка у вьюпорта).

const dateLabel = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
})

export function DiaryCard({
  entry,
  onOpen,
}: {
  entry: PathEntry
  onOpen: (entry: PathEntry) => void
}) {
  const t = useTranslations('path')
  const containerRef = useRef<HTMLDivElement>(null)

  const [visible, setVisible] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

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

  const date = dateLabel.format(new Date(entry.occurredAt))
  const hasNote = entry.noteCiphertext !== null

  return (
    <div
      ref={containerRef}
      className={cn(
        'shadow-card relative rounded-[20px] bg-card p-4 transition-all duration-500 motion-reduce:transition-none',
        // Отклик на нажатие: карточка мягко «проседает» под пальцем.
        'has-[.entry-open:active]:scale-[0.98]',
        visible ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0',
      )}
    >
      {/* Невидимая кнопка на всю карточку — открывает полный просмотр, где
          текст виден целиком (в ленте он обрезан многоточием). */}
      <button
        type="button"
        onClick={() => onOpen(entry)}
        aria-label={t('viewer.open')}
        className="entry-open absolute inset-0 z-0 cursor-pointer"
      />

      {/* Текст: до 8 строк, дальше многоточие (как в эталоне «...ког...»). */}
      {hasNote &&
        (failed ? (
          <p className="text-xs text-foreground/50">{t('thumbError')}</p>
        ) : note !== null ? (
          <p className="line-clamp-5 text-[12px] leading-[1.4] text-foreground">
            {note}
          </p>
        ) : (
          <div className="space-y-1.5">
            <div className="h-3 w-full animate-pulse rounded bg-foreground/5" />
            <div className="h-3 w-4/5 animate-pulse rounded bg-foreground/5" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-foreground/5" />
          </div>
        ))}

      <div className={cn('flex items-center justify-between gap-2', hasNote && 'mt-3')}>
        <time className="text-[11px] font-semibold text-foreground" dateTime={entry.occurredAt}>
          {date}
        </time>
        {entry.mood != null && (
          <MoodBadge level={entry.mood as MoodLevel} size={24} />
        )}
      </div>
    </div>
  )
}
