'use client'

import { format, parse } from 'date-fns'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { DatePicker } from '@/components/tracker/date-picker'
import { buttonVariants } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { addVoiceEntry, PinRequiredError } from '@/lib/path/entries'
import { cn } from '@/lib/utils'

// Форма записи голоса: записать → прослушать → дата + подпись → сохранить.
// Запись (Blob mp4/AAC из MediaRecorder) идёт в общий E2E-пайплайн addVoiceEntry
// (шифрование, аплоад, метаданные), после чего уходим в ленту.
//
// iOS Safari: webm не поддержан — берём audio/mp4 (AAC); getUserMedia зовётся
// строго из обработчика клика (user gesture), иначе standalone молча отказывает.

const MIME_CANDIDATES = [
  'audio/mp4',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/aac',
  'audio/webm;codecs=opus',
  'audio/webm',
]

export function VoiceForm() {
  const t = useTranslations('path.new')
  const router = useRouter()

  const [recording, setRecording] = useState(false)
  const [blob, setBlob] = useState<Blob | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [caption, setCaption] = useState('')
  const [saving, setSaving] = useState(false)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)

  // Отзываем превью при смене/размонтировании.
  useEffect(() => {
    if (!previewUrl) return
    return () => URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  // Подстраховка: отпустить микрофон, если ушли со страницы во время записи.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((tr) => tr.stop())
    }
  }, [])

  function releaseMic() {
    streamRef.current?.getTracks().forEach((tr) => tr.stop())
    streamRef.current = null
  }

  async function startRecording() {
    setBlob(null)
    setPreviewUrl(null)
    chunksRef.current = []

    try {
      // user gesture (клик) обязателен для iOS standalone.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const mimeType = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? ''
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)
      recorderRef.current = recorder

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        const type = recorder.mimeType || mimeType || 'audio/mp4'
        const recorded = new Blob(chunksRef.current, { type })
        setBlob(recorded)
        setPreviewUrl(URL.createObjectURL(recorded))
        setRecording(false)
        releaseMic()
      }

      recorder.start()
      setRecording(true)
    } catch {
      toast.error(t('micError'))
      releaseMic()
    }
  }

  function stopRecording() {
    recorderRef.current?.stop()
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!blob || saving || recording) return

    setSaving(true)
    try {
      await addVoiceEntry({
        blob,
        occurredAt: parse(date, 'yyyy-MM-dd', new Date()),
        caption: caption.trim() || undefined,
      })
      toast.success(t('voiceSuccess'))
      router.push('/path')
      router.refresh()
    } catch (err) {
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
      {/* Запись / превью */}
      <div className="space-y-3 rounded-2xl bg-card p-5 ring-1 ring-border">
        {previewUrl ? (
          <audio src={previewUrl} controls playsInline className="w-full" />
        ) : (
          <p className="text-center text-sm text-muted-foreground">
            {recording ? t('recording') : t('recordHint')}
          </p>
        )}

        <button
          type="button"
          onClick={recording ? stopRecording : startRecording}
          disabled={saving}
          className={cn(
            'w-full rounded-xl px-4 py-3 text-sm font-medium text-white transition-colors focus:outline-none focus:ring-2 focus:ring-ring/50 disabled:opacity-50',
            recording ? 'bg-rose-600 hover:bg-rose-700' : 'bg-[#5A6B4A] hover:bg-[#4A5A3A]',
          )}
        >
          {recording ? t('stopRecording') : blob ? t('reRecord') : t('record')}
        </button>
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
        disabled={!blob || saving || recording}
        className={cn(buttonVariants({ size: 'lg' }), 'w-full')}
      >
        {saving ? t('saving') : t('submit')}
      </button>
    </form>
  )
}
