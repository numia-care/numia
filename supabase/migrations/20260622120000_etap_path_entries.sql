-- ============================================================================
-- Фича «Путь» (таймлайн перехода) — фундамент + первый тип записи (фото)
-- ============================================================================
--
-- Privacy-модель «Пути» (зафиксирована в CLAUDE.md, раздел про E2E):
--
--   КОНТЕНТ записи (фото, голос, текст заметки) — E2E-шифрование ключом из
--   PIN-сессии. Сервер и команда разработки расшифровать НЕ могут. В БД лежит
--   только шифроблоб (encrypted_content) и путь к зашифрованному файлу в
--   Storage (media_path) + IV для расшифровки (media_iv).
--
--   МЕТАДАННЫЕ (entry_type, occurred_at, id, created_at) — НЕ шифруются.
--   Серверу они нужны, чтобы отсортировать и построить ленту, не расшифровывая
--   контент. Это сознательный компромисс: тип записи и дата события видимы
--   серверу, само содержимое — нет.
--
-- Как применить (Supabase CLI у нас не настроен):
-- Supabase Dashboard → SQL Editor → New query → вставить весь файл → Run.
-- Проверить: таблица path_entries создана, RLS включён (Authentication →
-- Policies), бакет path-media есть и приватный (Storage).
--
-- Идемпотентность: повторный запуск падёт на CREATE TABLE — это намеренно
-- (см. стиль миграции трекера). Для перенаката — сначала DROP TABLE
-- public.path_entries и удалить политики storage.objects вручную.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. path_entries — одна запись на ленте «Пути»
-- ----------------------------------------------------------------------------
-- Один ряд = одно событие на хронологической ленте. На этом этапе реализуем
-- только entry_type='photo', остальные типы заложены в CHECK на будущее
-- (голос, текстовая заметка, результат анализа, веха перехода).

create table public.path_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Тип записи. Видим серверу (метаданные) — нужен для иконки/группировки в
  -- ленте без расшифровки контента. Пока пишем только 'photo'.
  entry_type text not null check (entry_type in (
    'photo', 'voice', 'note', 'lab_result', 'milestone'
  )),

  -- Когда СОБЫТИЕ произошло (не когда запись создана). Видим серверу — это
  -- ключ сортировки ленты. Юзер может поставить прошлую дату (фото сделано
  -- раньше, чем загружено). NOT NULL: лента без даты бессмысленна.
  occurred_at timestamptz not null,

  -- E2E-ШИФРОВАНО. Зашифрованный JSON с текстовой частью записи (для photo —
  -- опциональная подпись/caption; для note — сам текст). Формат блоба — как в
  -- lib/crypto (base64 ciphertext). nullable: фото без подписи допустимо.
  encrypted_content text,

  -- Путь к ЗАШИФРОВАННОМУ файлу в Storage-бакете path-media.
  -- Конвенция пути: {user_id}/{entry_id} (см. RLS бакета ниже).
  -- nullable: у note/milestone медиа нет.
  media_path text,

  -- IV/nonce (base64) для AES-GCM расшифровки файла по media_path.
  -- Новый IV на каждый файл (см. lib/path пайплайн). nullable вместе с media_path.
  media_iv text,

  created_at timestamptz not null default now()
);

-- Главный (и пока единственный) запрос ленты: записи юзера, новые сверху.
create index idx_path_entries_user_occurred
  on public.path_entries (user_id, occurred_at desc);

alter table public.path_entries enable row level security;

create policy "path_entries_select_own"
  on public.path_entries for select
  using (user_id = auth.uid());

create policy "path_entries_insert_own"
  on public.path_entries for insert
  with check (user_id = auth.uid());

create policy "path_entries_update_own"
  on public.path_entries for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "path_entries_delete_own"
  on public.path_entries for delete
  using (user_id = auth.uid());


-- ----------------------------------------------------------------------------
-- 2. GRANT привилегий ролям
-- ----------------------------------------------------------------------------
-- ВАЖНО (прошлые грабли, см. миграции 20260526 и 20260613): raw SQL НЕ выдаёт
-- привилегии ролям автоматически (в отличие от Table Editor). Без GRANT роль
-- даже не откроет таблицу — INSERT падёт с "permission denied". Выдаём сразу,
-- в той же миграции, чтобы не ловить это вторым фиксом.
--
-- authenticated — обычный залогиненный юзер (весь CRUD «Пути» идёт от него).
-- service_role — наша серверная роль (Edge Functions / будущий cron). Полный
--   CRUD на упреждение, чтобы новый серверный сценарий не требовал новой GRANT.
-- anon — доступ не нужен, «Путь» целиком за auth.

grant select, insert, update, delete on public.path_entries to authenticated;
grant select, insert, update, delete on public.path_entries to service_role;


-- ----------------------------------------------------------------------------
-- 3. Storage-бакет path-media — зашифрованные медиафайлы
-- ----------------------------------------------------------------------------
-- Приватный бакет (public=false): файлы отдаются только по авторизованному
-- запросу владельца. Содержимое и так зашифровано E2E, но приватность бакета —
-- второй слой (даже зашифрованный блоб не торчит по публичному URL).
--
-- RLS на storage.objects: юзер читает/пишет только файлы в своей «папке»
-- {user_id}/... . storage.foldername(name) разбивает путь по '/'; [1] — первый
-- сегмент, сравниваем с auth.uid(). Так путь {user_id}/{entry_id} автоматически
-- изолирует юзеров друг от друга.
--
-- GRANT на storage.objects уже выдан Supabase по умолчанию — здесь только
-- бакет и политики.

insert into storage.buckets (id, name, public)
values ('path-media', 'path-media', false)
on conflict (id) do nothing;

create policy "path_media_select_own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'path-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "path_media_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'path-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "path_media_update_own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'path-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'path-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "path_media_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'path-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
