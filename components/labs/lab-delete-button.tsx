'use client'

import { Trash2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
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
import { deleteLabResult } from '@/lib/labs/records'

/**
 * Удаление показателя с подтверждением. По образцу MedicationDeleteButton,
 * но с важной разницей в копи: у препаратов удаление мягкое и обратимое, а
 * здесь ряд уходит насовсем вместе с заметкой и фото бланка. Это сказано в
 * тексте прямо — но без запугивания: предупреждение, а не окрик.
 *
 * После удаления уходим на /labs: экран редактирования удалённой записи
 * показывать нечего. router.refresh() дочищает серверный кеш списка.
 */
export function LabDeleteButton({
  id,
  blankPhotoPath,
}: {
  id: string
  blankPhotoPath: string | null
}) {
  const t = useTranslations('labs.delete')
  const tc = useTranslations('common')
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const onConfirm = () => {
    startTransition(async () => {
      try {
        await deleteLabResult({ id, blank_photo_path: blankPhotoPath })
      } catch {
        // Содержимое записи в тост не тащим — только факт неудачи.
        toast.error(t('failed'))
        return
      }
      setOpen(false)
      toast.success(t('done'))
      router.push('/tracker?tab=analyses')
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            className="shadow-soft flex items-center gap-2 rounded-full px-4 py-2 text-sm transition-opacity hover:opacity-80"
            style={{
              backgroundColor: 'var(--kai-danger-soft)',
              color: 'var(--kai-danger)',
            }}
          >
            <Trash2Icon className="size-[18px]" strokeWidth={1.8} />
            {t('button')}
          </button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>
            {blankPhotoPath ? t('descriptionWithPhoto') : t('description')}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            {tc('cancel')}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isPending}>
            {t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
