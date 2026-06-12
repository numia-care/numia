// ============================================================================
// Edge Function: generate-upcoming — слоты приёмов на ближайшие ~48 часов
// ============================================================================
//
// Запускается pg_cron'ом раз в сутки в 00:30 UTC (миграция etap1b_cron_jobs).
//
// Зачем: on-demand генерация в today-section.tsx создаёт слоты только когда
// юзер ОТКРЫЛ /tracker. Для пушей слот должен существовать в БД ДО того, как
// настало его время — иначе send-reminders нечего отправлять. Эта функция
// заранее создаёт слоты всем юзерам по всем активным препаратам.
//
// «48 часов» реализованы как 3 календарных дня (сегодня + 2) в таймзоне
// каждого юзера — так же считает дни клиентский генератор, и полнота важнее
// точной границы: лишние слоты завтра-послезавтра не мешают, а недостающие
// = пропущенный пуш.
//
// Идемпотентность: upsert с ignoreDuplicates по unique-индексу
// (medication_id, scheduled_at) — тому же, что дедуплицирует on-demand
// генерацию. КРИТИЧНО: расчёт UTC-времени слота обязан побайтово совпадать
// с lib/tracker/schedule.ts (computeSlotsForDay), иначе дедупликация
// сломается и юзер получит двойные слоты. Поэтому ниже — прямой порт той
// функции на тех же библиотеках (date-fns-tz). Меняешь логику там — меняй
// и здесь.
//
// Секреты: только CRON_SECRET (см. send-reminders/index.ts и DEPLOY.md).

import { createClient } from 'npm:@supabase/supabase-js@2'
import { addDays } from 'npm:date-fns@4'
import { formatInTimeZone, fromZonedTime } from 'npm:date-fns-tz@3'

const DAYS_AHEAD = 3
// Не вставляем больше N рядов за один запрос — страховка от раздувания
// payload'а когда юзеров станет много.
const UPSERT_CHUNK = 500

type Schedule =
  | { kind: 'daily'; times: string[] }
  | { kind: 'interval'; every_days: number; time: string; anchor_date: string }

// Облегчённая версия zod-валидации из lib/tracker/schedule.ts: данные в БД
// уже прошли полную проверку при записи, здесь достаточно отсечь мусор,
// чтобы один битый ряд не уронил генерацию для всех остальных юзеров.
function parseSchedule(input: unknown): Schedule | null {
  const s = input as Record<string, unknown>
  if (!s || typeof s !== 'object') return null
  if (s.kind === 'daily' && Array.isArray(s.times) && s.times.length > 0) {
    return s as Schedule
  }
  if (
    s.kind === 'interval' &&
    typeof s.every_days === 'number' &&
    s.every_days >= 1 &&
    typeof s.time === 'string' &&
    typeof s.anchor_date === 'string'
  ) {
    return s as Schedule
  }
  return null
}

// Порт computeSlotsForDay из lib/tracker/schedule.ts — см. подробные
// комментарии там (DST, выбор календарного дня в tz юзера).
function computeSlotsForDay(
  schedule: Schedule,
  date: Date,
  timezone: string,
): Date[] {
  const ymd = formatInTimeZone(date, timezone, 'yyyy-MM-dd')

  if (schedule.kind === 'daily') {
    return schedule.times
      .slice()
      .sort()
      .map((time) => fromZonedTime(`${ymd}T${time}:00`, timezone))
  }

  const diff = daysBetweenCalendarDates(schedule.anchor_date, ymd)
  if (diff < 0 || diff % schedule.every_days !== 0) return []
  return [fromZonedTime(`${ymd}T${schedule.time}:00`, timezone)]
}

function daysBetweenCalendarDates(fromYmd: string, toYmd: string): number {
  const [fy, fm, fd] = fromYmd.split('-').map(Number)
  const [ty, tm, td] = toYmd.split('-').map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000)
}

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get('CRON_SECRET')
  if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
    return new Response('forbidden', { status: 403 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

  // Активные препараты ВСЕХ юзеров (service_role, RLS не фильтрует).
  const { data: meds, error: medsError } = await supabase
    .from('medications')
    .select('id, user_id, schedule, start_date')
    .is('deleted_at', null)
    .is('end_date', null)

  if (medsError) {
    console.error('medications query failed:', medsError.message)
    return Response.json({ error: medsError.message }, { status: 500 })
  }

  if (!meds || meds.length === 0) {
    return Response.json({ medications: 0, inserted: 0 })
  }

  // Таймзоны юзеров одним запросом → Map. У medications нет FK на profiles
  // (обе ссылаются на auth.users), поэтому join-embedding supabase-js
  // недоступен — два запроса.
  const userIds = [...new Set(meds.map((m) => m.user_id as string))]
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, timezone')
    .in('id', userIds)

  if (profilesError) {
    console.error('profiles query failed:', profilesError.message)
    return Response.json({ error: profilesError.message }, { status: 500 })
  }

  const tzByUser = new Map(
    (profiles ?? []).map((p) => [p.id as string, p.timezone as string]),
  )

  const today = new Date()
  let skippedInvalid = 0
  const slots: {
    medication_id: string
    user_id: string
    scheduled_at: string
    status: 'upcoming'
  }[] = []

  for (const med of meds) {
    const schedule = parseSchedule(med.schedule)
    if (!schedule) {
      skippedInvalid += 1
      console.error(`medication ${med.id}: invalid schedule json, skipped`)
      continue
    }
    const timezone = tzByUser.get(med.user_id as string) ?? 'UTC'

    for (let i = 0; i < DAYS_AHEAD; i += 1) {
      const day = addDays(today, i)
      // Препарат ещё не стартовал в этот день — сравниваем календарные даты
      // в tz юзера (start_date в БД — голая YYYY-MM-DD строка).
      if (formatInTimeZone(day, timezone, 'yyyy-MM-dd') < (med.start_date as string)) {
        continue
      }
      for (const utc of computeSlotsForDay(schedule, day, timezone)) {
        slots.push({
          medication_id: med.id as string,
          user_id: med.user_id as string,
          scheduled_at: utc.toISOString(),
          status: 'upcoming',
        })
      }
    }
  }

  let inserted = 0
  for (let i = 0; i < slots.length; i += UPSERT_CHUNK) {
    const chunk = slots.slice(i, i + UPSERT_CHUNK)
    const { data, error } = await supabase
      .from('intake_events')
      .upsert(chunk, {
        onConflict: 'medication_id,scheduled_at',
        ignoreDuplicates: true,
      })
      .select('id')

    if (error) {
      console.error('intake_events upsert failed:', error.message)
      return Response.json({ error: error.message }, { status: 500 })
    }
    inserted += data?.length ?? 0
  }

  return Response.json({
    medications: meds.length,
    slotsComputed: slots.length,
    inserted, // меньше slotsComputed = остальные уже существовали, это норма
    skippedInvalid,
  })
})
