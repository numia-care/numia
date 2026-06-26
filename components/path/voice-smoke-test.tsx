'use client'

import { useEffect, useRef, useState } from 'react'

// ── Изолированный смоук-тест записи голоса ───────────────────────────────────
//
// Цель: убедиться, что MediaRecorder реально пишет и проигрывает звук в
// УСТАНОВЛЕННОЙ PWA на iOS — ДО подключения шифрования, аплоада и ленты.
// Причина порядка: на iOS Safari MediaRecorder капризный (webm не поддержан,
// нужен audio/mp4 + AAC; пермишен микрофона в standalone бывает странным).
// Если связка не заводится — голосовая фича бессмысленна, и это надо узнать
// первым. Диагностика выводится на экран, чтобы понять причину отказа.
//
// ВРЕМЕННЫЙ файл — удалим после подтверждения воспроизведения в iOS PWA.
//
// Тексты нейтральны (повелительное / средний род / страдательный залог).

type Phase = 'idle' | 'recording' | 'recorded' | 'error'

// iOS Safari пишет в mp4/aac; webm — только Chromium/Firefox. Перебираем по
// приоритету и берём первый поддержанный (isTypeSupported).
const MIME_CANDIDATES = [
  'audio/mp4',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/aac',
  'audio/webm;codecs=opus',
  'audio/webm',
]

export function VoiceSmokeTest() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [chosenType, setChosenType] = useState('')
  const [sizeKb, setSizeKb] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)

  // Платформенная диагностика — считаем один раз на клиенте.
  const [diag] = useState(() => {
    if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined') {
      return { standalone: false, supported: [] as string[], hasGUM: false }
    }
    const supported = MIME_CANDIDATES.filter((t) => MediaRecorder.isTypeSupported(t))
    const standalone =
      window.matchMedia?.('(display-mode: standalone)').matches === true ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true
    return {
      standalone,
      supported,
      hasGUM: typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia,
    }
  })

  // Отзываем object URL прошлой записи при смене/размонтировании.
  useEffect(() => {
    if (!audioUrl) return
    return () => URL.revokeObjectURL(audioUrl)
  }, [audioUrl])

  // Подстраховка: отпустить микрофон, если ушли со страницы во время записи.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  function releaseMic() {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  function pickMimeType(): string {
    return MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t)) ?? ''
  }

  async function startRecording() {
    setError(null)
    setSizeKb(null)
    // Сбрасываем прошлую запись.
    setAudioUrl(null)
    chunksRef.current = []

    try {
      // getUserMedia ВНУТРИ обработчика клика — это user gesture, без него iOS
      // в standalone молча отказывает в доступе к микрофону.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const mimeType = pickMimeType()
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)
      recorderRef.current = recorder

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = () => {
        // recorder.mimeType — фактический тип, который выбрал браузер.
        const type = recorder.mimeType || mimeType || 'audio/mp4'
        const blob = new Blob(chunksRef.current, { type })
        setChosenType(type)
        setSizeKb(Math.round(blob.size / 1024))
        setAudioUrl(URL.createObjectURL(blob))
        setPhase('recorded')
        releaseMic()
      }

      recorder.onerror = () => {
        setError('Ошибка записи (recorder.onerror).')
        setPhase('error')
        releaseMic()
      }

      recorder.start()
      setChosenType(mimeType || '(дефолт браузера)')
      setPhase('recording')
    } catch (e) {
      // Самое ценное на iOS — имя ошибки: NotAllowedError (отказ/нет промпта),
      // NotFoundError (нет микрофона), SecurityError и т.п.
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
      setError(msg)
      setPhase('error')
      releaseMic()
    }
  }

  function stopRecording() {
    recorderRef.current?.stop()
  }

  const recording = phase === 'recording'

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={recording ? stopRecording : startRecording}
        className={
          'w-full rounded-xl px-4 py-4 text-base font-medium text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#C9B6E4]/60 ' +
          (recording ? 'bg-rose-600 hover:bg-rose-700' : 'bg-[#5A6B4A] hover:bg-[#4A5A3A]')
        }
      >
        {recording ? '● Остановить' : 'Записать'}
      </button>

      {recording && (
        <p className="text-center text-sm text-[#7A7A7A]">Идёт запись… говори в микрофон.</p>
      )}

      {error && (
        <div className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700">
          <p className="font-medium">Не удалось записать</p>
          <p className="mt-1 break-words font-mono text-xs">{error}</p>
        </div>
      )}

      {audioUrl && (
        <div className="space-y-2 rounded-xl bg-[#FAF6F0] p-4">
          <p className="text-sm text-[#5A6B4A]">Запись готова — нажми play:</p>
          {/* Нативные controls: на iOS так надёжнее всего проиграть обратно. */}
          <audio src={audioUrl} controls playsInline className="w-full" />
          <p className="font-mono text-xs text-[#7A7A7A]">
            тип: {chosenType || '—'} · размер: {sizeKb ?? '—'} КБ
          </p>
        </div>
      )}

      {/* Диагностика — помогает понять отказ на конкретном устройстве. */}
      <div
        suppressHydrationWarning
        className="space-y-1 rounded-xl border border-[#E8E2D8] p-4 font-mono text-xs text-[#7A7A7A]"
      >
        <p>standalone (PWA): {diag.standalone ? 'да' : 'нет'}</p>
        <p>getUserMedia: {diag.hasGUM ? 'есть' : 'НЕТ'}</p>
        <p>поддержка типов: {diag.supported.length ? diag.supported.join(', ') : 'нет ни одного'}</p>
      </div>
    </div>
  )
}
