import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { after } from 'next/server'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { generateSlotsForActiveMeds } from '@/lib/tracker/slot-generator'
import { formatSlotTime, getTodaySlots, type TodaySlot } from '@/lib/tracker/today'
import { getUserTimezoneServer } from '@/lib/timezone-server'

// Компактная сводка сегодняшних приёмов на дашборде. Открытые данные под RLS
// (числа/статусы, не E2E), поэтому считаем на сервере. Нет приёмов на сегодня →
// тёплая заглушка. Вся карточка — ссылка в Трекер.
//
// Перф: auth/tz кэшированы на запрос, генерация слотов — в after() (после
// ответа, страховка самолечения), критический путь — один select слотов.
// Та же схема, что на /tracker (перф-репорт беты, 2026-07-22).
export async function TodayMeds() {
  const t = await getTranslations('dashboard')
  const user = await getAuthUser()

  let slots: TodaySlot[] = []
  let tz = 'UTC'
  if (user) {
    tz = await getUserTimezoneServer()
    const supabase = await createClient() // до after(): cookies в нём недоступны
    after(async () => {
      try {
        await generateSlotsForActiveMeds(supabase, user.id, tz, 1)
      } catch (e) {
        console.error('slot generation after dashboard render failed:', e)
      }
    })
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
        : 'border-transparent bg-secondary'

  return (
    // Стекло-карточка по фрейму: заголовок 14px/500 + счётчик «(N из M)».
    <Link href="/tracker" className="card-glass block p-5 transition-shadow hover:shadow-md">
      <h2 className="text-sm font-medium text-foreground">{t('medsTitle')}</h2>

      {slots.length === 0 ? (
        <p className="mt-1.5 text-sm text-muted-foreground">{t('medsEmpty')}</p>
      ) : (
        <>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            ({t('medsProgress', { taken, total: slots.length })})
          </p>
          {pending.length > 0 && (
            // grid-flow-col + rows-2: цветные чипы (первые два ближайших)
            // ложатся в ЛЕВУЮ колонку сверху вниз — как в фрейме Кая.
            <div className="mt-3 grid grid-flow-col grid-cols-2 grid-rows-2 gap-1.5">
              {shown.map((s, i) => (
                <span
                  key={s.id}
                  className={`truncate rounded-full border px-2.5 py-1 text-xs text-foreground ${chipClass(i)}`}
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
