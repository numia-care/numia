-- ============================================================================
-- Этап 1a: трекер ЗГТ — таблицы и RLS
-- ============================================================================
--
-- Privacy-модель этого этапа зафиксирована в CLAUDE.md ("Уровни шифрования"):
-- данные в Postgres под RLS, без E2E. Сознательный компромисс ради фич
-- (напоминалки, статистика, графики требуют чтения данных сервером).
-- Поля `notes` в medications/intake_events — кандидаты на E2E в v2.
--
-- Как применить (пока нет Supabase CLI):
-- Supabase Dashboard → SQL Editor → New query → вставить весь файл → Run.
-- Проверить что 3 таблицы созданы (profiles, medications, intake_events)
-- и RLS включён на каждой (Authentication → Policies).
--
-- Идемпотентность: файл написан так, чтобы повторный запуск падал на CREATE
-- (а не молча перезаписывал). Если нужно перенакатить — сначала DROP в обратном
-- порядке (intake_events → medications → profiles → trigger → function).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. profiles — per-user настройки, не вписывающиеся в auth.users
-- ----------------------------------------------------------------------------
-- Этап 1a: только timezone (нужна для корректного отображения и расчёта
-- расписаний ЗГТ — wall-clock время в локали юзера).
-- Этап 2+: сюда же ляжет соль для деривации E2E-ключа и pbkdf2-параметры.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  -- IANA timezone, например 'Europe/Madrid'. UTC как безопасный дефолт,
  -- frontend перезапишет на реальную через Intl.DateTimeFormat при первом входе.
  timezone text not null default 'UTC',
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own"
  on public.profiles for select
  using (id = auth.uid());

create policy "profiles_insert_own"
  on public.profiles for insert
  with check (id = auth.uid());

create policy "profiles_update_own"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- Триггер: при создании юзера в auth.users — создаём профиль.
-- security definer нужен потому что вставка идёт от имени анонимного
-- пользователя в момент signup (до того как auth-сессия установилась).
-- search_path = public защищает от search-path injection.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ----------------------------------------------------------------------------
-- 2. medications — препарат с расписанием
-- ----------------------------------------------------------------------------
-- Один препарат = одно правило расписания. Если юзер хочет принимать два
-- препарата с разными расписаниями — два ряда medications.
--
-- end_date IS NULL = активный препарат. Деактивация (стоп терапии или замена
-- на аналог) — установка end_date, ряд остаётся для истории.

create table public.medications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Свободный ввод, не enum. Юзер пишет "Эстрадиол валерат" или своё.
  -- На UI — autocomplete из захардкоженного списка популярных МТФ/ФТМ
  -- препаратов (этап 5 вики заменит на динамический).
  name text not null,

  -- Клиническая категория, нейтральные термины (см. CLAUDE.md).
  -- 'progesterone' включает синтетические прогестины — UI этой
  -- детализации не показывает.
  kind text not null check (kind in (
    'estrogen', 'antiandrogen', 'progesterone', 'testosterone', 'other'
  )),

  -- Форма выпуска — важно для частоты расписания и UX-копи
  -- ("выпей таблетку" vs "поставь укол").
  form text not null check (form in (
    'tablet', 'capsule', 'injection', 'gel', 'patch', 'drops', 'spray', 'other'
  )),

  dose_amount numeric not null check (dose_amount > 0),
  dose_unit text not null check (dose_unit in (
    'mg', 'mcg', 'ml', 'iu', 'drop', 'puff'
  )),

  -- Расписание как JSON. На v1 поддерживаем два формата:
  --   {"kind":"daily", "times": ["09:00", "21:00"]}
  --   {"kind":"interval", "every_days": 5, "time": "10:00", "anchor_date": "2026-05-19"}
  -- Времена — wall-clock в profiles.timezone юзера.
  -- "specific weekdays" (только по пн/чт) — не на v1, добавим если попросят.
  schedule jsonb not null,

  start_date date not null,
  -- end_date: терапия остановлена осознанно, но ряд видим в истории.
  end_date date,
  -- deleted_at: soft-delete (юзер убрал препарат из UI). История intake_events
  -- сохраняется отдельно (medication_id может стать orphan через SET NULL).
  -- Restore — флипом deleted_at обратно в NULL (UI пока не реализован).
  deleted_at timestamptz,

  -- Заметки юзера (контекст, побочки, замечания врача).
  -- КАНДИДАТ НА E2E v2 — если юзер пишет здесь личное ("приняла перед
  -- свиданием", "после ссоры с мамой") — это чувствительнее структурных данных.
  notes text,

  created_at timestamptz not null default now()
);

