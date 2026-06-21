// ============================================================================
// Edge Function: send-reminders — отправка push-напоминаний по расписанию
// ============================================================================
//
// Запускается pg_cron'ом каждые 5 минут (см. миграцию etap1b_cron_jobs).
// Это Deno-код, НЕ Next.js — деплоится в Supabase отдельно от Vercel
// (инструкция в supabase/functions/DEPLOY.md). Импорты через npm:-префикс —
// так Deno подтягивает npm-пакеты без package.json.
//
// Что делает за один запуск:
//   1. Находит intake_events: status='upcoming', notified_at IS NULL,
//      scheduled_at < now+5min (и не старше 15 минут — давние слоты не пушим,
//      см. комментарий у LOOKBACK ниже).
//   2. Для каждого юзера с такими событиями — шлёт push на все его устройства
//      (push_subscriptions). Один пуш на устройство за запуск, даже если
//      слотов несколько — service worker всё равно схлопывает по tag.
//   3. Подписки, на которые push-сервис ответил 404/410 (юзер отозвал
//      разрешение / переустановил PWA) — удаляет из БД.
//   4. Помечает обработанные события notified_at=now() — защита от дублей
//      и потерь на границах окон (см. миграцию etap1b_notified_at).
//
// Текст пуша задаёт service worker на устройстве («напоминание ✦» / «пора»),
// payload отсюда содержит только tag и url — НИКАКОЙ конкретики о препаратах.
// Модель угроз CLAUDE.md: текст пуша никогда не содержит деталей.
//
// Секреты (Dashboard → Edge Functions → Secrets):
//   CRON_SECRET       — общий секрет с pg_cron-джобом, гейт на вызов
//   VAPID_PUBLIC_KEY  — тот же что NEXT_PUBLIC_VAPID_PUBLIC_KEY на Vercel
//   VAPID_PRIVATE_KEY — приватный ключ пары (ТОЛЬКО здесь, никогда в клиенте)
//   VAPID_SUBJECT     — контакт для push-сервисов, 'mailto:...' или https-URL
// SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY Supabase подставляет сам.
// service_role обходит RLS — это норма для cron'а, но потому ключ живёт
// только в env функции.

import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

// Насколько вперёд смотрим. 15 минут, чтобы напоминание приходило ЗА ~10-15
// минут до приёма, а не в момент. При cron'е раз в 5 минут слот ловится на
// первом тике, попавшем в окно: слот 16:40 поймается тиком 16:30 (16:40 <
// 16:30+15) → пуш за 10 минут. notified_at гарантирует, что следующие тики
// (16:35, 16:40) тот же слот повторно не отправят.
const WINDOW_AHEAD_MS = 15 * 60_000
// Насколько назад: страховка если предыдущие запуски упали. Не больше 15
// минут — напоминание через полчаса после слота уже не помощь, а шум.
// Заодно отсекает «вчерашние» upcoming-слоты, созданные on-demand генерацией
// при открытии трекера (они вставляются задним числом для backfill-UI).
const LOOKBACK_MS = 15 * 60_000

Deno.serve(async (req) => {
  // Функция задеплоена с verify_jwt=off (вызывает её pg_cron, а не юзер),
  // поэтому свой гейт: без правильного секрета — отказ.
  const cronSecret = Deno.env.get('CRON_SECRET')
  if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
    return new Response('forbidden', { status: 403 })
  }

  webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT')!,
    Deno.env.get('VAPID_PUBLIC_KEY')!,
    Deno.env.get('VAPID_PRIVATE_KEY')!,
  )

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

  const now = Date.now()

  const { data: events, error: eventsError } = await supabase
    .from('intake_events')
    .select('id, user_id')
    .eq('status', 'upcoming')
    .is('notified_at', null)
    .gte('scheduled_at', new Date(now - LOOKBACK_MS).toISOString())
    .lt('scheduled_at', new Date(now + WINDOW_AHEAD_MS).toISOString())

  if (eventsError) {
    console.error('intake_events query failed:', eventsError.message)
    return Response.json({ error: eventsError.message }, { status: 500 })
  }

  if (!events || events.length === 0) {
    return Response.json({ events: 0, sent: 0 })
  }

  const userIds = [...new Set(events.map((e) => e.user_id as string))]

  const { data: subs, error: subsError } = await supabase
    .from('push_subscriptions')
    .select('id, user_id, endpoint, p256dh, auth')
    .in('user_id', userIds)

  if (subsError) {
    console.error('push_subscriptions query failed:', subsError.message)
    return Response.json({ error: subsError.message }, { status: 500 })
  }

  let sent = 0
  let failed = 0
  const deadSubIds: string[] = []

  // SW игнорирует всё кроме tag/url — текст уведомления он подставляет сам.
  const payload = JSON.stringify({ tag: 'numia-reminder', url: '/tracker' })

  await Promise.allSettled(
    (subs ?? []).map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint as string,
            keys: { p256dh: sub.p256dh as string, auth: sub.auth as string },
          },
          payload,
          // TTL: если устройство офлайн дольше часа — пуш протухает на
          // push-сервисе и не приходит. Напоминалка с опозданием в часы
          // бесполезна и звенит в неудачный момент.
          { TTL: 3600, urgency: 'high' },
        )
        sent += 1
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) {
          // Подписка мертва: юзер отозвал разрешение или переустановил PWA.
          deadSubIds.push(sub.id as string)
        } else {
          failed += 1
          console.error(`push to ${sub.user_id} failed with ${status}:`, err)
        }
      }
    }),
  )

  if (deadSubIds.length > 0) {
    const { error } = await supabase
      .from('push_subscriptions')
      .delete()
      .in('id', deadSubIds)
    if (error) console.error('dead subscriptions cleanup failed:', error.message)
  }

  // Помечаем обработанными ВСЕ события окна, включая юзеров без подписок и
  // неудачные отправки. Пуши — best-effort: ретраить частичные фейлы значит
  // спамить устройства, которые уже получили своё.
  const { error: markError } = await supabase
    .from('intake_events')
    .update({ notified_at: new Date(now).toISOString() })
    .in('id', events.map((e) => e.id as string))

  if (markError) {
    console.error('notified_at update failed:', markError.message)
    return Response.json({ error: markError.message }, { status: 500 })
  }

  return Response.json({
    events: events.length,
    users: userIds.length,
    sent,
    failed,
    removedSubscriptions: deadSubIds.length,
  })
})
