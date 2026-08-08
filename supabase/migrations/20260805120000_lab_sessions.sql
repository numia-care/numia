-- ============================================================================
-- Анализы: сущность «сдача» (lab_sessions) — подшаг 1, только схема
-- ============================================================================
--
-- Зачем: несколько показателей за одну дату — это одна сдача. Дата и фото
-- бланка физически общие (бланк один, на нём сразу все значения), а хранились
-- на каждой строке. Отсюда две болячки: дату приходилось вводить заново на
-- каждый показатель, а бейдж «фото бланка» появлялся только у одного
-- показателя из трёх.
--
-- Что переезжает на сдачу:  measured_at, note_ciphertext,
--                           blank_photo_path, blank_photo_iv
-- Что остаётся на строке:   analyte, analyte_custom_name, value, unit
--
-- Граница шифрования НЕ меняется: note_ciphertext и blank_photo_* остаются
-- E2E, просто переезжают на сдачу. Сервер их по-прежнему прочитать не может —
-- DEK живёт только в памяти вкладки.
--
-- Модель допускает сдачу с фото и НУЛЁМ строк — это будущая замена нынешним
-- записям «только фото бланка» (строка с NULL в analyte/value/unit). Констрейнта
-- «сдача непуста» нет и быть не может: он межтабличный, держим на уровне
-- приложения.
--
-- ----------------------------------------------------------------------------
-- МИГРАЦИЯ ПАРАЛЛЕЛЬНЫМИ КОЛОНКАМИ
-- ----------------------------------------------------------------------------
-- Старые колонки на lab_results ОСТАЮТСЯ живыми и заполненными. Приложение
-- продолжает читать и писать их как раньше — этот файл его не ломает.
-- Снос старых колонок — ОТДЕЛЬНЫЙ подшаг, сильно позже, когда весь код
-- переведён на сдачи. Здесь его НЕТ намеренно.
--
-- ----------------------------------------------------------------------------
-- КАК ПРИМЕНИТЬ (Supabase CLI не настроен — накатываем руками)
-- ----------------------------------------------------------------------------
-- Dashboard → SQL Editor → New query. Плейсхолдеров в файле нет.
-- Шаги 1–4 можно прогнать разом (вставить файл целиком → Run) либо по одному,
-- сверяясь с проверками ниже. Шаг 5 закомментирован — НЕ раскомментировать.
--
--   После шага 1:
--     select count(*) from public.lab_sessions;                     -- ждём 0
--     -- и в Authentication → Policies у lab_sessions должно быть 4 политики
--
--   После шага 3 (бэкфилл):
--     select count(*) from public.lab_results where session_id is null;  -- 0
--     select
--       (select count(*) from public.lab_results)  as строк,
--       (select count(*) from public.lab_sessions) as сдач;
--     -- на этом подшаге числа обязаны СОВПАСТЬ: каждая строка получила
--     -- собственную сдачу, группировка появится позже, при вводе через
--     -- новую форму
--
--   После шага 4:
--     -- проверить, что добавление анализа в приложении по-прежнему работает
--
-- Идемпотентность: шаги 1–2 защищены (if not exists), бэкфилл фильтрует по
-- session_id is null, поэтому повторный прогон файла безопасен и ничего не
-- задвоит.
--
-- Откат (пока шаг 5 не выполнен — полный, без потери данных):
--   drop policy if exists "lab_results_insert_own" on public.lab_results;
--   create policy "lab_results_insert_own" on public.lab_results
--     for insert with check (user_id = auth.uid());
--   alter table public.lab_results drop column if exists session_id;
--   drop table if exists public.lab_sessions;
-- Данные не пострадают: всё оригинальное лежит в старых колонках lab_results.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- ШАГ 1. Таблица сдач
-- ----------------------------------------------------------------------------

create table if not exists public.lab_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Календарная дата сдачи. NULL = «дата не указана» — гибкий ввод, как в
  -- lab_results после миграции 20260723120000: не помнит — не заставляем.
  measured_at date,

  -- E2E-заметка, ОБЩАЯ на сдачу. base64(iv‖ct) из encryptText (IV упакован
  -- внутрь). Сервер не читает.
  note_ciphertext text,

  -- E2E-фото бланка, ОДНО на сдачу: путь к шифроблобу в бакете path-media
  -- плюс его IV. Бакет и его storage-политики уже существуют (миграция
  -- «Пути» 20260622120000), новых прав не требуется — путь по-прежнему
  -- вида {user_id}/…, а политики path_media_* смотрят первый сегмент.
  blank_photo_path text,
  blank_photo_iv text,

  created_at timestamptz not null default now(),

  -- Путь и IV ходят парой: либо оба заданы, либо оба NULL. Тот же инвариант,
  -- что у blank_photo_path_iv_together в lab_results.
  constraint lab_sessions_photo_path_iv_together
    check ((blank_photo_path is null) = (blank_photo_iv is null))
);

-- Лента сдач: свои, новые сверху. nulls last — сдачи без даты в конце, как
-- это делает listLabResults для строк без measured_at.
create index if not exists idx_lab_sessions_user_date
  on public.lab_sessions (user_id, measured_at desc nulls last);

alter table public.lab_sessions enable row level security;

drop policy if exists "lab_sessions_select_own" on public.lab_sessions;
create policy "lab_sessions_select_own"
  on public.lab_sessions for select
  using (user_id = auth.uid());

drop policy if exists "lab_sessions_insert_own" on public.lab_sessions;
create policy "lab_sessions_insert_own"
  on public.lab_sessions for insert
  with check (user_id = auth.uid());

