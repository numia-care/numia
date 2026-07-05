'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import { cn } from '@/lib/utils'
import { DiaryForm } from './diary-form'
import { PhotoForm } from './photo-form'
import { VoiceForm } from './voice-form'

// Экран добавления записи: переключатель «Фото | Запись | Дневник» + форма.
// Медиа-формы идут в общий E2E-пайплайн (lib/path/entries), дневник — в
// addDiaryEntry (настроение открыто, текст шифруется).
type Mode = 'photo' | 'voice' | 'diary'

const MODES: readonly Mode[] = ['photo', 'voice', 'diary']

const MODE_LABEL: Record<Mode, string> = {
  photo: 'modePhoto',
  voice: 'modeVoice',
  diary: 'modeDiary',
}

export function NewEntry() {
  const t = useTranslations('path.new')
  const [mode, setMode] = useState<Mode>('photo')

  return (
    <div className="space-y-6">
      {/* Сегментированный переключатель режима. */}
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-card p-1 ring-1 ring-border">
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            className={cn(
              'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
              mode === m
                ? 'bg-[#5A6B4A] text-white'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t(MODE_LABEL[m])}
          </button>
        ))}
      </div>

      {mode === 'photo' && <PhotoForm />}
      {mode === 'voice' && <VoiceForm />}
      {mode === 'diary' && <DiaryForm />}
    </div>
  )
}
