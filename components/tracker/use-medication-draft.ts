import { useEffect, useState } from 'react'
import type { UseFormReturn } from 'react-hook-form'

import type { MedicationFormValues } from './medication-form-schema'

// Черновик формы препарата в localStorage.
//
// Зачем: приложение может увести на экран PIN прямо во время редактирования —
// уход в фон дольше грейс-периода лочит сессию (см. lib/crypto/session.ts,
// components/pin-gate.tsx). Форма при этом размонтируется и весь ввод
// теряется (фидбер тестера). Черновик сохраняет введённое и восстанавливает
// его, когда юзер снова открывает эту же форму после разблокировки.
//
// Локально (localStorage), не E2E — сознательно: данные трекера «стандартного»
// уровня (Postgres+RLS, не шифруются, см. CLAUDE.md). Черновик не добавляет
// чувствительности сверх уже сохранённого препарата и живёт только на этом
// устройстве. Чистится при успешном сохранении и по кнопке «Очистить».

const PREFIX = 'numia:med-draft:'
// Не воскрешаем древние черновики: возврат к форме спустя дни не должен
// неожиданно подсовывать давно брошенный ввод.
const MAX_AGE_MS = 24 * 60 * 60 * 1000
const SAVE_DEBOUNCE_MS = 400

function draftKey(mode: string, editId?: string): string {
  return `${PREFIX}${mode}:${editId ?? 'new'}`
}

interface StoredDraft {
  ts: number
  values: MedicationFormValues
}

function readDraft(key: string): StoredDraft | null {
  if (typeof window === 'undefined') return null
  const raw = localStorage.getItem(key)
  if (!raw) return null
  try {
    const draft = JSON.parse(raw) as StoredDraft
    if (typeof draft?.ts !== 'number' || Date.now() - draft.ts > MAX_AGE_MS) {
      localStorage.removeItem(key)
      return null
    }
    return draft
  } catch {
    localStorage.removeItem(key)
    return null
  }
}

export function useMedicationDraft(
  form: UseFormReturn<MedicationFormValues>,
  mode: 'create' | 'edit',
  editId?: string,
  // Вызывается когда черновик восстановлен — форма раскрывает детали, чтобы
  // восстановленные доза/тип/расписание были видны (в create они свёрнуты).
  onRestored?: () => void,
) {
  const key = draftKey(mode, editId)
  const [restored, setRestored] = useState(false)

  // Восстановление при монтировании. Через микротаск (await) — чтобы форма
  // была смонтирована/гидратирована до form.reset (иначе рассинхрон гидрации:
  // сервер рендерит initial, клиент — черновик) и чтобы setState не звался
  // синхронно в теле эффекта.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      await Promise.resolve()
      if (cancelled) return
      const draft = readDraft(key)
      if (!draft) return
      // keepDefaultValues: базой «грязноты» остаются исходные значения, так что
      // восстановленный черновик считается изменённым и будет дальше сохраняться.
      form.reset(draft.values, { keepDefaultValues: true })
      setRestored(true)
      onRestored?.()
    })()
    return () => {
      cancelled = true
    }
    // key стабилен на жизнь формы; form — стабильная ссылка от useForm.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // Сохранение при каждом изменении (дебаунс), только когда форма «грязная» —
  // иначе писали бы черновик даже для нетронутой формы.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const sub = form.watch((values) => {
      if (!form.formState.isDirty) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        try {
          localStorage.setItem(key, JSON.stringify({ ts: Date.now(), values }))
        } catch {
          // storage недоступен/переполнен — молча пропускаем, это не критично.
        }
      }, SAVE_DEBOUNCE_MS)
    })
    return () => {
      sub.unsubscribe()
      if (timer) clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  function clearDraft() {
    if (typeof window !== 'undefined') localStorage.removeItem(key)
  }

  return {
    /** true — форма была восстановлена из черновика (показать плашку). */
    restored,
    /** Стереть черновик из storage (после успешного сохранения). */
    clearDraft,
    /** Спрятать плашку восстановления (после «Очистить»). */
    dismissRestored: () => setRestored(false),
  }
}
