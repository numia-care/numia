-- ============================================================================
-- Этап 1b: push_subscriptions — Web Push подписки юзеров
-- ============================================================================
--
-- Один юзер может иметь несколько подписок (телефон + ноут + PWA на iOS).
-- Endpoint уникален per push-service (FCM/APNs/Mozilla), его и используем как
-- естественный ключ дедупликации — повторная подписка с того же устройства
-- придёт с тем же endpoint, мы это ловим через UNIQUE.
--
-- Как применить:
-- Supabase Dashboard → SQL Editor → New query → вставить → Run.
-- ============================================================================

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Endpoint URL push-сервиса. У FCM выглядит как https://fcm.googleapis.com/...,
  -- у Mozilla как https://updates.push.services.mozilla.com/...
  endpoint text not null,
  -- p256dh public key (base64url) — нужен серверу при шифровании payload
  p256dh text not null,
  -- auth secret (base64url) — тоже для шифрования
  auth text not null,

  -- User-Agent с устройства, чтобы в /settings показать "iPhone PWA" или
  -- "Chrome on Mac" и юзер мог отозвать подписку с конкретного устройства.
  -- Не используется для отправки — только для UI.
  user_agent text,

  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- Дедупликация: одна подписка на endpoint. При re-subscribe upsert по endpoint.
create unique index idx_push_subscriptions_endpoint_uniq
  on public.push_subscriptions (endpoint);

-- Главный запрос cron: "все активные подписки юзера" → отправить push.
create index idx_push_subscriptions_user
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

create policy "push_subscriptions_select_own"
  on public.push_subscriptions for select
  using (user_id = auth.uid());

create policy "push_subscriptions_insert_own"
  on public.push_subscriptions for insert
  with check (user_id = auth.uid());

create policy "push_subscriptions_update_own"
  on public.push_subscriptions for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "push_subscriptions_delete_own"
  on public.push_subscriptions for delete
  using (user_id = auth.uid());

-- GRANT для роли authenticated (как и для остальных таблиц трекера —
-- raw SQL не выдаёт привилегии автоматически, нужен явный GRANT).
grant select, insert, update, delete on public.push_subscriptions to authenticated;
