'use client'

import { CheckIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  getAddressForm,
  getDisplayName,
  type AddressForm,
} from '@/lib/profile/local'
import { flushProfile, saveProfileLocal } from '@/lib/profile/sync'
import { cn } from '@/lib/utils'

// Профиль — имя и форма обращения. Локальный кэш пишем сразу на изменение
// (через saveProfileLocal), зашифрованную серверную копию пушим с дебаунсом:
// имя печатается по букве, гонять шифрование+сеть на каждый keystroke незачем.
// Даже если пуш не успеет (ушли с экрана/закрыли вкладку) — правка не теряется:
// dirty-флаг допушит её при следующем syncProfile. Начальные значения читаем в
// инициализаторе useState (на SSR — пусто/нейтрально), несовпадение гидрации
// на полях гасим suppressHydrationWarning.
const PUSH_DEBOUNCE_MS = 800

export function ProfileForm() {
  const t = useTranslations('profile')

  const [name, setName] = useState(() => getDisplayName() ?? '')
  const [form, setForm] = useState<AddressForm>(() => getAddressForm())

  // Дебаунс шифрованного пуша на сервер (кэш при этом уже обновлён).
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function save(next: { name: string; addressForm: AddressForm }) {
    saveProfileLocal(next)
    if (pushTimerRef.current) clearTimeout(pushTimerRef.current)
    pushTimerRef.current = setTimeout(() => void flushProfile(), PUSH_DEBOUNCE_MS)
    flashSaved()
  }

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
      // Уходим с экрана, не дожидаясь дебаунса — допушиваем сразу (no-op,
      // если пуш уже успел и dirty снят).
      if (pushTimerRef.current) clearTimeout(pushTimerRef.current)
      void flushProfile()
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
            save({ name: e.target.value, addressForm: form })
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
                save({ name, addressForm: o.value })
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
