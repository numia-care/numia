'use client'

import { ChevronDownIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import { decryptLabNote } from '@/lib/labs/notes'
import { PinRequiredError } from '@/lib/path/entries'
import { cn } from '@/lib/utils'

/**
 * Раскрывающаяся E2E-заметка к анализу.
 *
 * Клиентский островок внутри серверного списка (labs-history.tsx): расшифровка
 * возможна только здесь — DEK живёт в памяти вкладки и на сервер не попадает.
 *
 * Расшифровка ПО ТАПУ, а не заранее. Это отличие от ленты дневника
 * (components/path/diary-card.tsx), где текст расшифровывается по появлению
 * карточки в вьюпорте: там заметка и есть содержимое карточки, здесь она
 * вторична. Ленивый разбор дешевле и строже по приватности — ничего не
 * расшифровано, пока не попросили. Результат кэшируется в стейте, повторный
 * тап крипту не гоняет.
 *
 * Истёкшая PIN-сессия — не ошибка, а штатный случай: ведём на /pin, как это
 * делает форма добавления анализа (lab-form.tsx).
 *
 * Содержимое заметки не логируется и не попадает в тосты — только факт сбоя.
 */
export function LabNote({ ciphertext }: { ciphertext: string | null }) {
  const t = useTranslations('labs')
  const router = useRouter()

  const [open, setOpen] = useState(false)
  const [text, setText] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  // Заметки нет — рендерить нечего. Вызывающая сторона обычно и так проверяет
  // has_note, но компонент не должен на это полагаться.
  if (!ciphertext) return null

  const onToggle = async () => {
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)

    // Уже расшифровано (или расшифровывается) — второй раз не гоняем.
    if (text !== null || loading) return

    setLoading(true)
    setFailed(false)
    try {
      setText(await decryptLabNote(ciphertext))
    } catch (err) {
      if (err instanceof PinRequiredError) {
        // Сворачиваем перед уходом: возвращаться на пустой раскрытый блок
        // некрасиво, а после ввода PIN юзер откроет заметку заново.
        setOpen(false)
        toast(t('notePinNeeded'))
        router.push('/pin')
        return
      }
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="-m-1 flex items-center gap-1 p-1 text-xs text-foreground/50 transition-colors hover:text-foreground/80"
      >
        {t('noteBadge')}
        <ChevronDownIcon
          className={cn('size-3 transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="mt-1.5">
          {failed ? (
            <p className="text-xs text-foreground/50">{t('noteError')}</p>
          ) : text !== null ? (
            // whitespace-pre-wrap — переносы строк юзер ставил сам, теряться
            // они не должны.
            <p className="whitespace-pre-wrap text-[13px] leading-[1.45] text-foreground">
              {text}
            </p>
          ) : (
            <div className="space-y-1.5" aria-hidden>
              <div className="h-3 w-full animate-pulse rounded bg-foreground/5" />
              <div className="h-3 w-3/5 animate-pulse rounded bg-foreground/5" />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
