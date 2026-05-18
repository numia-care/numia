'use client'

import { useEffect, useRef } from 'react'

// 6-значный PIN-инпут. Один <input> вместо 6 отдельных полей:
// inputMode="numeric" даёт нативную цифровую клавиатуру на мобилке,
// одно поле проще для autocomplete и paste, letter-spacing визуально
// разводит цифры — выглядит как PIN не хуже чем 6 квадратиков.

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

  useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus])

  return (
    <input
      ref={ref}
      name={name}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      pattern="[0-9]{6}"
      maxLength={6}
      disabled={disabled}
      value={value}
      // Фильтруем не-цифры на каждом вводе — на случай paste с пробелами/дефисами.
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      placeholder="••••••"
      className="w-full rounded-xl border border-[#E8E2D8] bg-white px-4 py-3 text-center text-2xl tracking-[0.5em] text-[#3A3A3A] outline-none placeholder:text-[#B8B0A4] placeholder:tracking-[0.3em] focus:border-[#9CAF88] focus:ring-2 focus:ring-[#C9B6E4]/40"
    />
  )
}
