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
  const upcomingCount = slots.filter((s) => s.status === 'upcoming').length

  return (
    <section className="mb-10">
      <h2 className="mb-4 font-heading text-2xl text-foreground">
        {t('title')}
      </h2>

      {slots.length === 0 ? (
        <EmptyToday />
      ) : (
        <>
          {upcomingCount === 0 && <AllDoneToday />}
          <div className="grid gap-3">
            {slots.map((slot) => (
              <SlotCardForSlot
                key={slot.id}
                slot={slot}
                timezone={tz}
                isLast={upcomingCount === 1}
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
    <div className="mb-3 rounded-2xl bg-sage/15 p-4 text-center text-foreground/80 ring-1 ring-sage/25">
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
}: {
  slot: TodaySlot
  timezone: string
  formStr: string
  isLast: boolean
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
    />
  )
}
