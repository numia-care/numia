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

// Мягкий лимит длительности: на 2:00 запись останавливается автоматически.
const MAX_MS = 2 * 60 * 1000

// Длительность в mm:ss (не превышает лимит).
function formatMmSs(ms: number): string {
  const total = Math.floor(Math.min(ms, MAX_MS) / 1000)
  const mm = String(Math.floor(total / 60)).padStart(2, '0')
  const ss = String(total % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

// ── Жизненный цикл микрофона ─────────────────────────────────────────────────
// Железное правило: остановка записи = НЕМЕДЛЕННЫЙ track.stop() по всем трекам
// (это и гасит системный индикатор микрофона). Асинхронного onstop не ждём.

// Остановить все треки потока. track.stop() идемпотентен — повторный вызов
// безвреден, поэтому и синхронный стоп, и подстраховка в onstop могут звать его
// на один поток.
function stopTracks(stream: MediaStream | null) {
  stream?.getTracks().forEach((tr) => tr.stop())
}

// Полный teardown текущей пары рекордер+поток: снять колбэки (опоздавший
// onstop старого рекордера не должен трогать новое состояние), остановить
// рекордер, погасить треки, очистить refs. Используется перед перезаписью,
// при ошибке getUserMedia и на unmount.
function disposeRecorder(
  recorderRef: React.RefObject<MediaRecorder | null>,
  streamRef: React.RefObject<MediaStream | null>,
) {
  const rec = recorderRef.current
  if (rec) {
    rec.ondataavailable = null
    rec.onstop = null
    if (rec.state !== 'inactive') {
      try {
        rec.stop()
      } catch {
        // уже остановлен между проверкой state и вызовом — не страшно
      }
    }
    recorderRef.current = null
  }
  stopTracks(streamRef.current)
  streamRef.current = null
}

export function VoiceForm() {
  const t = useTranslations('path.new')
  const router = useRouter()

  const [recording, setRecording] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
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

  // Подстраховка: полностью освободить микрофон, если ушли со страницы во
  // время записи (навигация, свайп назад → unmount). Снимаем и колбэки
  // рекордера — блоб после смерти компонента собирать некому и незачем.
  useEffect(() => {
    return () => {
      disposeRecorder(recorderRef, streamRef)
    }
  }, [])

  // Таймер длительности + мягкий автостоп на MAX_MS. elapsedMs сбрасываем в 0
  // в startRecording (не здесь — иначе синхронный setState в эффекте).
  useEffect(() => {
    if (!recording) return
    const startedAt = Date.now()
    const id = setInterval(() => {
      const e = Date.now() - startedAt
      setElapsedMs(e)
      // Достигли лимита — останавливаем как по тапу «Остановить»: рекордер
      // флашит данные, треки гаснут сразу (индикатор микрофона тоже).
      if (e >= MAX_MS) stopRecording()
    }, 250)
    return () => clearInterval(id)
  }, [recording])

  async function startRecording() {
    // ПЕРЕЗАПИСЬ: старый рекордер и поток обязаны быть полностью освобождены
    // ДО getUserMedia — iOS с ещё занятым микрофоном иногда отдаёт
    // NotReadableError (отсюда «то падает, то работает»). Снятие колбэков
    // важно не меньше: опоздавший onstop СТАРОГО рекордера не должен стрелять
    // в состояние НОВОЙ записи.
    disposeRecorder(recorderRef, streamRef)

    setBlob(null)
    setPreviewUrl(null)
    setElapsedMs(0)
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
        // Гасим именно ЭТОТ поток (замыкание), а не streamRef.current: к
        // моменту асинхронного onstop в ref может лежать уже СЛЕДУЮЩИЙ поток
        // перезаписи — его гасить нельзя. Обычно треки уже остановлены
        // синхронно в stopRecording, тогда это no-op (stop() идемпотентен).
        stopTracks(stream)
      }

      recorder.start()
      setRecording(true)
    } catch {
      toast.error(t('micError'))
      disposeRecorder(recorderRef, streamRef)
    }
  }

  function stopRecording() {
    const rec = recorderRef.current
    // stop() флашит записанное (финальный dataavailable + onstop придут
    // асинхронно) — данные уже в буфере, остановка треков их не теряет.
    if (rec && rec.state !== 'inactive') rec.stop()
    // Треки гасим СИНХРОННО, не дожидаясь onstop: индикатор микрофона должен
    // погаснуть сразу после тапа, всегда (на iOS onstop может опаздывать).
    stopTracks(streamRef.current)
    streamRef.current = null
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
        ) : recording ? (
          <div className="text-center">
            <p className="font-mono text-3xl tabular-nums text-foreground">
              {formatMmSs(elapsedMs)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{t('recording')}</p>
          </div>
        ) : (
          <p className="text-center text-sm text-muted-foreground">{t('recordHint')}</p>
        )}

        <button
          type="button"
          onClick={recording ? stopRecording : startRecording}
          disabled={saving}
          className={cn(
            'w-full rounded-xl px-4 py-3 text-sm font-medium text-white transition-colors focus:outline-none focus:ring-2 focus:ring-ring/50 disabled:opacity-50',
            recording ? 'bg-rose-600 hover:bg-rose-700' : 'bg-primary hover:bg-primary/90',
          )}
        >
          {recording ? t('stopRecording') : blob ? t('reRecord') : t('record')}
        </button>

        {!previewUrl && (
          <p className="text-center text-xs text-muted-foreground">{t('recordMax')}</p>
        )}
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
