import { ChevronRightIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'

import { WikiIcon } from '@/components/icons'

// «Вики» — ЛЕВАЯ из двух нижних карточек дашборда (ЗАМЕР эталона today.jpg:
// высота 154.5, в шапке иконка-книжка и подпись «Вики», справа кружок-шеврон,
// ниже превью статьи).
//
// Контента вики ещё нет (этап 5 роадмапа), поэтому в области превью — «скоро ✦»
// вместо статьи. Заголовок статьи, картинку и бейдж «new» из макета не
// переношу: это выдуманный контент, которого в продукте нет.
//
// Карточка при этом ЖИВАЯ и ведёт на /wiki — экран-заглушку, который честно
// говорит, что будет. Тап в никуда читается как сломанное приложение, поэтому
// лучше довести до понятного «скоро», чем гасить карточку.
//
// Когда вики наполнится — здесь появляется превью статьи, а /wiki становится
// списком; трогать раскладку карточки не придётся.
export async function WikiCard() {
  const t = await getTranslations('dashboard')

  return (
    <Link
      href="/wiki"
      className="card-glass flex h-[155px] flex-col p-3 transition-shadow hover:shadow-md"
    >
      <div className="flex items-center justify-between">
        <span className="flex min-w-0 items-center gap-2">
          <WikiIcon className="size-[19px] shrink-0 text-foreground" />
          <span className="truncate text-[13px] font-medium text-foreground">
            {t('wikiTitle')}
          </span>
        </span>
        <span className="shadow-soft flex size-[38px] shrink-0 items-center justify-center rounded-full bg-white text-foreground">
          <ChevronRightIcon className="size-[18px]" strokeWidth={1.8} />
        </span>
      </div>

      <div className="mt-2 flex flex-1 items-center justify-center rounded-md bg-secondary/60">
        <p className="text-[13px] text-muted-foreground">{t('wikiSoon')}</p>
      </div>
    </Link>
  )
}
