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

  return (
    <section className="mb-10">
      <h2 className="mb-4 font-heading text-2xl text-foreground">
        {t('title')}
      </h2>

      {slots.length === 0 ? (
        <EmptyToday />
      ) : (
        <div className="grid gap-3">
          {slots.map((slot) => (
            <SlotCardForSlot
              key={slot.id}
              slot={slot}
              timezone={tz}
              formStr={
                slot.medication ? tMedForm(slot.medication.form) : ''
              }
            />
          ))}
        </div>
      )}
    </section>
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
}: {
  slot: TodaySlot
  timezone: string
  formStr: string
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
    />
  )
}
