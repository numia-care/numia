-- ============================================================================
-- public.delete_my_account() — удаление своего аккаунта без service_role
-- ============================================================================
--
-- Нужно для DELETE /api/v1/me (App Store 5.1.1(v): приложение с регистрацией
-- обязано давать удалить аккаунт изнутри).
--
-- Почему функция, а не admin API с service_role. service_role обходит RLS
-- целиком: ключ, которым можно удалить одного пользователя, читает и базу всех
-- остальных. BFF на время разработки стоит на домашнем сервере, и держать там
-- такой ключ ради одной операции — ровно та утечка, от которой строилась
-- архитектура (CLAUDE.md, «Безопасность»; lib/supabase/bff.ts).
--
-- Функция security definer, но удалить может ТОЛЬКО вызывающего: id берётся из
-- auth.uid(), то есть из проверенного токена, аргументов у неё нет. Права у неё
-- не шире, чем у самого пользователя над своими данными.
--
-- Что удаляется. Строка auth.users, а от неё каскадом (on delete cascade во
-- всех миграциях с user_id): profiles, medications, intake_events,
-- push_subscriptions, path_entries, lab_sessions, lab_results, lab_ranges.
-- Сессии и refresh-токены удаляются каскадом внутри схемы auth — все
-- устройства разлогиниваются.
--
-- Что НЕ удаляется: файлы в Storage. Supabase запрещает удалять
-- storage.objects напрямую SQL (триггер protect_objects_delete), файлы надо
-- удалять через Storage API. Это делает BFF токеном пользователя ДО вызова
-- функции: после удаления аккаунта токена уже нет, и осиротевшие файлы стало бы
-- нечем удалить.
-- ============================================================================

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  delete from auth.users where id = uid;
end;
$$;

-- По умолчанию EXECUTE есть у PUBLIC, то есть и у anon. Оставляем только
-- залогиненным: без токена auth.uid() всё равно null, но лишняя поверхность
-- не нужна.
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
