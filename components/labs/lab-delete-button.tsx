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
import { deleteLabSession } from '@/lib/labs/records'

/**
 * Удаление СДАЧИ целиком, с подтверждением.
 *
 * Не путать с «убрать показатель» — это «×» в форме выше: там уходит одна
 * строка, а дата и бланк остаются соседям. Здесь уходит вся сдача: все её
 * показатели и бланк разом.
 *
 * По образцу MedicationDeleteButton, но копи другая по смыслу: у препаратов
 * удаление мягкое и обратимое, здесь — насовсем. Сказано прямо, но без
 * запугивания: предупреждение, а не окрик. Текст зависит от того, что
 * реально уйдёт — показатели с бланком, только показатели или только бланк.
 *
 * После удаления уходим на «Анализы»: экран правки удалённой сдачи
 * показывать нечего. router.refresh() дочищает серверный кеш списка.
 */
export function LabDeleteButton({
  sessionId,
  rowCount,
  blankPhotoPath,
}: {
  sessionId: string
  /** Сколько показателей уйдёт вместе со сдачей. 0 — сдача «только бланк». */
  rowCount: number
  blankPhotoPath: string | null
}) {
  const t = useTranslations('labs.delete')
  const tc = useTranslations('common')
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const hasPhoto = blankPhotoPath != null

  // Три состояния вместо двух: у сдачи может не быть показателей (только
  // бланк) — тогда говорить про них нечего.
  const description =
    rowCount === 0
      ? t('descriptionPhotoOnly')
      : hasPhoto
        ? t('descriptionWithPhoto', { count: rowCount })
        : t('description', { count: rowCount })

  const onConfirm = () => {
    startTransition(async () => {
      try {
        await deleteLabSession(sessionId, blankPhotoPath)
      } catch {
        // Содержимое сдачи в тост не тащим — только факт неудачи.
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
              backgroundColor: 'var(--brand-danger-soft)',
              color: 'var(--brand-danger)',
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
          <DialogDescription>{description}</DialogDescription>
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
