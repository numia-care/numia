'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

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
import { deleteEntry, type PathEntry } from '@/lib/path/entries'

// Кнопка «Убрать» на записи ленты «Пути» (любой тип: фото/голос/дневник) с
// диалогом подтверждения — паттерн как у удаления препарата. Удаление
// НЕОБРАТИМОЕ (в отличие от soft-delete препаратов): ряд + шифроблоб в Storage.
// После успеха дёргаем onDeleted — лента убирает запись из своего state сама
// (она клиентская, router.refresh() её не перерисует).
export function EntryDeleteButton({
  entry,
  onDeleted,
}: {
  entry: PathEntry
  onDeleted: (id: string) => void
}) {
  const t = useTranslations('path.delete')
  const tc = useTranslations('common')
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const onConfirm = () => {
    startTransition(async () => {
      try {
        await deleteEntry(entry)
        setOpen(false)
        toast.success(t('success'))
        onDeleted(entry.id)
      } catch {
        toast.error(t('error'))
      }
    })
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
          <Button
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            {tc('cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isPending}
          >
            {t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
