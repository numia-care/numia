'use client'

import { MicIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'

import { getCryptoKey } from '@/lib/crypto/session'
import {
  decryptNote,
  listEntries,
  loadMediaUrl,
  type MoodLevel,
  type PathEntry,
} from '@/lib/path/entries'
import { MOOD_COLOR } from '@/lib/path/mood'

// Превью «Пути» на дашборде — по фрейму Кая: стекло-карточка, заголовок
// 14px/500, сетка из трёх квадратных тайлов (r:15, #F3F3F3): фото-миниатюра /
// иконка голоса / ✦ дневника в цвете настроения. Расшифровка на устройстве,
// как в ленте. Вся карточка — ссылка в «Путь».
type State = { kind: 'loading' } | { kind: 'ready'; entries: PathEntry[] }

export function PathPreview() {
  const t = useTranslations('dashboard')
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false

    async function run() {
      try {
        const entries = await listEntries()
        if (cancelled) return
        // DEK нужен для расшифровки миниатюр; нет в памяти → заглушка
        // (на дашборде PinGate его гарантирует, это страховка).
        if (!getCryptoKey()) {
          setState({ kind: 'ready', entries: [] })
          return
        }
        setState({ kind: 'ready', entries: entries.slice(0, 3) })
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
    <Link href="/path" className="card-glass block p-5 transition-shadow hover:shadow-md">
      <h2 className="text-sm font-medium text-[#1F1F1F]">{t('pathTitle')}</h2>

      {state.kind === 'loading' ? (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="aspect-square animate-pulse rounded-md bg-muted/60" />
          ))}
        </div>
      ) : state.entries.length === 0 ? (
        <p className="mt-1.5 text-sm text-muted-foreground">{t('pathEmpty')}</p>
      ) : (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {state.entries.map((entry) => (
            <PathTile key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </Link>
  )
}

// Квадратный тайл записи (структура ряда — по фрейму Кая; контент реальный):
// фото — расшифрованная миниатюра; голос — иконка; дневник — ✦ в цвете
// настроения + первые слова расшифрованного текста. Object URL отзываем при
// размонтировании.
function PathTile({ entry }: { entry: PathEntry }) {
  const [url, setUrl] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const isPhoto = entry.entryType === 'photo'
  const isDiary = entry.entryType === 'diary'

  useEffect(() => {
    let active = true
    let objectUrl: string | null = null

    async function load() {
      try {
        if (isPhoto) {
          const u = await loadMediaUrl(entry)
          objectUrl = u
          if (active) setUrl(u)
          else URL.revokeObjectURL(u)
        } else if (isDiary && entry.noteCiphertext) {
          const text = await decryptNote(entry)
          if (active) setNote(text)
        }
      } catch {
        // Контент тайла не критичен — останется иконка/✦ без текста.
      }
    }
    load()

    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [entry, isPhoto, isDiary])

  return (
    <div className="flex aspect-square items-center justify-center overflow-hidden rounded-md bg-[#F3F3F3]">
      {isPhoto ? (
        url ? (
          // ПРИВАТНОСТЬ: дашборд часто открыт (PIN-грейс) и виден через плечо —
          // миниатюру блюрим так, чтобы содержимое не читалось чужим взглядом.
          // Полное фото — только внутри «Пути».
          // Блюр — ОТДЕЛЬНЫМ слоем (backdrop-blur), не filter на <img>:
          // filter на картинке в скруглённом overflow-контейнере iOS Safari
          // рендерит белым (compositing-баг).
          <div className="relative size-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="" className="size-full object-cover" />
            <div className="absolute inset-0 backdrop-blur-[10px]" aria-hidden />
          </div>
        ) : (
          <div className="size-full animate-pulse bg-muted/60" />
        )
      ) : entry.entryType === 'voice' ? (
        <MicIcon className="size-5 text-[#8F8F8F]" />
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-1 p-1.5">
          <span
            aria-hidden
            className="text-lg leading-none"
            style={{
              color:
                entry.mood != null ? MOOD_COLOR[entry.mood as MoodLevel] : '#8F8F8F',
            }}
          >
            ✦
          </span>
          {note && (
            <span className="line-clamp-2 text-center text-[10px] leading-tight text-[#1F1F1F]/80">
              {note}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