drop policy if exists "lab_sessions_update_own" on public.lab_sessions;
create policy "lab_sessions_update_own"
  on public.lab_sessions for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "lab_sessions_delete_own" on public.lab_sessions;
create policy "lab_sessions_delete_own"
  on public.lab_sessions for delete
  using (user_id = auth.uid());


-- ----------------------------------------------------------------------------
-- ШАГ 2. Ссылка со строк на сдачу
-- ----------------------------------------------------------------------------
-- on delete cascade: удалили сдачу — ушли её показатели. ОБРАТНОЕ НЕ ВЕРНО:
-- удаление одного показателя сдачу не трогает, иначе у соседей пропали бы
-- общая дата и бланк. Оркестрация удаления — на клиенте (lib/labs/records.ts),
-- потому что снести объект Storage из Postgres нельзя.
--
-- Колонка пока NULLABLE — см. ШАГ 5 и объяснение там.

alter table public.lab_results
  add column if not exists session_id uuid
  references public.lab_sessions(id) on delete cascade;

-- Postgres не индексирует ссылающуюся сторону внешнего ключа сам. Индекс нужен
-- двум запросам: каскадному удалению сдачи и подсчёту «остались ли ещё
-- показатели у этой сдачи» перед удалением пустой.
create index if not exists idx_lab_results_session
  on public.lab_results (session_id);


-- ----------------------------------------------------------------------------
-- ШАГ 3. Бэкфилл: каждая существующая строка → собственная сдача
-- ----------------------------------------------------------------------------
-- Дата, заметка и фото КОПИРУЮТСЯ наверх, из lab_results не удаляются:
-- миграция параллельными колонками, оригиналы остаются источником правды,
-- пока код не переведён.
--
-- Одним стейтментом, чтобы не было промежуточного состояния: упадёт — не
-- изменится ничего.
--
-- ПРО materialized — это здесь не украшение. CTE mapping читается дважды
-- (вставкой сдач и апдейтом строк), и внутри него gen_random_uuid(). Без
-- явного materialized планировщик вправе заинлайнить CTE и вычислить uuid
-- ЗАНОВО для каждой ссылки — тогда в сдачи уедут одни идентификаторы, а в
-- session_id строк другие, и связь развалится молча. Volatile-функция такое
-- инлайнирование и так запрещает, но полагаться на это в необратимой
-- миграции не стоит.

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


-- ----------------------------------------------------------------------------
-- ШАГ 4. Закрыть дыру в политике вставки
-- ----------------------------------------------------------------------------
-- Было: with check (user_id = auth.uid()) — проверяется только владение самой
-- строкой, но НЕ то, что session_id указывает на твою сдачу. Подделанный
-- запрос мог бы прицепить свою строку к чужой сдаче. Прочитать чужое это не
-- давало (SELECT фильтрует по user_id), но мусорить в чужие данные позволяло.
--
-- Ветка «session_id is null» здесь ОБЯЗАТЕЛЬНА на этом подшаге: приложение
-- пока не знает про сдачи и вставляет строки без session_id. Без неё каждое
-- добавление анализа немедленно отбивалось бы политикой. Ветка уйдёт вместе
-- с шагом 5, когда код начнёт писать session_id всегда.

drop policy if exists "lab_results_insert_own" on public.lab_results;
create policy "lab_results_insert_own"
  on public.lab_results for insert
  with check (
    user_id = auth.uid()
    and (
      session_id is null
      or exists (
        select 1 from public.lab_sessions s
        where s.id = session_id and s.user_id = auth.uid()
      )
    )
  );

-- Тем же условием закрываем UPDATE: иначе строку можно было бы перецепить на
-- чужую сдачу уже после вставки.
drop policy if exists "lab_results_update_own" on public.lab_results;
create policy "lab_results_update_own"
  on public.lab_results for update
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (
      session_id is null
      or exists (
        select 1 from public.lab_sessions s
        where s.id = session_id and s.user_id = auth.uid()
      )
    )
  );


-- ============================================================================
-- ШАГИ 5 и 6 — ЗДЕСЬ ИХ БОЛЬШЕ НЕТ, ПЕРЕЕХАЛИ В ОТДЕЛЬНЫЕ ФАЙЛЫ
-- ============================================================================
-- Пока код писал строки без session_id, оба шага были неисполнимы, и лежали
-- тут закомментированными. Код переведён на сдачи (подшаги 2–6), и они
-- выделены в свои файлы — чтобы каждый катился отдельно, со своей шапкой,
-- своими проверками до/после и явной пометкой обратим/необратим:
--
--   20260808120000_lab_results_drop_placeholder_rows.sql   (A) снос
--       строк-полупустышек «только фото» — они были нужны, пока читатели
--       ходили в lab_results, теперь мусор. Обязателен перед C.
--
--   20260808130000_lab_results_session_id_not_null.sql     (B) бывший ШАГ 5:
--       session_id NOT NULL + строгие политики без ветки «session_id is null».
--       ОБРАТИМ, откат в конце того файла.
--
--   20260808140000_lab_results_drop_legacy_columns.sql     (C) бывший ШАГ 6:
--       снос measured_at / note_ciphertext / blank_photo_path / blank_photo_iv
--       и трёх устаревших CHECK'ов. ⚠️ НЕОБРАТИМО, отката нет.
--
-- Порядок строгий: A → проверка → B → проверка → C.
-- ============================================================================
