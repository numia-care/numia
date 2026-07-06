'use client'

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

// Кнопка «Убрать» на записи ленты «Пути» (любой тип: фото/голос/дневник) с
// диалогом подтверждения. Сама НЕ удаляет: после подтверждения отдаёт запись
// наверх (onDelete), а лента делает отложенное удаление с 5-секундным
// «Отменить» в тосте (см. PathFeed.scheduleDelete) — случайный тап обратим.
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
          <Button
            variant="ghost"
            size="sm"
            className="h-auto px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground"
          >
            {t('button')}
          </Button>
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
