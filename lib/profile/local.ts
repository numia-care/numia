// Минимальный профиль — ТОЛЬКО локально на устройстве (localStorage), не на
// сервере. Имя для приветствия и форма обращения для словаря приветствий.
//
// Форма обращения влияет ИСКЛЮЧИТЕЛЬНО на приветствия (lib/dashboard/greetings).
// Это НЕ система местоимений: весь остальной UI остаётся гендерно-нейтральным.
// Формы:
//   she     — «ты хорошо спала»
//   he      — «ты хорошо спал»
//   they    — небинарная, мн.ч.: «ты хорошо спали»
//   neutral — безличное, без рода/числа: «Доброе утро»
// Полные склонения неостандартных местоимений — отдельный будущий проект.

export type AddressForm = 'she' | 'he' | 'they' | 'neutral'

const NAME_KEY = 'numia_name'
const FORM_KEY = 'numia_address_form'

export function getDisplayName(): string | null {
  if (typeof window === 'undefined') return null
  const v = localStorage.getItem(NAME_KEY)
  return v && v.trim() ? v : null
}

export function setDisplayName(name: string): void {
  if (typeof window === 'undefined') return
  const trimmed = name.trim()
  if (trimmed) localStorage.setItem(NAME_KEY, trimmed)
  else localStorage.removeItem(NAME_KEY)
}

export function getAddressForm(): AddressForm {
  if (typeof window === 'undefined') return 'neutral'
  const v = localStorage.getItem(FORM_KEY)
  return v === 'she' || v === 'he' || v === 'they' ? v : 'neutral'
}

export function setAddressForm(f: AddressForm): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(FORM_KEY, f)
}
