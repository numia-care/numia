import { getTranslations } from 'next-intl/server'
import Link from 'next/link'

import { createClient } from '@/lib/supabase/server'
import { generateSlotsForActiveMeds } from '@/lib/tracker/slot-generator'
import { formatSlotTime, getTodaySlots, type TodaySlot } from '@/lib/tracker/today'
import { getUserTimezone } from '@/lib/timezone-actions'

// Компактная сводка сегодняшних приёмов на дашборде. Открытые данные под RLS
// (числа/статусы, не E2E), поэтому считаем на сервере. Нет приёмов на сегодня →
// тёплая заглушка. Вся карточка — ссылка в Трекер.
export async function TodayMeds() {
  const t = await getTranslations('dashboard')
  const tz = await getUserTimezone()
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  let slots: TodaySlot[] = []
  if (user) {
    // On-demand генерация на сегодня (дёшево, idempotent) — чтобы сводка была
    // точной, даже если юзер ещё не открывал Трекер. Как в TodaySection.
    await generateSlotsForActiveMeds(supabase, user.id, tz, 1)
    slots = await getTodaySlots(tz)
  }

  const taken = slots.filter((s) => s.status === 'taken').length
  const pending = slots.filter((s) => s.status === 'upcoming')
  const shown = pending.slice(0, 4)
  const extra = pending.length - shown.length

  // Цвета чипов по фрейму Кая: первый — розовый, второй — голубой,
  // остальные — нейтральные серые.
  const chipClass = (i: number) =>
    i === 0
      ? 'border-chip-pink-border bg-chip-pink'
      : i === 1
        ? 'border-chip-blue-border bg-chip-blue'
        : 'border-transparent bg-[#F5F5F5]'

  return (
    // Стекло-карточка по фрейму: заголовок 14px/500 + счётчик «(N из M)».
    <Link href="/tracker" className="card-glass block p-5 transition-shadow hover:shadow-md">
      <h2 className="text-sm font-medium text-[#1F1F1F]">{t('medsTitle')}</h2>

      {slots.length === 0 ? (
        <p className="mt-1.5 text-sm text-muted-foreground">{t('medsEmpty')}</p>
      ) : (
        <>
          <p className="mt-0.5 text-[10px] text-[#A4A4A4]">
            ({t('medsProgress', { taken, total: slots.length })})
          </p>
          {pending.length > 0 && (
            // grid-flow-col + rows-2: цветные чипы (первые два ближайших)
            // ложатся в ЛЕВУЮ колонку сверху вниз — как в фрейме Кая.
            <div className="mt-3 grid grid-flow-col grid-cols-2 grid-rows-2 gap-1.5">
              {shown.map((s, i) => (
                <span
                  key={s.id}
                  className={`truncate rounded-full border px-2.5 py-1 text-xs text-[#1F1F1F] ${chipClass(i)}`}
                >
                  {formatSlotTime(s.scheduled_at, tz)} • {s.medication?.name ?? '—'}
                </span>
              ))}
              {extra > 0 && (
                <span className="px-1 py-1 text-xs text-muted-foreground">+{extra}</span>
              )}
            </div>
          )}
        </>
      )}
    </Link>
  )
}
