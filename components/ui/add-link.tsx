import { PlusIcon } from 'lucide-react'
import Link from 'next/link'

// Единая кнопка добавления — тёмная круглая «+» по фрейму Кая (как на
// «Препаратах»). Использовать её на всех экранах со списками (Препараты,
// Путь, дальше — Анализы), чтобы паттерн не расползался по стилям.
// label обязателен: у иконки без текста должен быть aria-label.
export function AddLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="flex size-10 shrink-0 items-center justify-center rounded-full bg-foreground text-white transition-opacity hover:opacity-85"
    >
      <PlusIcon className="size-5" />
    </Link>
  )
}
