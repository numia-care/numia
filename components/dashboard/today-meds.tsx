import { ChevronRightIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'

import { MedicationsIcon } from '@/components/icons'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import { generateSlotsForActiveMeds } from '@/lib/tracker/slot-generator'
import { formatSlotTime, getTodaySlots, type TodaySlot } from '@/lib/tracker/today'
import { getUserTimezoneServer } from '@/lib/timezone-server'

// Сводка сегодняшних приёмов на дашборде — ЗАМЕР эталона today.jpg:
//   карточка ~337×114, в шапке ТОЛЬКО иконка-планшет по центру (без заголовка
//   и счётчика «N из M»), справа белый кружок-стрелка d=38.5 в Трекер,
//   ниже приёмы простым текстом «HH:MM Название» в 3 ряда × 2 колонки
//   (колонка 1 с x≈53.7, колонка 2 с x≈187, шаг рядов 23).
//
// Показываем ВСЕ приёмы дня, а не только ближайшие невыполненные: в макете их
// шесть, и карточка читается как расписание дня целиком. Цветных пилюль
// (розовая/голубая/серые) в макете нет — обычный текст.
//
// Открытые данные под RLS (время + название, не E2E), поэтому считаем на
// сервере. Нет приёмов — тёплая заглушка.
//
// Генерация слотов идёт СИНХРОННО до чтения (решение 2026-07-30, тот же фикс,
// что на /tracker): в after() она выполнялась уже после ответа, и на первом
// заходе карточка показывала пустоту вместо приёмов. Ошибку глотаем — лучше
// показать то, что уже есть в БД, чем уронить дашборд.
export async function TodayMeds() {
  const t = await getTranslations('dashboard')
  const user = await getAuthUser()

  let slots: TodaySlot[] = []
  let tz = 'UTC'
  if (user) {
    tz = await getUserTimezoneServer()
    const supabase = await createClient()
    try {
      await generateSlotsForActiveMeds(supabase, user.id, tz, 1)
    } catch (e) {
      console.error('slot generation before dashboard render failed:', e)
    }
    slots = await getTodaySlots(tz)
  }

  return (
    <div className="card-glass relative px-5 py-3.5">
      {/* Шапка: иконка по центру, стрелка справа. Ссылка теперь на самой
          стрелке, а не на всей карточке — так в макете. */}
      <div className="relative flex items-center justify-center">
        <MedicationsIcon className="size-[19px] text-foreground" />
        <Link
          href="/tracker"
          aria-label={t('medsTitle')}
          className="shadow-soft absolute right-0 flex size-[38px] items-center justify-center rounded-full bg-card text-foreground transition-colors hover:bg-white"
        >
          <ChevronRightIcon className="size-5" strokeWidth={1.8} />
        </Link>
      </div>

      {slots.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{t('medsEmpty')}</p>
      ) : (
        // grid-flow-col + явное число рядов: первая половина дня ложится в
        // ЛЕВУЮ колонку сверху вниз, вторая — в правую (порядок как в макете).
        <div
          className="mt-3 grid grid-flow-col grid-cols-2 gap-x-4 gap-y-1.5"
          style={{ gridTemplateRows: `repeat(${Math.ceil(slots.length / 2)}, auto)` }}
        >
          {slots.map((s) => (
            <p key={s.id} className="flex items-baseline gap-3 text-[13px] text-foreground">
              <time className="shrink-0 tabular-nums text-foreground/70">
                {formatSlotTime(s.scheduled_at, tz)}
              </time>
              <span className="min-w-0 truncate">{s.medication?.name ?? '—'}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
