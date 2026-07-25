'use client'

import { EyeIcon, EyeOffIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

// 6-значный PIN-инпут. Один <input> вместо 6 отдельных полей:
// inputMode="numeric" даёт нативную цифровую клавиатуру на мобилке,
// одно поле проще для autocomplete и paste, letter-spacing визуально
// разводит цифры — выглядит как PIN не хуже чем 6 квадратиков.
//
// По умолчанию цифры замаскированы (type=password — защита от подглядывания
// через плечо). Глазик справа переключает показ/скрытие.

type Props = {
  value: string
  onChange: (v: string) => void
  autoFocus?: boolean
  disabled?: boolean
  name?: string
}

export function PinInput({
  value,
  onChange,
  autoFocus,
  disabled,
  name = 'pin',
}: Props) {
  const ref = useRef<HTMLInputElement>(null)
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus])

  return (
    <div className="relative">
      <input
        ref={ref}
        name={name}
        // password маскирует точками; inputMode="numeric" сохраняет цифровую
        // клавиатуру на мобилке независимо от type (iOS 12.2+, Android).
        type={show ? 'text' : 'password'}
        inputMode="numeric"
        autoComplete="off"
        pattern="[0-9]{6}"
        maxLength={6}
        disabled={disabled}
        value={value}
        // Фильтруем не-цифры на каждом вводе — на случай paste с пробелами/дефисами.
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        placeholder="••••••"
        className="w-full rounded-xl border border-border bg-white px-4 py-3 pr-12 text-center text-2xl tracking-[0.5em] text-foreground outline-none placeholder:text-muted-foreground placeholder:tracking-[0.3em] focus:border-ring focus:ring-2 focus:ring-ring/40"
      />
      <button
        type="button"
        // tabIndex=-1: глазик — мышь/тач-аффорданс, не должен ловить Tab между
        // полем и кнопкой submit и не должен мешать Enter-сабмиту формы.
        tabIndex={-1}
        onClick={() => setShow((s) => !s)}
        aria-label={show ? 'Скрыть PIN' : 'Показать PIN'}
        className="absolute top-1/2 right-3 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-50"
        disabled={disabled}
      >
        {show ? (
          <EyeOffIcon className="size-5" />
        ) : (
          <EyeIcon className="size-5" />
        )}
      </button>
    </div>
  )
}
