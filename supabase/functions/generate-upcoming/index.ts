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

// Короткая ссылка на юзера для логов: первые 8 символов uuid. Логи Edge
// Functions хранит Supabase, и полный user_id там связывается с email через
// ту же базу — поэтому в логи он не попадает нигде (privacy-аудит 2026-08-02,
// та же минимизация, что в send-reminders).
const userRef = (id: string) => String(id).slice(0, 8)

type Schedule =
  | { kind: 'daily'; times: string[] }
  | { kind: 'interval'; every_days: number; time: string; anchor_date: string }

type SlotRow = {
  medication_id: string
  user_id: string
  scheduled_at: string
  status: 'upcoming'
}

// Инварианты расписания. Копия из lib/tracker/schedule.ts — значения обязаны
// совпадать с zod-схемой там, иначе веб запишет то, что здесь отвергнется.
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/
const MAX_TIMES = 12
const MIN_EVERY_DAYS = 1
const MAX_EVERY_DAYS = 180

type ScheduleParse =
  | { ok: true; schedule: Schedule }
  | { ok: false; reason: string }

/**
 * Полная проверка schedule из БД.
 *
 * РАНЬШЕ здесь стояла облегчённая версия, и обоснованием ей было «данные в БД
 * уже прошли zod при записи». Посылка оказалась неверной: zod живёт в рантайме
 * Node, а в самой базе инварианта тогда не было — форма значения в колонке
 * ничем не гарантировалась.
 *
 * Чем это обошлось: проверялась внешняя форма массива времён, а сами значения
 * — нет. Неожидаемое время превращалось в Invalid Date, на приведении к ISO
 * прогон падал целиком, и слоты не создавались НИ ОДНОМУ пользователю — пуши
 * переставали приходить всем. Само не восстанавливалось.
 *
 * Закрыто там, где и следовало: CHECK medications_schedule_valid на
 * medications.schedule (миграция 20261015120000, применена к проду
 * 2026-10-18). Негодная форма в колонку больше не попадает — ни из веба, ни из
 * iOS, ни из прямого запроса.
 *
 * Эта проверка остаётся второй линией и повторяет те же инварианты, включая
 * формат каждого времени. Невалидное → ok: false, строка уходит в
 * skippedInvalid, прогон остальных продолжается. Зачем она при живом
 * констрейнте: ночная генерация не должна зависеть от того, что лежит в
 * строке, — ни сейчас, ни если инвариант когда-нибудь ослабят.
 *
 * reason — статическая строка без значений из ряда: он уходит в логи, а туда
 * медданные не тащим (privacy-аудит 2026-08-02).
 */
function parseSchedule(input: unknown): ScheduleParse {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, reason: 'schedule не JSON-объект' }
  }
  const s = input as Record<string, unknown>

  if (s.kind === 'daily') {
    const times = s.times
    if (!Array.isArray(times)) {
      return { ok: false, reason: 'daily: times не массив' }
    }
    if (times.length < 1 || times.length > MAX_TIMES) {
      return { ok: false, reason: `daily: times вне границ 1..${MAX_TIMES}` }
    }
    for (const time of times) {
      if (typeof time !== 'string') {
        return { ok: false, reason: 'daily: элемент times не строка' }
      }
      // Ровно та регулярка, что в zod: '9:00' без ведущего нуля — тоже мусор,
      // и именно он давал Invalid Date, выглядя безобидно.
      if (!TIME_REGEX.test(time)) {
        return { ok: false, reason: 'daily: время не в формате HH:MM' }
      }
    }
    // Дубли ломают unique-индекс (medication_id, scheduled_at) при вставке
    // слотов — то же требование, что в zod.
    if (new Set(times).size !== times.length) {
      return { ok: false, reason: 'daily: повторяющиеся времена' }
    }
    // Собираем объект заново, а не `s as Schedule`: приведение было ложью
    // (проверенного типа у s нет), и лишние ключи так же отсекаются, как их
    // отсекает zod.
    return { ok: true, schedule: { kind: 'daily', times: times as string[] } }
  }

  if (s.kind === 'interval') {
    const { every_days: everyDays, time, anchor_date: anchorDate } = s
    // Number.isInteger отсекает и дробные, и Infinity, и NaN — прежняя
    // проверка `typeof === 'number' && >= 1` пропускала Infinity.
    if (typeof everyDays !== 'number' || !Number.isInteger(everyDays)) {
      return { ok: false, reason: 'interval: every_days не целое число' }
    }
    if (everyDays < MIN_EVERY_DAYS || everyDays > MAX_EVERY_DAYS) {
      return {
        ok: false,
        reason: `interval: every_days вне границ ${MIN_EVERY_DAYS}..${MAX_EVERY_DAYS}`,
      }
    }
    if (typeof time !== 'string' || !TIME_REGEX.test(time)) {
      return { ok: false, reason: 'interval: time не в формате HH:MM' }
    }
    if (typeof anchorDate !== 'string' || !DATE_REGEX.test(anchorDate)) {
      return { ok: false, reason: 'interval: anchor_date не в формате YYYY-MM-DD' }
    }
    return {
      ok: true,
      schedule: { kind: 'interval', every_days: everyDays, time, anchor_date: anchorDate },
    }
  }

  return { ok: false, reason: 'kind не daily и не interval' }
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

