'use client'

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MicIcon,
  PauseIcon,
  PlayIcon,
  XIcon,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  decryptCaption,
  decryptNote,
  loadMediaUrl,
  type MoodLevel,
  type PathEntry,
} from '@/lib/path/entries'
import { moodRgba } from '@/lib/path/mood'
import { barsFromSeed } from '@/lib/path/waveform'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { EntryDeleteButton } from './entry-delete-button'
import { MoodBadge } from './mood-badge'

// Полный просмотр записи «Пути»: тап по карточке в ленте открывает запись на
// весь экран, свайп влево/вправо листает, крестик/Escape/тап по фону закрывают.
// Здесь же (и только здесь) живёт «Убрать» — в ленте кнопок нет.
//
// Это НЕ «фото во весь экран»: запись показывается той же карточкой Кая, только
// крупной — белая карточка, под ней подпись целиком, дата и настроение. Экран
// остаётся в светлой системе (кремовый фон + пастельные свечения, как на /path),
// а если у записи есть настроение — за карточкой мягкое свечение его цвета.
//
// Тело просмотра примонтировано по key={entry.id}: смена записи = ремоунт, и
// состояние загрузки сбрасывается само, без ручных setState в эффекте.

const fullDate = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

export function EntryViewer({
  entries,
  index,
  onIndexChange,
  onClose,
  onDelete,
}: {
  entries: PathEntry[]
  index: number
  onIndexChange: (index: number) => void
  onClose: () => void
  onDelete: (entry: PathEntry) => void
}) {
  const t = useTranslations('path')
  const entry = entries[index]
  const total = entries.length

  // Направление последнего перехода — карточка въезжает с той стороны, откуда
  // «пришла» (вперёд по ленте — справа, назад — слева).
  const [dir, setDir] = useState<1 | -1>(1)

  const go = useCallback(
    (delta: 1 | -1) => {
      const next = index + delta
      if (next < 0 || next >= total) return
      setDir(delta)
      onIndexChange(next)
    },
    [index, total, onIndexChange],
  )

  // Стрелки клавиатуры листают (Escape закрывает — это уже умеет Dialog).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft') go(-1)
      if (e.key === 'ArrowRight') go(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go])

  // Свайп: точка касания на pointerdown, решение на pointerup. Порог 60px по X,
  // при этом |dy| < 80px — иначе это вертикальный скролл длинной заметки,
  // а не листание.
  const start = useRef<{ x: number; y: number } | null>(null)

  function onPointerDown(e: React.PointerEvent) {
    start.current = { x: e.clientX, y: e.clientY }
  }

  function onPointerUp(e: React.PointerEvent) {
    const from = start.current
    start.current = null
    if (!from) return
    const dx = e.clientX - from.x
    const dy = e.clientY - from.y
    if (Math.abs(dx) < 60 || Math.abs(dy) > 80) return
    go(dx < 0 ? 1 : -1) // свайп влево → следующая (лента идёт сверху вниз)
  }

  if (!entry) return null

  const mood = entry.mood != null ? (entry.mood as MoodLevel) : null

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="inset-0 top-0 left-0 flex h-dvh w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none bg-background p-0 ring-0 sm:max-w-none"
      >
        <DialogTitle className="sr-only">{t('viewer.title')}</DialogTitle>

        {/* Те же пастельные свечения, что на /path — просмотр не «выпадает»
            из экрана, а как будто разворачивается на нём. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 right-[-90px] h-72 w-96 rounded-full bg-chip-blue/40"
          style={{ filter: 'blur(90px)' }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-[-60px] left-[-90px] h-80 w-96 rounded-full bg-accent/50"
          style={{ filter: 'blur(90px)' }}
        />

        <header className="relative z-10 flex shrink-0 items-center gap-2 px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-2">
          <button
            type="button"
            onClick={onClose}
            aria-label={t('viewer.close')}
            className="shadow-card flex size-11 shrink-0 items-center justify-center rounded-full bg-card text-foreground transition-colors hover:bg-secondary"
          >
            <XIcon className="size-[22px]" strokeWidth={1.8} />
          </button>

          <span className="mx-auto text-[13px] text-foreground/40">
            {t('viewer.counter', { current: index + 1, total })}
          </span>

          <EntryDeleteButton
            entry={entry}
            onDelete={(e) => {
              // Закрываем просмотр и отдаём запись ленте: там отложенное
              // удаление с «Отменить» (PathFeed.scheduleDelete).
              onClose()
              onDelete(e)
            }}
          />
        </header>

        <div
          // flex-col + my-auto на карточке: короткая запись стоит по центру,
          // длинная (много текста) прокручивается, а не обрезается сверху —
          // с items-center у overflow-контейнера верх ушёл бы за край.
          // items-center — карточка по центру ПО ГОРИЗОНТАЛИ: в flex-col без
          // него max-w-md прижимал её к левому краю.
          className="relative z-10 flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]"
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onClick={(e) => {
            // Тап по фону (не по карточке) закрывает — как в галерее.
            if (e.target === e.currentTarget) onClose()
          }}
        >
          {/* Свечение цвета настроения за карточкой. */}
          {mood != null && (
            <div
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-1/2 size-[420px] max-w-full -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{
                background: moodRgba(mood, 0.5),
                filter: 'blur(110px)',
              }}
            />
          )}

          <ViewerBody key={entry.id} entry={entry} dir={dir} />

          {/* Стрелки для мыши/клавиатуры; на телефоне работает свайп. */}
          <NavArrow
            side="left"
            label={t('viewer.prev')}
            hidden={index === 0}
            onClick={() => go(-1)}
          />
          <NavArrow
            side="right"
            label={t('viewer.next')}
            hidden={index === total - 1}
            onClick={() => go(1)}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Тело просмотра: расшифровка и раскладка по типу записи ───────────────────

