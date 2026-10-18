import {
  BandageIcon,
  CircleDotIcon,
  DropletIcon,
  PillIcon,
  SprayCanIcon,
  SyringeIcon,
  TabletsIcon,
} from 'lucide-react'

import type { MedicationRow } from '@/lib/tracker/queries'

// Иконка формы препарата — общая для карточки препарата («Все») и развёрнутой
// строки приёма («Сегодня»). В эталонах макета она стоит слева от описания
// (преппараты1 и преппараты2 — шприц у инъекции, таблетка у витамина).
//
// TODO: заменить на иконки набора — в локальном наборе исходников форм препаратов пока нет,
// поэтому здесь временные из lucide. Геометрия и место посадки уже по макету,
// подмена будет одной строкой на форму.

type MedForm = MedicationRow['form']

const ICONS: Record<MedForm, typeof PillIcon> = {
  tablet: PillIcon,
  capsule: TabletsIcon,
  injection: SyringeIcon,
  gel: DropletIcon,
  patch: BandageIcon,
  drops: DropletIcon,
  spray: SprayCanIcon,
  other: CircleDotIcon,
}

export function MedFormIcon({
  form,
  className,
}: {
  form: MedForm
  className?: string
}) {
  const Icon = ICONS[form] ?? CircleDotIcon
  return <Icon className={className} strokeWidth={1.8} aria-hidden />
}
