-- ============================================================================
-- Анализы: догоняющий бэкфилл сдач для строк без session_id
-- ============================================================================
--
-- Зачем: между бэкфиллом подшага 1 (миграция 20260805120000) и деплоем
-- двойной записи (c82f676) существовало окно, в котором старый код ещё
-- вставлял строки БЕЗ session_id. В это окно попала одна запись
-- (без даты,
-- заметки и фото). Запрос написан общим — если сирот окажется больше, он
-- разберёт все.
--
-- Окно закрыто и заново не откроется: задеплоенный addLabResult создаёт сдачу
-- и пишет session_id всегда, а других вставок в lab_results в коде нет.
--
-- Логика — копия ШАГА 3 миграции 20260805120000, включая приём с
-- materialized CTE. Он здесь не украшение: CTE читается дважды (вставкой
-- сдач и апдейтом строк), и внутри него gen_random_uuid(). Без явного
-- materialized планировщик вправе заинлайнить CTE и вычислить uuid ЗАНОВО
-- для каждой ссылки — тогда в сдачи уедут одни идентификаторы, а в session_id
-- строк другие, и связь развалится молча. Volatile-функция такое
-- инлайнирование и так запрещает, но полагаться на это не стоит.
--
-- Дата, заметка и фото КОПИРУЮТСЯ наверх, из lab_results не удаляются:
-- миграция параллельными колонками продолжается, старые колонки остаются
-- источником правды для читателей до подшага 6.
--
-- ----------------------------------------------------------------------------
-- КАК ПРИМЕНИТЬ (Supabase CLI не настроен — накатываем руками)
-- ----------------------------------------------------------------------------
-- Dashboard → SQL Editor → New query → вставить файл целиком → Run.
-- Плейсхолдеров нет.
--
-- ДО применения (сколько сирот):
--   select count(*) from public.lab_results where session_id is null;
--
-- ПОСЛЕ применения:
--   select count(*) from public.lab_results where session_id is null;   -- 0
--   select
--     (select count(*) from public.lab_results)  as строк,
--     (select count(*) from public.lab_sessions) as сдач;
--   -- связь пока один-к-одному, числа обязаны совпасть
--
-- Идемпотентно: фильтр session_id is null. Повторный прогон найдёт ноль строк,
-- ничего не создаст и не задвоит.
--
-- Откат (пока старые колонки на месте — полный, без потери данных):
--   -- найти сдачи, созданные этим прогоном, можно по отсутствию у них
--   -- «своих» данных сложно, поэтому проще откатывать точечно:
--   --   update public.lab_results set session_id = null where id = '<uuid>';
--   --   delete from public.lab_sessions where id = '<uuid сдачи>';
--   -- Оригинальные значения при этом целы: они лежат в старых колонках
--   -- lab_results, наверх они только скопированы.
--
-- ПОСЛЕ ЭТОГО открывается ШАГ 5 миграции 20260805120000 (session_id NOT NULL
-- и снятие ветки «session_id is null» из политик) — инвариант «у каждой
-- строки есть сдача» станет истинным и подкреплённым проверкой выше.
-- ============================================================================

with mapping as materialized (
  select
    id as result_id,
    gen_random_uuid() as new_session_id,
    user_id,
    measured_at,
    note_ciphertext,
    blank_photo_path,
    blank_photo_iv,
    created_at
  from public.lab_results
  where session_id is null
),
inserted as (
  -- Data-modifying CTE выполняется, даже если на неё никто не ссылается.
  insert into public.lab_sessions
    (id, user_id, measured_at, note_ciphertext, blank_photo_path, blank_photo_iv, created_at)
  select
    new_session_id, user_id, measured_at, note_ciphertext,
    blank_photo_path, blank_photo_iv, created_at
  from mapping
  returning id
)
update public.lab_results r
set session_id = m.new_session_id
from mapping m
where r.id = m.result_id;