function ViewerBody({ entry, dir }: { entry: PathEntry; dir: 1 | -1 }) {
  const t = useTranslations('path')

  const [url, setUrl] = useState<string | null>(null)
  const [caption, setCaption] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  // Отдельный флаг «расшифровка закончилась»: без него запись дневника с
  // настроением и текстом на миг показывала бы крупный бейдж (текста ещё нет)
  // и только потом текст — заметный подскок.
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let active = true
    let objectUrl: string | null = null

    // Как и в ленте: функция внутри эффекта, все setState — после await
    // (правило react-hooks/set-state-in-effect).
    async function load() {
      try {
        const [media, cap, text] = await Promise.all([
          entry.mediaPath ? loadMediaUrl(entry) : Promise.resolve(null),
          decryptCaption(entry),
          decryptNote(entry),
        ])
        objectUrl = media
        if (!active) {
          if (media) URL.revokeObjectURL(media)
          return
        }
        setUrl(media)
        setCaption(cap)
        setNote(text)
        setLoaded(true)
      } catch (e) {
        console.error('path viewer load failed:', e instanceof Error ? e.message : e)
        if (active) setFailed(true)
      }
    }

    load()
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [entry])

  const isVoice = entry.entryType === 'voice'
  const isPhoto = entry.mediaPath !== null && !isVoice
  const isDiary = !isPhoto && !isVoice
  const mood = entry.mood != null ? (entry.mood as MoodLevel) : null

  return (
    <figure
      className={cn(
        'shadow-card relative z-10 my-auto w-full max-w-md shrink-0 rounded-[30px] bg-card p-3',
        'duration-300 animate-in fade-in zoom-in-95 motion-reduce:animate-none',
        dir === 1 ? 'slide-in-from-right-6' : 'slide-in-from-left-6',
      )}
    >
      {failed ? (
        <p className="px-3 py-10 text-center text-sm text-foreground/50">
          {t('thumbError')}
        </p>
      ) : isPhoto ? (
        url ? (
          // object URL из расшифрованного блоба — next/image не применим.
          // max-h в dvh: фото вписывается в экран целиком, страница не скроллится.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={caption ?? ''}
            draggable={false}
            className="block max-h-[56dvh] w-full rounded-[22px] object-contain"
          />
        ) : (
          <div className="aspect-[4/5] max-h-[56dvh] w-full animate-pulse rounded-[22px] bg-muted/70" />
        )
      ) : isVoice ? (
        <VoicePlayer url={url} seed={entry.id} />
      ) : !loaded ? (
        <div className="space-y-2 px-3 py-6">
          <div className="h-3.5 w-full animate-pulse rounded bg-foreground/5" />
          <div className="h-3.5 w-4/5 animate-pulse rounded bg-foreground/5" />
          <div className="h-3.5 w-2/3 animate-pulse rounded bg-foreground/5" />
        </div>
      ) : note !== null ? (
        // Дневник: текст — и есть содержимое. Длинный скроллится внутри
        // карточки, а не растягивает её за экран.
        <p className="max-h-[56dvh] overflow-y-auto px-3 pt-3 text-[15px] leading-[1.6] whitespace-pre-wrap text-foreground">
          {note}
        </p>
      ) : mood != null ? (
        // Запись «только настроение» (быстрый тап с дашборда): показываем сам
        // бейдж крупно — иначе карточка была бы пустой.
        <div className="flex flex-col items-center gap-3 py-8">
          <MoodBadge level={mood} size={104} />
          <span className="text-[15px] text-foreground/70">{t(`mood.level.${mood}`)}</span>
        </div>
      ) : null}

      {/* Подпись фото/голоса — целиком, без обрезки (в ленте она в одну строку). */}
      {!failed && caption && (
        <figcaption className="px-3 pt-3 text-[14px] leading-[1.5] whitespace-pre-wrap text-foreground">
          {caption}
        </figcaption>
      )}

      {/* Нижняя строка: полная дата слева, настроение справа. У дневника с
          текстом бейдж тоже здесь — сверху он бы спорил с текстом. */}
      <div className="flex items-center justify-between gap-3 px-3 pt-3 pb-1">
        <time className="text-[13px] font-semibold text-foreground" dateTime={entry.occurredAt}>
          {fullDate.format(new Date(entry.occurredAt))}
        </time>
        {mood != null && !(isDiary && loaded && note === null) && (
          <span className="flex items-center gap-2 text-[13px] text-foreground/60">
            {t(`mood.level.${mood}`)}
            <MoodBadge level={mood} size={26} />
          </span>
        )}
      </div>
    </figure>
  )
}

