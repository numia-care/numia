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
  // Заголовок секции теперь дата, а не строка из словаря — отсюда только
  // переводы форм препаратов.
  const tMedForm = await getTranslations('tracker.medForm')

  // Сколько приёмов ещё ждёт действия: isLast (===1) — отметка этого слота
  // закроет день → щедрее вспышка ✦; ===0 при непустом дне — «день закрыт».
  const upcomingCount = slots.filter((s) => s.status === 'upcoming').length

  // Дата над списком — по эталону преппараты1 («23.09.26»), в таймзоне юзера.
  // Раньше здесь стояла белая пилюля «Сегодня», в макете её нет.
  const dateLabel = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    timeZone: timezone,
  }).format(new Date())

  return (
    <section className="mb-8">
      <p className="text-[17px] font-semibold tracking-[-0.01em] text-foreground">
        {dateLabel}
      </p>

      {slots.length === 0 ? (
        <NoneToday />
      ) : (
        <>
          {upcomingCount === 0 && <AllDoneToday />}
          {/* Зазор 4 — замер эталона (было 10). */}
          <div className="mt-3 grid gap-1">
            {slots.map((slot) => (
              <SlotCardForSlot
                key={slot.id}
                slot={slot}
                timezone={timezone}
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
    <div className="mt-3 rounded-full border border-chip-yellow-border/60 bg-chip-yellow/50 p-3 text-center text-sm text-foreground/80">
      {t('allDone')}
    </div>
  )
}

// Слотов на сегодня нет — ПРИНИМАТЬ НЕЧЕГО. Состояние окончательное: слоты
// генерируются синхронно до рендера (page.tsx), так что пустой список больше не
// может означать «ещё не создались». Не путать с AllDoneToday: там приёмы были
// и все отмечены, здесь их сегодня нет вовсе.
async function NoneToday() {
  const t = await getTranslations('tracker.today')
  return (
    <div className="mt-3 rounded-2xl bg-card p-6 text-center text-foreground/80 ring-1 ring-border">
      {t('none')}
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
      form={med?.form}
      status={slot.status}
      timezone={timezone}
      isLast={isLast}
    />
  )
}
