-- ============================================================================
-- Этап 1b шаг 2: cron-джобы для Edge Functions (send-reminders, generate-upcoming)
-- ============================================================================
--
-- ⚠️ НЕ запускать как есть — сначала:
--   1. Задеплоить обе Edge Functions (см. supabase/functions/DEPLOY.md)
--   2. Заменить два плейсхолдера НИЖЕ ПРЯМО В SQL EDITOR (не в этом файле,
--      чтобы секрет не попал в git):
--        __PROJECT_REF__  — ref проекта из URL дашборда (abcdefgh из
--                           https://supabase.com/dashboard/project/abcdefgh)
--        __CRON_SECRET__  — тот же секрет, что положен в env функций.
--
-- Схема: pg_cron по расписанию выполняет SQL, который через pg_net шлёт
-- HTTP POST на Edge Function. Заголовок x-cron-secret — гейт: функции
-- задеплоены с verify_jwt=off, и кроме обладателя секрета их никто не
-- дёрнет. Секреты лежат в Supabase Vault (шифрованное хранилище в БД),
-- в теле cron-джоба — только select из vault, не сам секрет.
--
-- Как применить:
-- Supabase Dashboard → SQL Editor → вставить → заменить плейсхолдеры → Run.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Расширения (no-op если уже включены через Dashboard → Database → Extensions)
-- ----------------------------------------------------------------------------

create extension if not exists pg_cron;
create extension if not exists pg_net;


-- ----------------------------------------------------------------------------
-- 2. Секреты в Vault
-- ----------------------------------------------------------------------------
-- Vault шифрует значения; vault.decrypted_secrets доступна только
-- привилегированным ролям (postgres/cron), не authenticated-юзерам.

select vault.create_secret(
  'https://__PROJECT_REF__.supabase.co/functions/v1',
  'edge_functions_base_url'
);

select vault.create_secret(
  '__CRON_SECRET__',
  'cron_secret'
);


-- ----------------------------------------------------------------------------
-- 3. send-reminders — каждые 5 минут
-- ----------------------------------------------------------------------------
-- net.http_post асинхронный: pg_cron только ставит запрос в очередь pg_net.
-- Ответы функции смотреть либо в net._http_response (хранится ~6 часов),
-- либо в логах Edge Function в дашборде.

select cron.schedule(
  'send-reminders-every-5-min',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets
            where name = 'edge_functions_base_url') || '/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                        where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);


-- ----------------------------------------------------------------------------
-- 4. generate-upcoming — раз в сутки в 00:30 UTC
-- ----------------------------------------------------------------------------
-- 00:30 UTC, а не 00:00 — чтобы не толкаться с чужими полуночными джобами
-- на shared-инфраструктуре. Генерим на 3 календарных дня вперёд, так что
-- суточный цикл даёт двойной запас: даже пропуск одного запуска не оставит
-- юзеров без слотов (а значит и без пушей).

select cron.schedule(
  'generate-upcoming-daily',
  '30 0 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets
            where name = 'edge_functions_base_url') || '/generate-upcoming',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                        where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);


-- ----------------------------------------------------------------------------
-- Полезное на потом (не запускать сейчас):
--
-- посмотреть джобы:        select jobid, jobname, schedule from cron.job;
-- история запусков:        select * from cron.job_run_details
--                          order by start_time desc limit 20;
-- ответы edge functions:   select status_code, content, created
--                          from net._http_response
--                          order by created desc limit 20;
-- снять джоб:              select cron.unschedule('send-reminders-every-5-min');
-- ----------------------------------------------------------------------------
