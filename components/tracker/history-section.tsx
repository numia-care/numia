import { getTranslations } from 'next-intl/server'
import { formatInTimeZone } from 'date-fns-tz'

import { computeIntakeStats } from '@/lib/tracker/stats'
import { formatSlotTime, type IntakeSlot } from '@/lib/tracker/today'
import { formatDoseWithUnit } from '@/lib/tracker/units'
import { cn } from '@/lib/utils'

import { SlotBackfillDialog } from './slot-backfill-dialog'

// Вкладка «История» на экране «Препараты» — ПРЕЗЕНТАЦИОННАЯ: слоты и tz
// приходят сверху (TrackerData в page.tsx), сама она в БД не ходит. Тот же
// принцип, что у TodaySection, и по той же причине — не плодить второй
// водопад запросов на пути рендера.
//
// Слоты приходят уже отсортированными DESC (getSlotsInRange), группировка
// ниже этот порядок сохраняет: свежий день сверху, внутри дня — поздний
// приём выше раннего.

export async function HistorySection({
  slots,
  timezone,
}: {
  slots: IntakeSlot[]
  timezone: string
}) {
  const t = await getTranslations('tracker.history')

  if (slots.length === 0) return <HistoryEmpty />

  const stats = computeIntakeStats(slots)
  const groups = groupByDay(slots, timezone)

  return (
    <section className="mb-8">
      <StatsHeader stats={stats} t={t} />

      <div className="mt-6 space-y-6">
        {groups.map((group) => (
          <div key={group.ymd}>
            {/* Формат даты — как над списком «Сегодня» (эталон преппараты1). */}
            <p className="text-[17px] font-semibold tracking-[-0.01em] text-foreground">
              {group.label}
            </p>
            {/* Зазор 4 — тот же замер, что у слотов «Сегодня». */}
            <div className="mt-3 grid gap-1">
              {group.slots.map((slot) => (
                <HistoryRow key={slot.id} slot={slot} timezone={timezone} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

/**
 * Шапка со статистикой. Считает computeIntakeStats — только по status и
 * scheduled_at, без названий и доз (см. комментарий о приватности там же).
 */
function StatsHeader({
  stats,
  t,
}: {
  stats: ReturnType<typeof computeIntakeStats>
  t: Awaited<ReturnType<typeof getTranslations>>
}) {
  // adherence === null значит «знаменатель пуст» — это не 0%, а «нечего
  // считать»: например, вся история состоит из сегодняшних неотмеченных.
  if (stats.adherence === null) {
    return (
      <div className="card-glass p-5 text-center text-sm text-foreground/70">
        {t('statsNone')}
      </div>
    )
  }

  return (
    <div className="card-glass p-5">
      <div className="flex items-baseline justify-center gap-2">
        <span className="text-[32px] font-medium leading-none tracking-[-0.02em] text-foreground">
          {Math.round(stats.adherence * 100)}%
        </span>
        <span className="text-sm text-foreground/60">{t('statsRegularity')}</span>
      </div>

      <p className="mt-2 text-center text-sm text-foreground/70">
        {t('statsTaken', { taken: stats.taken, due: stats.due })}
      </p>

      {/* Намеренные пропуски — отдельной строкой и только когда они есть:
          в знаменатель регулярности они не входят (решение захода 2). */}
      {stats.skipped > 0 && (
        <p className="mt-1 text-center text-xs text-foreground/50">
          {t('statsSkipped', { count: stats.skipped })}
        </p>
      )}
    </div>
  )
}

/**
 * Строка приёма. Прошлые слоты (всё кроме upcoming) открывают backfill —
 * «приём был, вот когда». Это и есть точка входа для пропущенного: диалог
 * берёт дату из scheduled_at слота, поэтому работает на любой давности.
 *
 * Сегодняшние неотмеченные (upcoming) диалог НЕ открывают: их отмечают
 * чекбоксом на вкладке «Сегодня», дублировать управление здесь незачем.
 */
function HistoryRow({ slot, timezone }: { slot: IntakeSlot; timezone: string }) {
  const timeStr = formatSlotTime(slot.scheduled_at, timezone)
  const takenTimeStr = slot.taken_at
    ? formatSlotTime(slot.taken_at, timezone)
    : null

  const row = (
    <HistoryRowBody slot={slot} timeStr={timeStr} takenTimeStr={takenTimeStr} />
  )

  if (slot.status === 'upcoming') return row

  return (
    <SlotBackfillDialog
      id={slot.id}
      scheduledIso={slot.scheduled_at}
      defaultTimeStr={takenTimeStr ?? timeStr}
      timezone={timezone}
      currentStatus={slot.status}
    >
      {row}
    </SlotBackfillDialog>
  )
}

async function HistoryRowBody({
  slot,
  timeStr,
  takenTimeStr,
}: {
  slot: IntakeSlot
  timeStr: string
  takenTimeStr: string | null
}) {
  const t = await getTranslations('tracker.history')

  const med = slot.medication
  // medication_id обнуляется при hard-delete препарата (ON DELETE SET NULL) —
  // история приёма при этом остаётся. Показываем нейтрально, без «—».
  const medName = med?.name ?? t('deletedMed')
  const doseStr = med ? formatDoseWithUnit(med.dose_amount, med.dose_unit) : ''

  const view = describeStatus(slot, timeStr, takenTimeStr)

  return (
    <div
      className={cn(
        'shadow-card flex min-h-[52px] items-center gap-3 rounded-full bg-card px-4 py-2',
        slot.status !== 'upcoming' && 'cursor-pointer transition-opacity hover:opacity-100',
        view.dimmed && 'opacity-70',
      )}
    >
      <span
        className={cn('size-[17px] shrink-0 rounded-[6px] shadow-sm', view.dotClass)}
        style={view.dotStyle}
      />

      <span
        className={cn(
          'min-w-0 flex-1 truncate text-sm text-foreground',
          !med && 'italic text-foreground/60',
        )}
      >
        {medName}
      </span>

      <span className="shrink-0 text-right text-[11px] leading-tight text-foreground/70">
        <span className="block">{t(`status.${view.key}`)}</span>
        <span className="block text-foreground/50">
          {view.timeLabel}
          {doseStr && ` • ${doseStr}`}
        </span>
      </span>
    </div>
  )
}

/**
 * Как показать статус слота.
 *
 * «С опозданием» выводится, а не хранится: колонки «когда отметили» в схеме
 * нет, отличить отметку задним числом от отметки вовремя нельзя. Что МОЖНО
 * посчитать — разницу между taken_at и scheduled_at, и это как раз опоздание.
 * Сравниваем по минутам (как это уже делает slot-card), поэтому «принято
 * в свой слот» и «принято на две минуты позже» не разъезжаются на разные
 * статусы из-за секунд.
 */
function describeStatus(
  slot: IntakeSlot,
  timeStr: string,
  takenTimeStr: string | null,
): {
  key: 'taken' | 'late' | 'missed' | 'skipped' | 'pending' | 'upcoming'
  timeLabel: string
  dimmed: boolean
  dotClass: string
  dotStyle?: React.CSSProperties
} {
  const checkStyle = { backgroundColor: 'var(--kai-slot-check)' }

  if (slot.status === 'taken') {
    const late =
      takenTimeStr !== null &&
      takenTimeStr !== timeStr &&
      slot.taken_at !== null &&
      new Date(slot.taken_at).getTime() > new Date(slot.scheduled_at).getTime()

    return {
      key: late ? 'late' : 'taken',
      // У опоздания показываем ФАКТИЧЕСКОЕ время приёма, у обычного —
      // плановое: так строка отвечает на «когда приняли», а не «когда было
      // назначено».
      timeLabel: late ? (takenTimeStr as string) : timeStr,
      dimmed: false,
      dotClass: '',
      dotStyle: checkStyle,
    }
  }

  if (slot.status === 'missed') {
    return {
      key: 'missed',
      timeLabel: timeStr,
      dimmed: true,
      dotClass: 'bg-muted-foreground/30',
    }
  }

  if (slot.status === 'skipped') {
    return {
      key: 'skipped',
      timeLabel: timeStr,
      dimmed: true,
      dotClass: 'bg-muted-foreground/20',
    }
  }

  // upcoming: либо время уже прошло и слот ещё можно отметить сегодня
  // (развёртка переведёт его в missed только когда кончится день юзера),
  // либо приём ещё впереди.
  const isPast = new Date(slot.scheduled_at).getTime() < Date.now()
  return {
    key: isPast ? 'pending' : 'upcoming',
    timeLabel: timeStr,
    dimmed: false,
    dotClass: 'bg-card ring-1 ring-border',
  }
}

async function HistoryEmpty() {
  const t = await getTranslations('tracker.history')
  return (
    <div className="card-glass p-8 text-center">      <p className="mx-auto max-w-sm text-foreground/80">{t('empty')}</p>
    </div>
  )
}

/**
 * Группировка по календарному дню в tz юзера. Порядок слотов на входе (DESC)
 * сохраняется — и между днями, и внутри дня.
 */
function groupByDay(
  slots: IntakeSlot[],
  timezone: string,
): { ymd: string; label: string; slots: IntakeSlot[] }[] {
  const dateFormat = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    timeZone: timezone,
  })

  const groups: { ymd: string; label: string; slots: IntakeSlot[] }[] = []
  let current: (typeof groups)[number] | null = null

  for (const slot of slots) {
    // YMD в зоне юзера, а не UTC: иначе вечерний приём уезжал бы во «вчера»
    // для зон восточнее UTC и в «завтра» для западных.
    const ymd = formatInTimeZone(
      new Date(slot.scheduled_at),
      timezone,
      'yyyy-MM-dd',
    )
    if (!current || current.ymd !== ymd) {
      current = {
        ymd,
        label: dateFormat.format(new Date(slot.scheduled_at)),
        slots: [],
      }
      groups.push(current)
    }
    current.slots.push(slot)
  }

  return groups
}
