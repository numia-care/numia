-- ============================================================================
-- Фикс: GRANT для роли service_role на таблицы трекера и push-подписок.
--
-- Та же история, что в 20260526_grant_authenticated: таблицы созданы raw SQL,
-- который не выдаёт привилегии ролям автоматически. Тогда починили только
-- authenticated; Edge Functions (cron) ходят под service_role — и падают
-- с "permission denied for table medications".
--
-- Обход RLS и привилегии на таблицу — независимые механизмы: service_role
-- не фильтруется политиками RLS, но без GRANT не может даже открыть таблицу.
--
-- Выдаём полный CRUD на все четыре таблицы разом (а не минимум под текущие
-- функции): service_role — наша же серверная роль, сужать её привилегии
-- по-таблично смысла нет, а каждый новый cron-сценарий не должен требовать
-- новой GRANT-миграции.
--
-- Как применить:
-- Supabase Dashboard → SQL Editor → New query → вставить → Run.
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.medications TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.intake_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO service_role;
