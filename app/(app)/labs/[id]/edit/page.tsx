import { notFound, redirect } from 'next/navigation'

import { getLabResultForEdit } from '@/lib/labs/queries'

// Старый маршрут правки — по id ПОКАЗАТЕЛЯ. Правка переехала на уровень
// сдачи (подшаг 5): дата, заметка и бланк общие, и править их по одному
// показателю значило бы менять их у соседей вслепую.
//
// Роут оставлен редиректом ради закладок и истории навигации у тестеров:
// такие ссылки уже разосланы на превью. Убрать через пару релизов, как
// сделали с /more.
//
// Ради этого редиректа жива getLabResultForEdit — она больше нигде не
// вызывается, но и мёртвой не является.
export default async function EditLabResultPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const row = await getLabResultForEdit(id)
  if (!row) notFound()

  redirect(`/labs/session/${row.session_id}/edit`)
}
