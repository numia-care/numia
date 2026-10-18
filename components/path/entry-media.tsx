'use client'

import { MicIcon, PauseIcon, PlayIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'

import { decryptCaption, loadMediaUrl, type MoodLevel, type PathEntry } from '@/lib/path/entries'
import { barsFromSeed } from '@/lib/path/waveform'
import { cn } from '@/lib/utils'
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
//
// Тап по карточке открывает полный просмотр (EntryViewer). Клик ловит невидимая
// кнопка на всю площадь карточки: обернуть всю карточку в <button> нельзя —
// внутри голосовой уже есть своя кнопка play (кнопка в кнопке невалидна).
// Play лежит выше по z, поэтому тап по нему играет, а не открывает просмотр.

const dateLabel = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
})

export function EntryMedia({
  entry,
  onOpen,
  side = 'left',
}: {
  entry: PathEntry
  onOpen: (entry: PathEntry) => void
  // Колонка, в которой стоит карточка: от неё зависит, в какую сторону
  // сдвинут пузырь подписи и с какого края висит бейдж настроения.
  side?: 'left' | 'right'
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

  // Пузырь подписи и бейдж настроения висят ПОД карточкой и торчат за её
  // границы, поэтому оболочка `relative` без overflow, а сама карточка (figure)
  // остаётся с overflow-hidden — иначе фото вылезало бы из скруглений.
  //
  // Оба элемента ABSOLUTE и не входят в бокс оболочки: доска «Пути» меряет
  // именно её (itemRefs) для якорей дорожки и для высоты доски. Если бы пузырь
  // влиял на высоту, коннекторы поехали бы вслед за длиной подписи.
  return (
    <div ref={containerRef} className="relative">
      <figure
        className={cn(
          'shadow-card relative overflow-hidden rounded-[25px] bg-card transition-all duration-500 motion-reduce:transition-none',
          // Отклик на нажатие: карточка мягко «проседает» под пальцем.
          'has-[.entry-open:active]:scale-[0.98]',
          visible ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0',
        )}
      >
        {/* Невидимая кнопка на всю карточку — открывает полный просмотр. */}
        <button
          type="button"
          onClick={() => onOpen(entry)}
          aria-label={t('viewer.open')}
          className="entry-open absolute inset-0 z-0 cursor-pointer"
        />

      {isVoice ? (
        <VoicePreview url={url} failed={failed} seed={entry.id} errorText={t('thumbError')} />
      ) : (
        <div className="p-[9px] pb-0">
          <div className="overflow-hidden rounded-[16px]">
            {failed ? (
              <div className="flex aspect-square items-center justify-center bg-muted/50 px-3 text-center text-xs text-foreground/50">
                {t('thumbError')}
              </div>
            ) : url ? (
              // object URL из расшифрованного блоба — next/image не применим.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={url}
                alt={caption ?? date}
                className="block aspect-square w-full object-cover"
              />
            ) : (
              <div className="aspect-square w-full animate-pulse bg-muted/70" />
            )}
          </div>
        </div>
      )}

        {/* Нижняя строка карточки — только дата. Подпись и бейдж настроения
            переехали в пузырь под карточкой (замер эталона путь1/2). */}
        <div className="px-3.5 py-2.5">
          <time className="text-[11px] font-semibold text-foreground" dateTime={entry.occurredAt}>
            {date}
          </time>
        </div>
      </figure>

      {/* Пузырь подписи + бейдж — ЗАМЕР эталона:
            ширина ~106 при карточке 145 → 73%;
            начинается на 15 ниже карточки;
            сдвинут в сторону жёлоба (для левой колонки — вправо, для правой —
            влево), внутренний край с отступом 7 от края карточки;
            бейдж 19×19 сидит на верхней грани пузыря у его внешнего конца,
            наполовину снаружи.
          Пузырь показываем, только если есть что показать: подпись или
          настроение. Пустой белый прямоугольник под карточкой был бы мусором. */}
      {(caption || mood != null) && (
        <div
          className={cn(
            'absolute top-full z-10 mt-[15px] w-[73%]',
            side === 'left' ? 'right-[7px]' : 'left-[7px]',
          )}
        >
          <div className="shadow-card relative rounded-[14px] bg-card px-3 py-2">
            {caption && (
              <p className="line-clamp-2 text-[11px] leading-snug text-foreground">
                {caption}
              </p>
            )}
            {mood != null && (
              <span
                className={cn(
                  'absolute -top-[9px]',
                  side === 'left' ? '-right-[6px]' : '-left-[6px]',
                )}
              >
                <MoodBadge level={mood} size={19} />
              </span>
            )}
          </div>
        </div>
      )}
    </div>
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
        style={{ backgroundImage: 'var(--brand-grad-audio)' }}
      >
        <button
          type="button"
          onClick={toggle}
          disabled={!url}
          aria-label={playing ? 'Пауза' : 'Слушать'}
          // z-10 — выше невидимой кнопки «открыть»: тап по play играет запись.
          className="relative z-10 shrink-0 text-foreground disabled:opacity-40"
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
