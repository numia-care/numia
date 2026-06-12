import { redirect } from 'next/navigation'

// Главная защищённая страница — с этапа 1 это трекер.
// Редирект вместо дублирования контента: /tracker — единственный source of truth.
export default function Home() {
  redirect('/tracker')
}
