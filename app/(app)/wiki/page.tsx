import { getTranslations } from 'next-intl/server'
import Link from 'next/link'

import { WikiIcon } from '@/components/icons/kai'

// Экран «Вики» — ЗАГЛУШКА до этапа 5 роадмапа (контентная база: препараты,
// эффекты, референсные значения). Роут заведён, чтобы карточка на дашборде
// вела в понятное «скоро», а не была мёртвой: тап в никуда читается как
// сломанное приложение.
//
// Когда появится контент — этот файл заменяется списком статей, а карточка
// на дашборде начинает показывать превью вместо заглушки.
export default async function WikiPage() {
  const t = await getTranslations('wiki')

  return (
    <div className="page-shell py-10 sm:py-14">
      <h1 className="mb-6 text-center text-[28px] font-medium tracking-[-0.02em] text-foreground">
        {t('title')}
      </h1>

      <div className="card-glass p-8 text-center">
        <WikiIcon className="mx-auto size-8 text-foreground/70" />
        <p className="mt-4 text-lg text-foreground">{t('soonTitle')}</p>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-foreground/70">
          {t('soonText')}
        </p>

        <div className="mt-6">
          <Link
            href="/"
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {t('back')}
          </Link>
        </div>
      </div>
    </div>
  )
}
