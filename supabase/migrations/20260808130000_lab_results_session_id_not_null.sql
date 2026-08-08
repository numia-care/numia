-- ============================================================================
-- Анализы, уборка B: session_id обязателен + строгие политики
-- ============================================================================
--
-- ЭТО ВТОРОЙ ИЗ ТРЁХ ФАЙЛОВ УБОРКИ. Порядок обязателен:
--   A — 20260808120000: снос полупустышек
--   B (этот) — session_id NOT NULL + строгие политики
--   C — 20260808140000: снос старых колонок  ← НЕОБРАТИМО
--
-- Это тот самый ШАГ 5, который лежал закомментированным в миграции
-- 20260805120000. Он не мог быть выполнен тогда: код ещё вставлял строки без
-- session_id, и NOT NULL уронил бы добавление анализа в ту же секунду. С
-- подшага 2 единственный путь создания строк (addLabSession, ныне и
-- updateLabSession) пишет session_id всегда, а существующие строки получили
-- сдачи бэкфиллом.
--
-- ----------------------------------------------------------------------------
-- Что меняется
-- ----------------------------------------------------------------------------
-- 1. session_id становится NOT NULL — строка без сдачи больше невозможна.
-- 2. Из политик INSERT и UPDATE уходит ветка «session_id is null».
--    Она стояла там временно: пока код мог вставить строку без сдачи, без
--    этой ветки политика отбивала бы такую вставку. Теперь строк без сдачи
--    не бывает, и ветка только ослабляет проверку.
--    Смысл самой проверки прежний: строка обязана ссылаться на ТВОЮ сдачу,
--    иначе подделанный запрос мог бы прицепить её к чужой.
--
-- ----------------------------------------------------------------------------
-- ОБРАТИМО. Откат в конце файла — снять NOT NULL и вернуть мягкие политики.
-- Данные при этом не страдают вовсе: ни строки, ни колонки не удаляются.
-- ----------------------------------------------------------------------------
--
-- ----------------------------------------------------------------------------
-- КАК ПРИМЕНИТЬ (Supabase CLI не настроен — накатываем руками)
-- ----------------------------------------------------------------------------
-- Dashboard → SQL Editor → New query → вставить файл целиком → Run.
-- Плейсхолдеров нет. Файл A должен быть применён раньше.
--
-- ДО применения:
--   select count(*) from public.lab_results where session_id is null;  -- 0
--   -- если НЕ ноль — остановись: SET NOT NULL упадёт. Догоняющий бэкфилл
--   -- лежит в 20260807130000, прогони его сначала.
--
-- ПОСЛЕ применения:
--   -- колонка обязательна
--   select is_nullable from information_schema.columns
--   where table_schema = 'public' and table_name = 'lab_results'
--     and column_name = 'session_id';
--   -- ждём NO
--
--   -- политики на месте (4 штуки на lab_results)
--   select policyname, cmd from pg_policies
--   where schemaname = 'public' and tablename = 'lab_results'
--   order by policyname;
--
-- И обязательно проверить в приложении, что добавление и правка анализа
-- работают: политики трогают именно эти пути.
--
-- Идемпотентно: SET NOT NULL на уже обязательной колонке — no-op, политики
-- пересоздаются через drop if exists.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Ссылка на сдачу обязательна
-- ----------------------------------------------------------------------------

alter table public.lab_results alter column session_id set not null;


-- ----------------------------------------------------------------------------
-- 2. Строгие политики: строка обязана ссылаться на СВОЮ сдачу
-- ----------------------------------------------------------------------------

drop policy if exists "lab_results_insert_own" on public.lab_results;
create policy "lab_results_insert_own"
  on public.lab_results for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.lab_sessions s
      where s.id = session_id and s.user_id = auth.uid()
    )
  );

-- То же на UPDATE: иначе строку можно было бы перецепить на чужую сдачу уже
-- после вставки.
drop policy if exists "lab_results_update_own" on public.lab_results;
create policy "lab_results_update_own"
  on public.lab_results for update
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.lab_sessions s
      where s.id = session_id and s.user_id = auth.uid()
    )
  );


-- ============================================================================
-- ОТКАТ (не запускать без нужды)
-- ============================================================================
-- alter table public.lab_results alter column session_id drop not null;
--
-- drop policy if exists "lab_results_insert_own" on public.lab_results;
-- create policy "lab_results_insert_own"
--   on public.lab_results for insert
--   with check (
--     user_id = auth.uid()
--     and (
--       session_id is null
--       or exists (
--         select 1 from public.lab_sessions s
--         where s.id = session_id and s.user_id = auth.uid()
--       )
--     )
--   );
--
-- drop policy if exists "lab_results_update_own" on public.lab_results;
-- create policy "lab_results_update_own"
--   on public.lab_results for update
--   using (user_id = auth.uid())
--   with check (
--     user_id = auth.uid()
--     and (
--       session_id is null
--       or exists (
--         select 1 from public.lab_sessions s
--         where s.id = session_id and s.user_id = auth.uid()
--       )
--     )
--   );
-- ============================================================================
