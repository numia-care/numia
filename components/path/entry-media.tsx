'use client'

import { MicIcon, PauseIcon, PlayIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'

import { decryptCaption, loadMediaUrl, type MoodLevel, type PathEntry } from '@/lib/path/entries'
import { cn } from '@/lib/utils'
import { EntryDeleteButton } from './entry-delete-button'
import { MoodBadge } from './mood-badge'

// Запись ленты (фото или голос) — вёрстка по PNG-эталонам «путь1–3»:
//
//   Фото  — «полароид»: белая карточка r:25 с полем ~10px вокруг снимка (r:15),
//           дата (ДД.ММ.ГГ, semibold) внизу слева ВНУТРИ рамки. Подпись — в
//           отдельной белой пилюле, наезжающей на карточку (только в виде
//           «дорожка»); муд-бейдж прицеплен к её углу.
//   Голос — градиентная пилюля (белый→лайм→розовый→сиреневый, токен
//           --kai-grad-audio) с play/пауза, декоративной волной и микрофоном;
//           обёрнута в белую карточку с датой (плеер РАБОЧИЙ: скрытый <audio>).
//
// Ленивая расшифровка сохранена: медиа скачивается/расшифровывается, когда
// запись подъезжает к вьюпорту. object URL отзываем при размонтировании.

const dateLabel = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
})

export function EntryMedia({
  entry,
  onDelete,
  compact,
}: {
  entry: PathEntry
  onDelete: (entry: PathEntry) => void
  /** true в виде «мозаика»: без наезжающей пилюли подписи (по эталону путь3). */
  compact?: boolean
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

  return (
    <figure
      ref={containerRef}
      className={cn(
        'transition-all duration-500 motion-reduce:transition-none',
        visible ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0',
      )}
    >
      {isVoice ? (
        <VoiceCard
          url={url}
          failed={failed}
          date={date}
          entryIso={entry.occurredAt}
          seed={entry.id}
          errorText={t('thumbError')}
          deleteButton={<EntryDeleteButton entry={entry} onDelete={onDelete} />}
        />
      ) : (
        // «Полароид»: белая рамка, снимок, дата внутри.
        <div className="shadow-card rounded-[25px] bg-card p-[10px] pb-2">
          <div className="overflow-hidden rounded-[15px]">
            {failed ? (
              <div className="flex aspect-square items-center justify-center bg-muted/50 px-4 text-center text-xs text-foreground/50">
                {t('thumbError')}
              </div>
            ) : url ? (
              // object URL из расшифрованного блоба — next/image не применим.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={url}
                alt={caption ?? date}
                className="block aspect-[10/11] w-full object-cover"
              />
            ) : (
              <div className="aspect-[10/11] w-full animate-pulse bg-muted/70" />
            )}
          </div>
          <div className="flex items-center justify-between px-1 pt-2">
            <time
              className="text-[11px] font-semibold text-foreground"
              dateTime={entry.occurredAt}
            >
              {date}
            </time>
            <EntryDeleteButton entry={entry} onDelete={onDelete} />
          </div>
        </div>
      )}

      {/* Подпись — белая пилюля, наезжающая на карточку (вид «дорожка»).
          Муд-бейдж (если у записи есть настроение) — на её правом плече. */}
      {!compact && caption && (
        <figcaption className="relative z-10 -mt-3 ml-auto w-fit max-w-[85%]">
          <div className="shadow-chip relative rounded-[14px] bg-card px-3 py-2 text-[11px] leading-snug text-foreground">
            {caption}
            {entry.mood != null && (
              <MoodBadge
                level={entry.mood as MoodLevel}
                size={26}
                className="absolute -right-2.5 -top-3"
              />
            )}
          </div>
        </figcaption>
      )}
    </figure>
  )
}

// ── Голосовая карточка: градиентный плеер по эталону ─────────────────────────

function VoiceCard({
  url,
  failed,
  date,
  entryIso,
  seed,
  errorText,
  deleteButton,
}: {
  url: string | null
  failed: boolean
  date: string
  entryIso: string
  seed: string
  errorText: string
  deleteButton: React.ReactNode
}) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)

  // Декоративная волна: детерминированные высоты штрихов из id записи.
  const bars = barsFromSeed(seed, 22)

  function toggle() {
    const el = audioRef.current
    if (!el) return
    if (playing) {
      el.pause()
    } else {
      void el.play()
    }
  }

  return (
    <div className="shadow-card rounded-[25px] bg-card p-[10px] pb-2">
      {failed ? (
        <p className="px-2 py-3 text-xs text-foreground/50">{errorText}</p>
      ) : (
        <div
          className="flex h-[54px] items-center gap-2 rounded-full px-4"
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
              <PauseIcon className="size-5 fill-current" />
            ) : (
              <PlayIcon className="size-5 fill-current" />
            )}
          </button>

          {/* Волна — декоративная (высоты из id), как в эталоне. */}
          <div className="flex min-w-0 flex-1 items-center justify-center gap-[2.5px]">
            {bars.map((h, i) => (
              <span
                key={i}
                className="w-[2.5px] shrink-0 rounded-full bg-foreground"
                style={{ height: `${h}px` }}
              />
            ))}
          </div>

          <MicIcon className="size-5 shrink-0 text-foreground" />

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
      )}

      <div className="flex items-center justify-between px-2 pt-2">
        <time className="text-[11px] font-semibold text-foreground" dateTime={entryIso}>
          {date}
        </time>
        {deleteButton}
      </div>
    </div>
  )
}

// Псевдослучайные высоты штрихов волны из строки-сида (стабильны между рендерами).
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
    const v = Math.abs(h % 100) / 100
    out.push(5 + Math.round(v * 15)) // 5–20px
  }
  return out
}
