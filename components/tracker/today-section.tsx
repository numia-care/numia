import { getTranslations } from 'next-intl/server'

import { createClient } from '@/lib/supabase/server'
import { generateSlotsForActiveMeds } from '@/lib/tracker/slot-generator'
import { formatSlotTime, getTodaySlots, type TodaySlot } from '@/lib/tracker/today'
import { formatDoseWithUnit } from '@/lib/tracker/units'
import { getUserTimezone } from '@/lib/timezone-actions'

import { SlotCard } from './slot-card'

export async function TodaySection() {
  const t = await getTranslations('tracker.today')

  const tz = await getUserTimezone()
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  // On-demand генерация на сегодня. Дёшево (1 upsert с conflict ignore).
  await generateSlotsForActiveMeds(supabase, user.id, tz, 1)

  const slots = await getTodaySlots(tz)
  const tMedForm = await getTranslations('tracker.medForm')

  // Сколько приёмов ещё ждёт действия. Нужно для двух вещей:
  //   • isLast (===1) — отметка этого слота закроет день → щедрее вспышка ✦;
  //   • ===0 при непустом дне — показать «На сегодня всё ✦».
  const upcoming = slots.filter((s) => s.status === 'upcoming')
  const upcomingCount = upcoming.length
  // Два ближайших приёма — голубая и розовая пилюли (по фрейму Кая).
  const colorIndexById = new Map(upcoming.slice(0, 2).map((s, i) => [s.id, i]))

  return (
    <section className="mb-8">
      {/* Ярлык-пилюля секции — по фрейму (белая, r:25, тонкая обводка). */}
      <span className="inline-block rounded-full border border-border bg-white/90 px-4 py-1.5 text-sm text-[#242424] shadow-card">
        {t('title')}
      </span>

      {slots.length === 0 ? (
        <EmptyToday />
      ) : (
        <>
          {upcomingCount === 0 && <AllDoneToday />}
          <div className="mt-3 grid gap-2.5">
            {slots.map((slot) => (
              <SlotCardForSlot
                key={slot.id}
                slot={slot}
                timezone={tz}
                isLast={upcomingCount === 1}
                colorIndex={colorIndexById.get(slot.id)}
                formStr={
                  slot.medication ? tMedForm(slot.medication.form) : ''
                }
              />
            ))}
          </div>
        </>
      )}
    </section>
  )
}

// День закрыт: приёмы есть, но ждущих не осталось. Тёплая строка-итог.
async function AllDoneToday() {
  const t = await getTranslations('tracker.today')
  return (
    <div className="mt-3 rounded-full border border-chip-yellow-border/60 bg-chip-yellow/50 p-3 text-center text-sm text-[#1F1F1F]/80">
      {t('allDone')}
    </div>
  )
}

async function EmptyToday() {
  const t = await getTranslations('tracker.today')
  return (
    <div className="rounded-2xl bg-card p-6 text-center text-foreground/80 ring-1 ring-border">
      {t('empty')}
    </div>
  )
}

function SlotCardForSlot({
  slot,
  timezone,
  formStr,
  isLast,
  colorIndex,
}: {
  slot: TodaySlot
  timezone: string
  formStr: string
  isLast: boolean
  colorIndex?: number
}) {
  const med = slot.medication
  const timeStr = formatSlotTime(slot.scheduled_at, timezone)
  const takenTimeStr = slot.taken_at ? formatSlotTime(slot.taken_at, timezone) : null

  const medName = med?.name ?? '—'
  const doseStr = med
    ? formatDoseWithUnit(med.dose_amount, med.dose_unit)
    : ''

  return (
    <SlotCard
      id={slot.id}
      scheduledIso={slot.scheduled_at}
      timeStr={timeStr}
      takenTimeStr={takenTimeStr}
      medName={medName}
      doseStr={doseStr}
      formStr={formStr}
      status={slot.status}
      timezone={timezone}
      isLast={isLast}
      colorIndex={colorIndex}
    />
  )
}
