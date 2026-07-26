'use client'

import { MicIcon, PauseIcon, PlayIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'

import { decryptCaption, loadMediaUrl, type MoodLevel, type PathEntry } from '@/lib/path/entries'
import { cn } from '@/lib/utils'
import { EntryDeleteButton } from './entry-delete-button'
import { MoodBadge } from './mood-badge'

// Превью-карточка записи (фото / голос) для ленты «Пути». КОМПАКТНАЯ, весь
// контент — в границах карточки (эталоны путь1–3):
//
//   Фото  — миниатюра фикс-пропорций (4:5, object-cover, заливка карточки) в
//           белой рамке r:25; под снимком строка: дата + муд-бейдж. Подпись —
//           одна строка с многоточием (полностью — в просмотре по тапу, шаг 2).
//   Голос — компактный градиентный плеер во всю ширину карточки: play/пауза,
//           волна во flex-1 c overflow-hidden (НЕ вылезает), микрофон; ниже дата.
//
// Ленивая расшифровка сохранена. object URL отзываем при размонтировании.

const dateLabel = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
})

export function EntryMedia({
  entry,
  onDelete,
}: {
  entry: PathEntry
  onDelete: (entry: PathEntry) => void
}) {
  const t = useTranslations('path')
  const containerRef = useRef<HTMLDivElement>(null)

  const [visible, setVisible] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  const [caption, setCaption] = useState<string | null>(null)
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
          URL.revokeObjectURL(mediaUrl)
        }
      } catch (e) {
        console.error('path media load failed:', e instanceof Error ? e.message : e)
        if (active) setFailed(true)
      }
    }
    load()
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [visible, entry])

  const date = dateLabel.format(new Date(entry.occurredAt))
  const isVoice = entry.entryType === 'voice'
  const mood = entry.mood != null ? (entry.mood as MoodLevel) : null

  return (
    <figure
      ref={containerRef}
      className={cn(
        'shadow-card overflow-hidden rounded-[25px] bg-card transition-all duration-500 motion-reduce:transition-none',
        visible ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0',
      )}
    >
      {isVoice ? (
        <VoicePreview url={url} failed={failed} seed={entry.id} errorText={t('thumbError')} />
      ) : (
        <div className="p-[9px] pb-0">
          <div className="overflow-hidden rounded-[16px]">
            {failed ? (
              <div className="flex aspect-[4/5] items-center justify-center bg-muted/50 px-3 text-center text-xs text-foreground/50">
                {t('thumbError')}
              </div>
            ) : url ? (
              // object URL из расшифрованного блоба — next/image не применим.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={url}
                alt={caption ?? date}
                className="block aspect-[4/5] w-full object-cover"
              />
            ) : (
              <div className="aspect-[4/5] w-full animate-pulse bg-muted/70" />
            )}
          </div>
        </div>
      )}

      {/* Подпись фото — одна строка с многоточием (полностью — в просмотре). */}
      {!isVoice && caption && (
        <p className="truncate px-3.5 pt-2 text-[11px] leading-snug text-foreground/80">
          {caption}
        </p>
      )}

      {/* Нижняя строка: дата слева, действия+бейдж справа — В ГРАНИЦАХ карточки. */}
      <div className="flex items-center justify-between gap-2 px-3.5 py-2.5">
        <time className="text-[11px] font-semibold text-foreground" dateTime={entry.occurredAt}>
          {date}
        </time>
        <div className="flex items-center gap-1.5">
          <EntryDeleteButton entry={entry} onDelete={onDelete} />
          {mood != null && <MoodBadge level={mood} size={22} />}
        </div>
      </div>
    </figure>
  )
}

// Компактный голосовой плеер во всю ширину карточки. Волна — во flex-1 с
// overflow-hidden, поэтому НИКОГДА не вылезает за границы.
function VoicePreview({
  url,
  failed,
  seed,
  errorText,
}: {
  url: string | null
  failed: boolean
  seed: string
  errorText: string
}) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const bars = barsFromSeed(seed, 40)

  function toggle() {
    const el = audioRef.current
    if (!el) return
    if (playing) el.pause()
    else void el.play()
  }

  if (failed) {
    return <p className="px-4 pt-4 text-xs text-foreground/50">{errorText}</p>
  }

  return (
    <div className="p-[9px] pb-0">
      <div
        className="flex h-[52px] items-center gap-2.5 rounded-[16px] px-3.5"
        style={{ backgroundImage: 'var(--kai-grad-audio)' }}
      >
        <button
          type="button"
          onClick={toggle}
          disabled={!url}
          aria-label={playing ? 'Пауза' : 'Слушать'}
          className="shrink-0 text-foreground disabled:opacity-40"
        >
          {playing ? (
            <PauseIcon className="size-[18px] fill-current" />
          ) : (
            <PlayIcon className="size-[18px] fill-current" />
          )}
        </button>

        {/* Волна — во flex-1 overflow-hidden: клипается, за края не выходит. */}
        <div className="flex min-w-0 flex-1 items-center gap-[2px] overflow-hidden">
          {bars.map((h, i) => (
            <span
              key={i}
              className="w-[2px] shrink-0 rounded-full bg-foreground/80"
              style={{ height: h + 'px' }}
            />
          ))}
        </div>

        <MicIcon className="size-[18px] shrink-0 text-foreground" />

        {url && (
          <audio
            ref={audioRef}
            src={url}
            playsInline
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            className="hidden"
          />
        )}
      </div>
    </div>
  )
}

// Псевдослучайные высоты штрихов из id (стабильны между рендерами).
function barsFromSeed(seed: string, count: number): number[] {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const out: number[] = []
  for (let i = 0; i < count; i++) {
    h ^= h << 13
    h ^= h >>> 17
    h ^= h << 5
    out.push(5 + Math.round((Math.abs(h % 100) / 100) * 13)) // 5–18px
  }
  return out
}
