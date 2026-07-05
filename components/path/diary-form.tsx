'use client'

import { format, parse } from 'date-fns'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { DatePicker } from '@/components/tracker/date-picker'
import { buttonVariants } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { addDiaryEntry, PinRequiredError, type MoodLevel } from '@/lib/path/entries'
import { cn } from '@/lib/utils'
import { MoodScale } from './mood-scale'

// Форма записи дневника: шкала настроения + свободный текст + дата → сохранить.
// Настроение открыто, текст шифруется на устройстве (см. addDiaryEntry). Хотя бы
// одно из двух должно быть заполнено — иначе кнопка недоступна.
export function DiaryForm() {
  const t = useTranslations('path.new')
  const router = useRouter()

  const [mood, setMood] = useState<MoodLevel | null>(null)
  const [note, setNote] = useState('')
  // occurred_at по умолчанию — сегодня; будущее запрещено (disableFuture ниже).
  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [saving, setSaving] = useState(false)

  // Инварианта записи дневника: настроение ИЛИ текст (совпадает с серверным CHECK).
  const hasContent = mood !== null || note.trim().length > 0

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!hasContent || saving) return

    setSaving(true)
    try {
      await addDiaryEntry({
        mood: mood ?? undefined,
        note: note.trim() || undefined,
        occurredAt: parse(date, 'yyyy-MM-dd', new Date()),
      })
      toast.success(t('diarySuccess'))
      router.push('/path')
      router.refresh()
    } catch (err) {
      // DEK потерян (PIN-сессия пережила reload) — текст не зашифровать. Уводим
      // на PIN, как в форме фото.
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
      {/* Настроение (опционально) */}
      <div className="space-y-2">
        <Label>
          {t('moodLabel')}{' '}
          <span className="font-normal text-muted-foreground">
            {t('captionOptional')}
          </span>
        </Label>
        <MoodScale value={mood} onChange={setMood} disabled={saving} />
      </div>

      {/* Текст (опционально) */}
      <div className="space-y-1.5">
        <Label htmlFor="diary-note">
          {t('noteLabel')}{' '}
          <span className="font-normal text-muted-foreground">
            {t('captionOptional')}
          </span>
        </Label>
        <Textarea
          id="diary-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('notePlaceholder')}
          rows={4}
          disabled={saving}
        />
      </div>

      {/* Дата события */}
      <div className="space-y-1.5">
        <Label htmlFor="occurred-at">{t('dateLabel')}</Label>
        <div>
          <DatePicker value={date} onChange={setDate} disableFuture />
        </div>
      </div>

      <button
        type="submit"
        disabled={!hasContent || saving}
        className={cn(buttonVariants({ size: 'lg' }), 'w-full')}
      >
        {saving ? t('saving') : t('submit')}
      </button>
    </form>
  )
}
