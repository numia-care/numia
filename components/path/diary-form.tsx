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
    <form onSubmit={onSubmit} className="space-y-7">
      {/* «Как ты?» + плитки настроения (по эталону: подписи под плитками,
          свечение позади ряда — внутри MoodScale). */}
      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <Label className="text-[15px] font-semibold">{t('moodLabel')}</Label>
          <span className="text-xs text-black/40">{t('captionOptional')}</span>
        </div>
        <MoodScale value={mood} onChange={setMood} disabled={saving} />
      </div>

      {/* «Напиши здесь» + дата-пилюля справа, большое поле (по эталону). */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="diary-note" className="text-[15px] font-semibold">
            {t('noteLabel')}
          </Label>
          <DatePicker
            value={date}
            onChange={setDate}
            disableFuture
            className="shadow-card h-10 rounded-full border-0 bg-card px-3.5"
          />
        </div>
        <Textarea
          id="diary-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('notePlaceholder')}
          rows={10}
          disabled={saving}
          className="min-h-[280px] rounded-[30px] border-0 bg-card/70 p-5 shadow-none"
        />
      </div>

      <div className="flex justify-center">
        <button
          type="submit"
          disabled={!hasContent || saving}
          className={cn(buttonVariants({ size: 'lg' }), 'rounded-full px-9')}
        >
          {saving ? t('saving') : t('submit')}
        </button>
      </div>
    </form>
  )
}
