'use client'

import { Trash2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

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
import { softDeleteMedication } from '@/lib/tracker/medications'

export function MedicationDeleteButton({
  id,
  name,
}: {
  id: string
  name: string
}) {
  const t = useTranslations('tracker.card')
  const tc = useTranslations('common')
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const onConfirm = () => {
    startTransition(async () => {
      const result = await softDeleteMedication(id)
      if (result.ok) {
        setOpen(false)
        // revalidatePath бьёт серверный кеш; refresh перерисовывает текущий
        // /tracker, чтобы удалённая карточка исчезла сразу, без перезагрузки.
        router.refresh()
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* Розовая пилюля 47×29 с красной корзиной — замер эталона преппараты2
          (заливка #FEDADA, глиф #CF3A40). Подпись ушла в aria-label: в макете
          это иконка без текста. */}
      <DialogTrigger
        render={
          <button
            type="button"
            aria-label={t('deleteButton')}
            title={t('deleteButton')}
            className="shadow-soft flex h-[29px] w-[47px] items-center justify-center rounded-full transition-opacity hover:opacity-80"
            style={{ backgroundColor: 'var(--kai-danger-soft)', color: 'var(--kai-danger)' }}
          >
            <Trash2Icon className="size-[18px]" strokeWidth={1.8} />
          </button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('deleteTitle', { name })}</DialogTitle>
          <DialogDescription>{t('deleteDescription')}</DialogDescription>
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
            {t('deleteConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
