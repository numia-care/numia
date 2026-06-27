-- ============================================================================
-- Этап 3 — Анализы (лабораторные показатели), гибрид по границе шифрования
-- ============================================================================
--
-- Privacy-модель (CLAUDE.md, «Уровни шифрования»):
--
--   ЧИСЛА (value, unit, measured_at, analyte) — открыто в Postgres под RLS,
--   БЕЗ E2E. Это сознательно: значения нужны серверу/клиенту для графиков
--   динамики и не несут текста о самочувствии. Защита — RLS user_id=auth.uid(),
--   TLS, encryption-at-rest Supabase. Уровень «стандарт», как у трекера.
--
--   ЗАМЕТКА и ФОТО БЛАНКА — E2E, тем же конвейером, что медиа «Пути»:
--     note_ciphertext   — encryptText(DEK, заметка): base64(iv‖ct), IV внутри.
--     blank_photo_path  — путь к ЗАШИФРОВАННОМУ блобу в бакете path-media
--                         (encryptBytes на клиенте ДО загрузки), конвенция
--                         пути {user_id}/{lab_result_id} — та же, что у «Пути»,
--                         поэтому переиспользуем бакет и его RLS (новый бакет/
--                         политики не нужны).
--     blank_photo_iv    — base64 nonce для расшифровки блоба (как media_iv в
--                         path_entries; не секрет). Сервер фото не видит.
--
-- OCR/распознавание с фото НЕ делаем — это сломало бы E2E. Только ручной ввод.
--
-- Как применить:
-- Supabase Dashboard → SQL Editor → New query → вставить весь файл → Run.
-- Проверить: таблица lab_results создана, RLS включён (Authentication → Policies).
--
-- Идемпотентность: повторный запуск падёт на CREATE TABLE — намеренно (как в
-- миграциях трекера и «Пути»). Для перенаката — DROP TABLE public.lab_results.
-- ============================================================================


create table public.lab_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Код показателя из каталога в коде (lib/labs/catalog.ts) либо 'other'.
  -- Каталог НЕ в БД (легко править/расширять кодом), поэтому здесь просто text
  -- без CHECK на конкретный список.
  analyte text not null,

  -- Произвольное название — только для analyte='other'. Для каталожных
  -- показателей всегда NULL (гарантируется CHECK ниже).
  analyte_custom_name text,

  -- Значение и единица — КАК ВВЁЛ ЮЗЕР, исходник не искажаем. unit для
  -- каталожных показателей — стабильный код единицы (см. catalog.ts), для
  -- 'other' — произвольная строка. Конверсия единиц только на клиенте, для
  -- отображения графика; в БД ничего не пересчитываем.
  value numeric not null check (value >= 0),
  unit text not null,

  -- Дата анализа (календарная, без времени).
  measured_at date not null,

  -- E2E-заметка (опц.). base64(iv‖ct) из encryptText. Сервер не читает.
  note_ciphertext text,

  -- E2E-фото бланка (опц.): путь к шифроблобу в path-media + его IV.
  blank_photo_path text,
  blank_photo_iv text,

  created_at timestamptz not null default now(),

  -- Кастомное имя осмысленно только для 'other'.
  constraint analyte_custom_name_only_other
    check (analyte = 'other' or analyte_custom_name is null),
  -- Фото и его IV ходят парой: либо оба заданы, либо оба NULL.
  constraint blank_photo_path_iv_together
    check ((blank_photo_path is null) = (blank_photo_iv is null))
);

-- Главный запрос истории/графика: показатели юзера по типу, новые сверху.
create index idx_lab_results_user_analyte_date
  on public.lab_results (user_id, analyte, measured_at desc);

alter table public.lab_results enable row level security;

create policy "lab_results_select_own"
  on public.lab_results for select
  using (user_id = auth.uid());

create policy "lab_results_insert_own"
  on public.lab_results for insert
  with check (user_id = auth.uid());

create policy "lab_results_update_own"
  on public.lab_results for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "lab_results_delete_own"
  on public.lab_results for delete
  using (user_id = auth.uid());

-- GRANT обязателен при создании таблицы raw SQL (Table Editor выдаёт сам).
-- Без него роль получит "permission denied" даже под верной RLS. См. те же
-- грабли в миграциях трекера и «Пути».
grant select, insert, update, delete on public.lab_results to authenticated;
grant select, insert, update, delete on public.lab_results to service_role;

-- Бакет path-media и его storage-политики УЖЕ существуют (миграция «Пути»):
-- путь {user_id}/{id} изолирован по первому сегменту = auth.uid(). Фото бланка
-- кладём туда же — отдельный бакет/политики не нужны.