// Сравнение постоянного времени — как в send-reminders (аудит L3): !== мог бы
// подсказывать перебору длину совпавшего префикса через тайминг.
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const ab = enc.encode(a)
  const bb = enc.encode(b)
  if (ab.length !== bb.length) return false
  let diff = 0
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i]
  return diff === 0
}

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get('CRON_SECRET')
  const given = req.headers.get('x-cron-secret')
  if (!cronSecret || !given || !timingSafeEqual(given, cronSecret)) {
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
  // Отдельно от skippedInvalid: отвергнутое проверкой — ожидаемый случай, а
  // упавшее с исключением значит, что parseSchedule чего-то не предусмотрел.
  // Это сигнал о баге, и смешивать их в одном счётчике нельзя.
  let skippedFailed = 0
  const slots: SlotRow[] = []
  // Для сверки (reconcile) ниже: ожидаемые пары "medication_id|isoUtc" по
  // юзерам. У юзера с битым schedule сверку пропускаем — не зная ожидаемого
  // набора, нельзя решать, что лишнее.
  const expectedByUser = new Map<string, Set<string>>()
  const usersWithInvalid = new Set<string>()

  for (const med of meds) {
    const medId = med.id as string
    const userId = med.user_id as string

    // В логи — id ПРЕПАРАТА и причина, и ничего больше. По нему битый ряд
    // находится запросом, при этом сам schedule, название препарата и user_id
    // в логи Supabase не уходят (privacy-аудит 2026-08-02). Прежний
    // безличный «invalid schedule json» заметить проблему позволял, а найти
    // строку — нет.
    const parsed = parseSchedule(med.schedule)
    if (!parsed.ok) {
      skippedInvalid += 1
      usersWithInvalid.add(userId)
      console.error(`medication ${medId} skipped: ${parsed.reason}`)
      continue
    }
    const timezone = tzByUser.get(userId) ?? 'UTC'

    // Препарат попадает в общий набор ТОЛЬКО целиком: сначала собираем его
    // слоты в локальный буфер, фиксируем после успеха.
    //
    // Почему не писать сразу в slots: при исключении на середине дней в
    // наборе осталась бы половина слотов препарата, и — хуже — половина
    // ожидаемых пар в expectedByUser. Сверка ниже сносит upcoming-слоты,
    // которых в ожидаемом наборе нет, то есть неполный набор означал бы
    // удаление живых слотов. Буфер делает препарат атомарным.
    const medSlots: SlotRow[] = []
    try {
      for (let i = 0; i < DAYS_AHEAD; i += 1) {
        const day = addDays(today, i)
        // Препарат ещё не стартовал в этот день — сравниваем календарные даты
        // в tz юзера (start_date в БД — голая YYYY-MM-DD строка).
        if (formatInTimeZone(day, timezone, 'yyyy-MM-dd') < (med.start_date as string)) {
          continue
        }
        for (const utc of computeSlotsForDay(parsed.schedule, day, timezone)) {
          medSlots.push({
            medication_id: medId,
            user_id: userId,
            scheduled_at: utc.toISOString(),
            status: 'upcoming',
          })
        }
      }
    } catch (e) {
      // Последняя линия: parseSchedule выше уже отбивает всё, что роняло
      // генерацию, но одна неучтённая строка не должна стоить пушей всем
      // остальным. Раньше исключение здесь вылетало из Deno.serve, и терялись
      // даже уже обработанные препараты — slots уходит в upsert только после
      // этого цикла.
      //
      // Только имя класса ошибки: текст сообщения в общем случае может
      // содержать значение, на котором упало, а это данные человека.
      skippedFailed += 1
      usersWithInvalid.add(userId)
      console.error(
        `medication ${medId} failed: ${e instanceof Error ? e.name : 'unknown error'}`,
      )
      continue
    }

    if (medSlots.length === 0) continue

    let expected = expectedByUser.get(userId)
    if (!expected) {
      expected = new Set()
      expectedByUser.set(userId, expected)
    }
    for (const slot of medSlots) {
      slots.push(slot)
      expected.add(`${slot.medication_id}|${slot.scheduled_at}`)
    }
  }

  // --- Сверка: снести upcoming-слоты, не соответствующие расписаниям ---
  // Та же логика и инвариант, что в lib/tracker/slot-generator.ts (см.
  // комментарий там): сироты от смены tz / гонок / старых багов иначе
  // живут вечно — upsert с другим scheduled_at их не перезаписывает.
  // История (не-upcoming статусы) не трогается.
  let deletedStale = 0
  for (const userId of userIds) {
    if (usersWithInvalid.has(userId)) continue
    const timezone = tzByUser.get(userId) ?? 'UTC'
    const windowStart = fromZonedTime(
      `${formatInTimeZone(today, timezone, 'yyyy-MM-dd')}T00:00:00`,
      timezone,
    )
    const windowEnd = fromZonedTime(
      `${formatInTimeZone(addDays(today, DAYS_AHEAD), timezone, 'yyyy-MM-dd')}T00:00:00`,
      timezone,
    )

    const { data: existing, error: existingError } = await supabase
      .from('intake_events')
      .select('id, medication_id, scheduled_at')
      .eq('user_id', userId)
      .eq('status', 'upcoming')
      .gte('scheduled_at', windowStart.toISOString())
      .lt('scheduled_at', windowEnd.toISOString())

    if (existingError) {
      // Первые 8 символов user_id — как в send-reminders: для дебага хватает,
      // полный идентификатор в логи Supabase не утекает (privacy-аудит).
      console.error(`reconcile select failed for ${userRef(userId)}…:`, existingError.message)
      continue
    }

    const expected = expectedByUser.get(userId) ?? new Set<string>()
    // Формат timestamptz от PostgREST нормализуем через Date перед сравнением.
    const staleIds = (existing ?? [])
      .filter(
        (e) =>
          !expected.has(
            `${e.medication_id}|${new Date(e.scheduled_at as string).toISOString()}`,
          ),
      )
      .map((e) => e.id as string)

    if (staleIds.length > 0) {
      const { error: deleteError } = await supabase
        .from('intake_events')
        .delete()
        .in('id', staleIds)
      if (deleteError) {
        console.error(`reconcile delete failed for ${userRef(userId)}…:`, deleteError.message)
        continue
      }
      deletedStale += staleIds.length
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
    deletedStale, // снесённые сироты (несоответствие расписанию/tz)
    skippedInvalid, // отвергнуто проверкой расписания — ожидаемый случай
    skippedFailed, // упало с исключением — > 0 значит баг, надо смотреть
  })
})
