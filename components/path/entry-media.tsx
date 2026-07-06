'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'

import { decryptCaption, loadMediaUrl, type PathEntry } from '@/lib/path/entries'
import { EntryDeleteButton } from './entry-delete-button'

// Одна запись ленты (фото или голос). Лениво (когда подъезжает к вьюпорту)
// скачивает шифроблоб, расшифровывает на устройстве и показывает медиа + дату +
// подпись. До этого — скелетон, чтобы не блокировать прокрутку всей ленты.
//
// Ветвление по entry_type: photo → <img>, voice → <audio controls>. Логика
// загрузки/расшифровки/освобождения общая (медиа — это object URL в обоих
// случаях).
//
// Память: расшифрованное медиа живёт как object URL. Его ОБЯЗАТЕЛЬНО отзываем
// при размонтировании (и если успели размонтироваться, пока шло скачивание) —
// иначе блобы копятся до перезагрузки страницы.

const dayLabel = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' })

export function EntryMedia({
  entry,
  onDeleted,
}: {
  entry: PathEntry
  onDeleted: (id: string) => void
}) {
  const t = useTranslations('path')
  const containerRef = useRef<HTMLDivElement>(null)

  const [visible, setVisible] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  const [caption, setCaption] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  // Появление во вьюпорте → пора грузить. rootMargin 200px — начинаем чуть
  // заранее, чтобы медиа успело расшифроваться к моменту показа.
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

  // Скачать + расшифровать, когда стали видимы.
  useEffect(() => {
    if (!visible) return
    let active = true
    let objectUrl: string | null = null

    async function load() {
      try {
        const [mediaUrl, cap] = await Promise.all([
          loadMediaUrl(entry),
          decryptCaption(entry),
        ])
        objectUrl = mediaUrl
        if (active) {
          setUrl(mediaUrl)
          setCaption(cap)
        } else {
          // Размонтировались, пока шла расшифровка — освобождаем сразу.
          URL.revokeObjectURL(mediaUrl)
        }
      } catch {
        if (active) setFailed(true)
      }
    }
    load()

    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [visible, entry])

  const date = dayLabel.format(new Date(entry.occurredAt))
  const isVoice = entry.entryType === 'voice'

  return (
    <figure ref={containerRef} className="space-y-2">
      {isVoice ? (
        // Голос: контейнер не нужно прятать за фиксированным аспектом — плеер
        // компактный. Скелетон до готовности URL.
        <div className="rounded-2xl bg-card p-4 ring-1 ring-border">
          {failed ? (
            <p className="text-sm text-foreground/50">{t('thumbError')}</p>
          ) : url ? (
            <audio src={url} controls playsInline className="w-full" />
          ) : (
            <div className="h-12 w-full animate-pulse rounded-lg bg-foreground/5" />
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl bg-card ring-1 ring-border">
          {failed ? (
            <div className="flex aspect-[4/3] items-center justify-center px-4 text-center text-sm text-foreground/50">
              {t('thumbError')}
            </div>
          ) : url ? (
            // object URL из расшифрованного блоба — next/image не применим (не http-источник).
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt={caption ?? date}
              className="block max-h-[70vh] w-full object-cover"
            />
          ) : (
            <div className="aspect-[4/3] w-full animate-pulse" />
          )}
        </div>
      )}

      <figcaption className="px-1">
        <div className="flex items-center justify-between gap-2">
          <time className="text-sm text-foreground/60" dateTime={entry.occurredAt}>
            {date}
          </time>
          <EntryDeleteButton entry={entry} onDeleted={onDeleted} />
        </div>
        {caption && <p className="mt-0.5 text-foreground/90">{caption}</p>}
      </figcaption>
    </figure>
  )
}
