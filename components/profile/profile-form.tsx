'use client'

import { CheckIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  getAddressForm,
  getDisplayName,
  setAddressForm,
  setDisplayName,
  type AddressForm,
} from '@/lib/profile/local'
import { cn } from '@/lib/utils'

// Профиль — имя и форма обращения, ТОЛЬКО локально (localStorage). Пишем сразу
// на изменение. Начальные значения читаем в инициализаторе useState (на SSR —
// пусто/нейтрально), несовпадение гидрации на полях гасим suppressHydrationWarning.
export function ProfileForm() {
  const t = useTranslations('profile')

  const [name, setName] = useState(() => getDisplayName() ?? '')
  const [form, setForm] = useState<AddressForm>(() => getAddressForm())

  // Сохранение идёт на лету (localStorage), поэтому даём явный фидбек: коротко
  // показываем «Сохранено ✦». Таймер сбрасывается при каждом изменении, так что
  // во время набора имени бейдж висит и гаснет через ~1.6с после последней правки.
  const [saved, setSaved] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function flashSaved() {
    setSaved(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setSaved(false), 1600)
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const options: { value: AddressForm; label: string }[] = [
    { value: 'she', label: t('formShe') },
    { value: 'he', label: t('formHe') },
    { value: 'they', label: t('formThey') },
    { value: 'neutral', label: t('formNeutral') },
  ]

  return (
    <div className="space-y-6">
      {/* Фидбек сохранения. Высоту резервируем, чтобы не дёргать вёрстку. */}
      <div className="flex h-5 justify-end">
        {saved && (
          <span className="flex items-center gap-1 text-sm text-moss duration-300 animate-in fade-in">
            <CheckIcon className="size-4" />
            {t('saved')}
          </span>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="profile-name">{t('nameLabel')}</Label>
        <Input
          id="profile-name"
          value={name}
          suppressHydrationWarning
          onChange={(e) => {
            setName(e.target.value)
            setDisplayName(e.target.value)
            flashSaved()
          }}
          placeholder={t('namePlaceholder')}
          maxLength={40}
        />
        <p className="text-xs text-muted-foreground">{t('nameHint')}</p>
      </div>

      <div className="space-y-1.5">
        <Label>{t('formLabel')}</Label>
        <div className="flex flex-wrap gap-2" suppressHydrationWarning>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                setForm(o.value)
                setAddressForm(o.value)
                flashSaved()
              }}
              aria-pressed={form === o.value}
              className={cn(
                'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                form === o.value
                  ? 'bg-[#5A6B4A] text-white'
                  : 'bg-muted/50 text-muted-foreground hover:text-foreground',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t('formHint')}</p>
      </div>
    </div>
  )
}