-- Частый запрос: "что принимать прямо сейчас" → активные = ни stopped (end_date),
-- ни soft-deleted (deleted_at). Partial index покрывает обе колонки.
create index idx_medications_user_active
  on public.medications (user_id)
  where end_date is null and deleted_at is null;

alter table public.medications enable row level security;

create policy "medications_select_own"
  on public.medications for select
  using (user_id = auth.uid());

create policy "medications_insert_own"
  on public.medications for insert
  with check (user_id = auth.uid());

create policy "medications_update_own"
  on public.medications for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "medications_delete_own"
  on public.medications for delete
  using (user_id = auth.uid());


-- ----------------------------------------------------------------------------
-- 3. intake_events — фактические/плановые приёмы препарата
-- ----------------------------------------------------------------------------
-- Один ряд = один слот в расписании. Слоты на ближайшие N дней генерирует
-- фоновый процесс (этап 1b — Edge Function) или клиент при открытии трекера
-- (для 1a достаточно on-demand генерации в server action).
--
-- Жизненный цикл одного слота:
--   1. INSERT со status='upcoming', scheduled_at в будущем
--   2. Время настало → если до клика юзером прошло долго, фон помечает 'missed'
--   3. Юзер тапнул "Принято" → UPDATE status='taken', taken_at=now()
--      Юзер тапнул "Пропустить" → UPDATE status='skipped'
--      Backfill ("приняла вчера в 21:00") → UPDATE status='taken', taken_at=<past>
--
-- ON DELETE SET NULL для medication_id: при hard-delete препарата (если такое
-- когда-то случится — в норме soft-delete) история приёмов остаётся. UI
-- показывает orphan-события как "удалённый препарат". Это намеренно: история
-- регулярности — личная статистика юзера, она не должна пропадать вместе с
-- удалением справочника.

create table public.intake_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  medication_id uuid references public.medications(id) on delete set null,

  -- Запланированное время в UTC. Frontend конвертирует из schedule + tz юзера.
  scheduled_at timestamptz not null,
  -- Фактическое время приёма. NULL если status != 'taken'.
  taken_at timestamptz,
  status text not null check (status in (
    'upcoming', 'taken', 'skipped', 'missed'
  )),

  -- Override дозы если приняли не как обычно. NULL = по расписанию.
  -- v1 UI этого не пишет — поле задел на v2.
  dose_actual numeric check (dose_actual is null or dose_actual > 0),

  -- КАНДИДАТ НА E2E v2 (см. notes в medications).
  notes text,

  created_at timestamptz not null default now()
);

-- Защита от дублей: один слот = одна запись.
-- Если фоновый генератор слотов вызовется дважды или клиент и cron одновременно —
-- второй INSERT упадёт на constraint violation, что корректно.
-- NB: после SET NULL на medication_id уникальность не покрывает orphan-ряды
-- (NULL != NULL в SQL), но они уже истории — новых дублей среди них быть не может.
create unique index idx_intake_events_med_scheduled_uniq
  on public.intake_events (medication_id, scheduled_at);

-- Главный запрос трекера: "сегодняшние слоты юзера", "история последних N дней",
-- графики адхеренса.
create index idx_intake_events_user_scheduled
  on public.intake_events (user_id, scheduled_at desc);

-- Деталка препарата: история конкретного medication_id.
create index idx_intake_events_med_scheduled
  on public.intake_events (medication_id, scheduled_at desc);

alter table public.intake_events enable row level security;

create policy "intake_events_select_own"
  on public.intake_events for select
  using (user_id = auth.uid());

create policy "intake_events_insert_own"
  on public.intake_events for insert
  with check (user_id = auth.uid());

create policy "intake_events_update_own"
  on public.intake_events for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "intake_events_delete_own"
  on public.intake_events for delete
  using (user_id = auth.uid());


-- ----------------------------------------------------------------------------
-- 4. Дозаливка profiles для уже существующих юзеров
-- ----------------------------------------------------------------------------
-- Триггер handle_new_user сработает только на новых регистраций. Для тех кто
-- уже зарегистрировался до этой миграции (тестовые аккаунты этапа 0) —
-- вставляем профили вручную.

insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;
