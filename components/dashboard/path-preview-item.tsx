'use client'

import { MicIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

import { decryptCaption, loadMediaUrl, type PathEntry } from '@/lib/path/entries'

// Один компактный элемент превью «Пути»: миниатюра (фото) или иконка (голос) +
// дата + подпись. Расшифровка на устройстве, как в ленте; object URL отзываем
// при размонтировании. Интерактивного плеера тут нет (вся карточка — ссылка в
// «Путь»), для голоса показываем иконку.
const dayFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' })

export function PathPreviewItem({ entry }: { entry: PathEntry }) {
  const [url, setUrl] = useState<string | null>(null)
  const [caption, setCaption] = useState<string | null>(null)
  const isVoice = entry.entryType === 'voice'

  useEffect(() => {
    let active = true
    let objectUrl: string | null = null

    async function load() {
      try {
        const cap = await decryptCaption(entry)
        if (active) setCaption(cap)
        // Миниатюру тянем только для фото; для голоса хватит иконки.
        if (!isVoice) {
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
  }, [entry, isVoice])

  const date = dayFmt.format(new Date(entry.occurredAt))

  return (
    <div className="flex items-center gap-3">
      <div className="size-14 shrink-0 overflow-hidden rounded-xl bg-muted/50">
        {isVoice ? (
          <div className="flex size-full items-center justify-center text-moss">
            <MicIcon className="size-5" />
          </div>
        ) : url ? (
          // object URL расшифрованного блоба — next/image не применим.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="size-full object-cover" />
        ) : (
          <div className="size-full animate-pulse" />
        )}
      </div>
      <div className="min-w-0">
        <p className="text-sm text-foreground/60">{date}</p>
        {caption && <p className="truncate text-foreground/90">{caption}</p>}
      </div>
    </div>
  )
}
