'use client'

import { CameraIcon, FeatherIcon, MicIcon, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslations } from 'next-intl'

import { cn } from '@/lib/utils'
import { DiaryForm } from './diary-form'
import { PhotoForm } from './photo-form'
import { VoiceForm } from './voice-form'

// Экран добавления записи по PNG-эталонам «путь новая запись …»: три круглые
// кнопки режима (камера / микрофон / перо) по центру, активная — лавандовая.
// Медиа-формы идут в общий E2E-пайплайн (lib/path/entries), дневник — в
// addDiaryEntry (настроение открыто, текст шифруется).
type Mode = 'photo' | 'voice' | 'diary'

const MODES: readonly { mode: Mode; icon: LucideIcon; label: string }[] = [
  { mode: 'photo', icon: CameraIcon, label: 'modePhoto' },
  { mode: 'voice', icon: MicIcon, label: 'modeVoice' },
  { mode: 'diary', icon: FeatherIcon, label: 'modeDiary' },
]

export function NewEntry({ initialMode = 'photo' }: { initialMode?: Mode }) {
  const t = useTranslations('path.new')
  const [mode, setMode] = useState<Mode>(initialMode)

  return (
    <div className="space-y-8">
      {/* Кружки режима — по центру, активный на мягкой лаванде. */}
      <div className="flex items-center justify-center gap-3">
        {MODES.map(({ mode: m, icon: Icon, label }) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            aria-label={t(label)}
            title={t(label)}
            className={cn(
              'shadow-soft flex size-[52px] items-center justify-center rounded-full transition-colors',
              mode === m
                ? 'bg-lavender-soft text-foreground'
                : 'bg-card text-foreground hover:bg-secondary',
            )}
          >
            <Icon className="size-[24px]" strokeWidth={1.8} />
          </button>
        ))}
      </div>

      {mode === 'photo' && <PhotoForm />}
      {mode === 'voice' && <VoiceForm />}
      {mode === 'diary' && <DiaryForm />}
    </div>
  )
}
