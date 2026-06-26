'use client'

import { format, parse } from 'date-fns'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { DatePicker } from '@/components/tracker/date-picker'
import { buttonVariants } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { addPhotoEntry, PinRequiredError } from '@/lib/path/entries'
import { cn } from '@/lib/utils'

// Форма добавления фото: выбрать/снять → превью → дата + подпись → сохранить.
// Сохранение запускает весь E2E-пайплайн (lib/path/entries: сжать → шифровать →
// загрузить шифроблоб → записать метаданные), после чего уходим в ленту.
export function PhotoForm() {
  const t = useTranslations('path.new')
  const router = useRouter()

  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  // occurred_at по умолчанию — сегодня; можно поставить прошлую дату (фото
  // могло быть снято раньше, чем добавлено).
  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [caption, setCaption] = useState('')
  const [saving, setSaving] = useState(false)

  // Превью ВЫБРАННОГО (ещё не зашифрованного) файла — локальный object URL для
  // показа в форме. Создаём в обработчике выбора (не в эффекте), а эффект ниже
  // только отзывает URL при смене/размонтировании.
  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null
    setFile(picked)
    setPreviewUrl(picked ? URL.createObjectURL(picked) : null)
  }

  // Отзываем предыдущий object URL, когда он сменился или компонент ушёл.
  useEffect(() => {
    if (!previewUrl) return
    return () => URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file || saving) return

    setSaving(true)
    try {
      await addPhotoEntry({
        file,
        // parse 'yyyy-MM-dd' → локальная дата (полночь). addPhotoEntry сам
        // переведёт в ISO для occurred_at.
        occurredAt: parse(date, 'yyyy-MM-dd', new Date()),
        caption: caption.trim() || undefined,
      })
      toast.success(t('success'))
      router.push('/path')
      router.refresh()
    } catch (err) {
      // DEK потерян (PIN-сессия пережила reload, ключа в памяти нет) — без него
      // не зашифровать. Уводим на ввод PIN, не теряя намерения добавить.
      if (err instanceof PinRequiredError) {
        toast(t('pinNeeded'))
        router.push('/pin')
        return
      }
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(t('error', { error: msg }))
      setSaving(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {/* Превью / плейсхолдер */}
      <div className="space-y-3">
        {previewUrl ? (
          <div className="overflow-hidden rounded-2xl bg-card ring-1 ring-border">
            {/* object URL выбранного файла — next/image не применим (не http-источник). */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt=""
              className="block max-h-[60vh] w-full object-contain"
            />
          </div>
        ) : (
          <div className="flex aspect-[4/3] items-center justify-center rounded-2xl bg-card text-3xl text-foreground/30 ring-1 ring-border">
            ✦
          </div>
        )}

        {/* accept=image/* без capture: на мобильном даёт выбор камера/галерея. */}
        <label
          className={cn(
            buttonVariants({ variant: 'outline', size: 'lg' }),
            'cursor-pointer',
          )}
        >
          {file ? t('changePhoto') : t('pickPhoto')}
          <input
            type="file"
            accept="image/*"
            onChange={onPick}
            disabled={saving}
            className="sr-only"
          />
        </label>
      </div>

      {/* Дата события */}
      <div className="space-y-1.5">
        <Label htmlFor="occurred-at">{t('dateLabel')}</Label>
        <div>
          <DatePicker value={date} onChange={setDate} />
        </div>
      </div>

      {/* Подпись (опционально) */}
      <div className="space-y-1.5">
        <Label htmlFor="caption">
          {t('captionLabel')}{' '}
          <span className="font-normal text-muted-foreground">
            {t('captionOptional')}
          </span>
        </Label>
        <Textarea
          id="caption"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder={t('captionPlaceholder')}
          rows={2}
          disabled={saving}
        />
      </div>

      <button
        type="submit"
        disabled={!file || saving}
        className={cn(buttonVariants({ size: 'lg' }), 'w-full')}
      >
        {saving ? t('saving') : t('submit')}
      </button>
    </form>
  )
}
