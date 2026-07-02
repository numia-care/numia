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
  const shown = pending.slice(0, 3)
  const extra = pending.length - shown.length

  return (
    <Link
      href="/tracker"
      className="block rounded-2xl bg-card p-5 ring-1 ring-border transition-colors hover:ring-sage/50"
    >
      <h2 className="font-heading text-lg text-foreground">{t('medsTitle')}</h2>

      {slots.length === 0 ? (
        <p className="mt-1 text-sm text-foreground/70">{t('medsEmpty')}</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-foreground/70">
            {t('medsProgress', { taken, total: slots.length })}
          </p>
          {pending.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {shown.map((s) => (
                <span
                  key={s.id}
                  className="rounded-lg bg-muted/60 px-2.5 py-1 text-xs text-foreground/80"
                >
                  {formatSlotTime(s.scheduled_at, tz)} · {s.medication?.name ?? '—'}
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
