'use client'

import { useEffect } from 'react'

// Смягчение iOS-поведения с клавиатурой: при фокусе на поле iOS сам скроллит
// страницу, часто уводя шапку за верхний край. Полностью это не чинится
// (системное), но после того как клавиатура выехала, мы можем мягко доскроллить
// поле к центру видимой области — экран встаёт предсказуемо.
//
// Глобальный focusin (один слушатель на всё приложение, не по формам):
//   • реагируем только на текстовые поля (input/textarea), не на кнопки/селекты;
//   • ждём ~350мс — анимация клавиатуры iOS, скроллить раньше бессмысленно;
//   • scrollIntoView block:'center' — поле в середине, шапке легче выжить;
//   • отменяем, если фокус уже ушёл (быстрый blur) — не дёргаем экран зря.
//
// Вешается один раз в корневом layout. Ничего не рендерит.

// Поля, у которых фокус вызывает клавиатуру. type=checkbox/radio/range и
// кнопки клавиатуру не открывают — их не трогаем.
function opensKeyboard(el: Element): el is HTMLElement {
  if (el instanceof HTMLTextAreaElement) return true
  if (el instanceof HTMLInputElement) {
    return !['checkbox', 'radio', 'range', 'button', 'submit', 'file'].includes(el.type)
  }
  return false
}

export function KeyboardScrollAssist() {
  useEffect(() => {
    let timer: number | undefined

    function onFocusIn(e: FocusEvent) {
      const el = e.target
      if (!(el instanceof Element) || !opensKeyboard(el)) return

      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        // Фокус мог уйти, пока ждали клавиатуру — тогда не скроллим.
        if (document.activeElement !== el) return
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }, 350)
    }

    document.addEventListener('focusin', onFocusIn)
    return () => {
      document.removeEventListener('focusin', onFocusIn)
      window.clearTimeout(timer)
    }
  }, [])

  return null
}
