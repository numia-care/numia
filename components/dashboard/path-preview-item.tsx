'use client'

import { MicIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  decryptCaption,
  decryptNote,
  loadMediaUrl,
  type MoodLevel,
  type PathEntry,
} from '@/lib/path/entries'
import { MOOD_COLOR } from '@/lib/path/mood'

// Один компактный элемент превью «Пути»: миниатюра (фото), иконка (голос) или
// ✦ (дневник; в цвете настроения, если оно задано) + дата + текст. Расшифровка
// на устройстве, как в ленте; object URL отзываем при размонтировании.
// Интерактива тут нет (вся карточка — ссылка в «Путь»).
const dayFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' })

export function PathPreviewItem({ entry }: { entry: PathEntry }) {
  const t = useTranslations('path')
  const [url, setUrl] = useState<string | null>(null)
  const [text, setText] = useState<string | null>(null)
  const isVoice = entry.entryType === 'voice'
  const isDiary = entry.entryType === 'diary'

  useEffect(() => {
    let active = true
    let objectUrl: string | null = null

    async function load() {
      try {
        // Текстовая часть: у дневника — сам текст (note_ciphertext), у
        // медиа-записей — подпись (encrypted_content). Расшифровка своя у каждого.
        const textPart = isDiary
          ? await decryptNote(entry)
          : await decryptCaption(entry)
        if (active) setText(textPart)
        // Миниатюру тянем только для фото; голосу и дневнику хватает иконки.
        if (!isVoice && !isDiary) {
          const u = await loadMediaUrl(entry)
          objectUrl = u
          if (active) setUrl(u)
          else URL.revokeObjectURL(u)
        }
      } catch {
        // Превью не критично — молча пропускаем.
      }
    }
    load()

    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [entry, isVoice, isDiary])

  const date = dayFmt.format(new Date(entry.occurredAt))

  return (
    <div className="flex items-center gap-3">
      <div className="size-14 shrink-0 overflow-hidden rounded-xl bg-muted/50">
        {isDiary ? (
          // ✦ в цвете ступени настроения — тот же язык, что шкала и карточка
          // в ленте. Настроение не задано → нейтральный мох.
          <div
            className="flex size-full items-center justify-center text-xl"
            style={{
              color:
                entry.mood != null ? MOOD_COLOR[entry.mood as MoodLevel] : undefined,
            }}
            aria-hidden
          >
            <span className={entry.mood == null ? 'text-moss' : undefined}>✦</span>
          </div>
        ) : isVoice ? (
          <div className="flex size-full items-center justify-center text-moss">
            <MicIcon className="size-5" />
          </div>
        ) : url ? (
          // ПРИВАТНОСТЬ: компонент живёт на дашборде (ретро-карточка) — фото
          // блюрим от взгляда через плечо, полный вид только внутри «Пути».
          // Блюр слоем backdrop-blur, не filter на <img>: iOS-баг (белый рендер).
          <div className="relative size-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="" className="size-full object-cover" />
            <div className="absolute inset-0 backdrop-blur-[10px]" aria-hidden />
          </div>
        ) : (
          <div className="size-full animate-pulse" />
        )}
      </div>
      <div className="min-w-0">
        <p className="text-sm text-foreground/60">{date}</p>
        {/* У дневника без текста (только настроение) — подпись «Дневник»,
            чтобы строка не была голой датой. */}
        {text ? (
          <p className="truncate text-foreground/90">{text}</p>
        ) : isDiary ? (
          <p className="text-sm text-foreground/70">{t('diaryTag')}</p>
        ) : null}
      </div>
    </div>
  )
}