// Крупный голосовой плеер: тот же градиент и та же волна, что в карточке ленты,
// но во всю ширину карточки просмотра.
function VoicePlayer({ url, seed }: { url: string | null; seed: string }) {
  const t = useTranslations('path')
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const bars = barsFromSeed(seed, 48, 8, 34)

  function toggle() {
    const el = audioRef.current
    if (!el) return
    if (playing) el.pause()
    else void el.play()
  }

  return (
    <div
      className="flex h-[104px] w-full items-center gap-4 rounded-[22px] px-5"
      style={{ backgroundImage: 'var(--kai-grad-audio)' }}
    >
      <button
        type="button"
        onClick={toggle}
        disabled={!url}
        aria-label={playing ? t('viewer.pause') : t('viewer.play')}
        className="shrink-0 text-foreground disabled:opacity-40"
      >
        {playing ? (
          <PauseIcon className="size-7 fill-current" />
        ) : (
          <PlayIcon className="size-7 fill-current" />
        )}
      </button>

      {/* Волна: во flex-1 с overflow-hidden — за края карточки не вылезает. */}
      <div className="flex min-w-0 flex-1 items-center gap-[3px] overflow-hidden">
        {bars.map((h, i) => (
          <span
            key={i}
            className={cn(
              'w-[3px] shrink-0 rounded-full bg-foreground/80 transition-all duration-300',
              playing && 'animate-pulse',
            )}
            style={{ height: h + 'px', animationDelay: i * 40 + 'ms' }}
          />
        ))}
      </div>

      <MicIcon className="size-6 shrink-0 text-foreground" />

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
  )
}

function NavArrow({
  side,
  label,
  hidden,
  onClick,
}: {
  side: 'left' | 'right'
  label: string
  hidden: boolean
  onClick: () => void
}) {
  if (hidden) return null
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        'shadow-card absolute top-1/2 z-20 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full bg-card/80 text-foreground backdrop-blur-sm transition-colors hover:bg-card sm:flex',
        side === 'left' ? 'left-3' : 'right-3',
      )}
    >
      {side === 'left' ? (
        <ChevronLeftIcon className="size-[22px]" strokeWidth={1.8} />
      ) : (
        <ChevronRightIcon className="size-[22px]" strokeWidth={1.8} />
      )}
    </button>
  )
}
