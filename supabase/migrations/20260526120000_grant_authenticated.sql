-- ============================================================================
-- Фикс: GRANT для роли authenticated на таблицы трекера.
--
-- Миграция 20260519 создала таблицы + RLS-политики, но не выдала
-- привилегии ролям. В Supabase Table Editor это делается автоматически,
-- но при raw SQL — нет. Без GRANT роль authenticated не может даже
-- обратиться к таблице, и INSERT падает с "permission denied".
--
-- Как применить:
-- Supabase Dashboard → SQL Editor → New query → вставить → Run.
-- ============================================================================

-- profiles: SELECT/INSERT/UPDATE (DELETE cascade через auth.users)
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;

-- medications: полный CRUD (soft-delete через UPDATE, но DELETE тоже нужен
-- на случай hard-delete в будущем)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.medications TO authenticated;

-- intake_events: полный CRUD
GRANT SELECT, INSERT, UPDATE, DELETE ON public.intake_events TO authenticated;

-- anon-роли доступ не нужен — все эндпоинты за auth.
-- Если понадобится (например, публичная вики) — добавим отдельно.
