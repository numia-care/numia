'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import { cn } from '@/lib/utils'
import { PhotoForm } from './photo-form'
import { VoiceForm } from './voice-form'

// Экран добавления записи: переключатель «Фото | Запись» + соответствующая
// форма. Обе формы дальше идут в общий E2E-пайплайн (lib/path/entries).
type Mode = 'photo' | 'voice'

export function NewEntry() {
  const t = useTranslations('path.new')
  const [mode, setMode] = useState<Mode>('photo')

  return (
    <div className="space-y-6">
      {/* Сегментированный переключатель режима. */}
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-card p-1 ring-1 ring-border">
        {(['photo', 'voice'] as const).map((m) => (
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
            {m === 'photo' ? t('modePhoto') : t('modeVoice')}
          </button>
        ))}
      </div>

      {mode === 'photo' ? <PhotoForm /> : <VoiceForm />}
    </div>
  )
}
