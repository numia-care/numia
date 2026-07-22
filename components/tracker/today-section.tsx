import { getTranslations } from 'next-intl/server'

import { formatSlotTime, type TodaySlot } from '@/lib/tracker/today'
import { formatDoseWithUnit } from '@/lib/tracker/units'

import { SlotCard } from './slot-card'

// Секция «Сегодня» на /tracker — ПРЕЗЕНТАЦИОННАЯ: slots и tz приходят
// сверху (TrackerData в page.tsx), сама она в БД не ходит. Раньше секция
// сама читала tz, гоняла генерацию слотов и select — это был второй
// последовательный водопад запросов на критическом пути рендера, и переход
// на вкладку занимал 2-3 секунды (перф-репорт беты, 2026-07-22).
export async function TodaySection({
  slots,
  timezone,
}: {
  slots: TodaySlot[]
  timezone: string
}) {
  const t = await getTranslations('tracker.today')
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
                timezone={timezone}
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
