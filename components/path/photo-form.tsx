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
    <form onSubmit={onSubmit} className="space-y-7">
      {/* Большая белая зона снимка (r:30, по эталону) — вся кликабельна. */}
      <label className="block cursor-pointer">
        {previewUrl ? (
          <div className="shadow-soft overflow-hidden rounded-[30px] bg-card">
            {/* object URL выбранного файла — next/image не применим. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt=""
              className="block max-h-[55vh] w-full object-contain"
            />
          </div>
        ) : (
          <div className="shadow-soft flex aspect-[4/5] max-h-[48vh] w-full items-center justify-center rounded-[30px] bg-card text-3xl text-foreground/25">
            ✦
          </div>
        )}
        {/* accept=image/* без capture: на мобильном даёт выбор камера/галерея. */}
        <input
          type="file"
          accept="image/*"
          onChange={onPick}
          disabled={saving}
          className="sr-only"
        />
      </label>

      {/* Ряд пилюль: [Выбрать фото] … [дата] — по эталону. */}
      <div className="flex items-center justify-between gap-3">
        <label
          className={cn(
            'shadow-card cursor-pointer rounded-full bg-card px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary',
            saving && 'pointer-events-none opacity-60',
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
        <DatePicker
          value={date}
          onChange={setDate}
          className="shadow-card h-11 rounded-full border-0 bg-card px-4"
        />
      </div>

      {/* Подпись (опционально) */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <Label htmlFor="caption" className="text-[15px] font-semibold">
            {t('captionLabel')}
          </Label>
          <span className="text-xs text-black/40">{t('captionOptional')}</span>
        </div>
        <Textarea
          id="caption"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          rows={3}
          disabled={saving}
          className="rounded-[20px] border-0 bg-card/70 shadow-none"
        />
      </div>

      {/* Лавандовая пилюля по центру (по эталону). */}
      <div className="flex justify-center">
        <button
          type="submit"
          disabled={!file || saving}
          className={cn(buttonVariants({ size: 'lg' }), 'rounded-full px-9')}
        >
          {saving ? t('saving') : t('submit')}
        </button>
      </div>
    </form>
  )
}
