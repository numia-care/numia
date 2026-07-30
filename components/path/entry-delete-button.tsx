'use client'

import { Trash2Icon } from 'lucide-react'
import { useState } from 'react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import type { PathEntry } from '@/lib/path/entries'

// Кнопка «Убрать» в ПОЛНОМ ПРОСМОТРЕ записи (в ленте её больше нет — по макету
// карточки чистые, удаление живёт на один тап глубже). Круглая иконка-корзина в
// шапке просмотра + диалог подтверждения.
//
// Сама НЕ удаляет: после подтверждения отдаёт запись наверх (onDelete), а лента
// делает отложенное удаление с 5-секундным «Отменить» в тосте
// (см. PathFeed.scheduleDelete) — случайный тап обратим.
export function EntryDeleteButton({
  entry,
  onDelete,
}: {
  entry: PathEntry
  onDelete: (entry: PathEntry) => void
}) {
  const t = useTranslations('path.delete')
  const tc = useTranslations('common')
  const [open, setOpen] = useState(false)

  const onConfirm = () => {
    setOpen(false)
    onDelete(entry)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            aria-label={t('button')}
            title={t('button')}
            className="shadow-card flex size-11 shrink-0 items-center justify-center rounded-full bg-card text-foreground transition-colors hover:bg-secondary"
          >
            <Trash2Icon className="size-[20px]" strokeWidth={1.8} />
          </button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {tc('cancel')}
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
