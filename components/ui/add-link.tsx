import { PlusIcon } from 'lucide-react'
import Link from 'next/link'

// Единая кнопка добавления — белый круг с волосяной обводкой по фрейму Кая
// (52px, тень-card). Один паттерн на экранах со списками (Путь и др.).
// label обязателен: у иконки без текста должен быть aria-label.
export function AddLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="shadow-card flex size-[50px] shrink-0 items-center justify-center rounded-full border border-black/10 bg-card text-foreground transition-colors hover:bg-secondary"
    >
      <PlusIcon className="size-5" />
    </Link>
  )
}
