'use client'

import { ChevronDownIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import { loadBlankPhotoUrl } from '@/lib/labs/photo'
import { PinRequiredError } from '@/lib/path/entries'
import { cn } from '@/lib/utils'

/**
 * Раскрывающееся E2E-фото бланка в истории анализов.
 *
 * Близнец LabNote: бейдж — кнопка, тап скачивает шифроблоб, расшифровывает и
 * показывает картинку, повторный тап сворачивает. Расшифровка ПО ТАПУ, а не
 * заранее: ничего не расшифровано, пока не попросили, и список не тянет блобы
 * при каждом открытии истории.
 *
 * До этого бейдж был обычным <span>: путь и IV наружу не отдавались вовсе, и
 * открыть фото из истории было физически нечем — тот же баг, что был у
 * заметки. Данные довёз подшаг 4.
 *
 * PIN здесь МЯГКИЙ, в отличие от заметки: нет ключа — показываем строчку со
 * ссылкой, но никуда не уводим. Решение из захода C по фото на экране правки:
 * у заметки жёсткий редирект нужен, потому что пустое поле при сохранении
 * стёрло бы текст; здесь ничего не сохраняется, и выкидывать человека из
 * истории ради картинки — перебор.
 *
 * Содержимое и блобы не логируются.
 */
export function LabPhoto({
  path,
  iv,
}: {
  path: string | null
  iv: string | null
}) {
  const t = useTranslations('labs')

  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [needsPin, setNeedsPin] = useState(false)

  // Гонка: расшифровка может закончиться уже после ухода с экрана. Тогда
  // object URL создан, но в стейт не попадёт — отпускаем его вручную.
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // Расшифрованный блоб не должен пережить компонент: это и утечка памяти, и
  // лишнее время жизни открытых данных в памяти вкладки. Чистка срабатывает
  // и при смене url, и при размонтировании.
  useEffect(() => {
    if (!url) return
    return () => URL.revokeObjectURL(url)
  }, [url])

  // Фото нет — рендерить нечего. Путь и IV ходят парой (констрейнт
  // blank_photo_path_iv_together), но проверяем оба: компонент не должен
  // полагаться на вызывающую сторону.
  if (!path || !iv) return null

  const onToggle = async () => {
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)

    // Уже расшифровано (или расшифровывается) — второй раз не гоняем.
    if (url !== null || loading) return

    setLoading(true)
    setFailed(false)
    setNeedsPin(false)
    try {
      const created = await loadBlankPhotoUrl(path, iv)
      if (!mounted.current) {
        URL.revokeObjectURL(created)
        return
      }
      setUrl(created)
    } catch (err) {
      if (!mounted.current) return
      if (err instanceof PinRequiredError) setNeedsPin(true)
      else setFailed(true)
    } finally {
      if (mounted.current) setLoading(false)
    }
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="-m-1 flex items-center gap-1 p-1 text-xs text-foreground/50 transition-colors hover:text-foreground/80"
      >
        {t('photoBadge')}
        <ChevronDownIcon
          className={cn('size-3 transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="mt-1.5">
          {needsPin ? (
            <p className="text-xs text-foreground/50">
              {t('photoPinNeeded')}{' '}
              <Link href="/pin" className="underline">
                {t('photoPinNeededLink')}
              </Link>
            </p>
          ) : failed ? (
            <p className="text-xs text-foreground/50">{t('photoError')}</p>
          ) : url ? (
            <div className="overflow-hidden rounded-xl bg-card ring-1 ring-border">
              {/* object URL расшифрованного блоба — next/image не применим. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt=""
                className="block max-h-[50vh] w-full object-contain"
              />
            </div>
          ) : (
            <div className="h-32 animate-pulse rounded-xl bg-foreground/5" aria-hidden />
          )}
        </div>
      )}
    </div>
  )
}
