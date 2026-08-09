-- ============================================================================
-- Анализы: персональный коридор показателя (lab_ranges)
-- ============================================================================
--
-- Границы «твоего обычного» по одному показателю. ЗАДАЁТ ИХ ЮЗЕР РУКАМИ —
-- это назначение врача, а не вывод из данных. Приложение диапазон НЕ
-- вычисляет: ни перцентилей по замерам, ни min/max с отбрасыванием выбросов.
-- Нет строки в этой таблице — нет коридора, и показать нечего.
--
-- Почему так, а не «посчитаем сами по шести замерам»: коридор, выведенный из
-- истории, на экране неотличим от медицинской нормы, но ею не является. У
-- транс-персоны на ЗГТ целевые значения зависят от протокола и стадии, и
-- назвать «обычным» разброс собственных прошлых анализов значило бы выдать
-- статистику за рекомендацию. Единственный источник этих чисел — человек,
-- которому их назвал врач.
--
-- Таблица — ЕДИНСТВЕННЫЙ источник границ. Логика сравнения уже написана и
-- принимает их аргументом: positionInRange(value, unit, range, analyte) в
-- lib/labs/stats.ts. Автоподбора там нет и не появится.
--
-- ----------------------------------------------------------------------------
-- Про шифрование: structured под RLS, НЕ E2E — и это осознанно
-- ----------------------------------------------------------------------------
-- Границы не чувствительнее самих замеров, которые лежат рядом открыто с
-- этапа 3 (lab_results.value/unit/analyte). «100–160 пг/мл эстрадиола» не
-- раскрывает ничего сверх того, что раскрывает соседняя строка с результатом.
-- Шифровать коридор, оставив плейнтекстом результаты, было бы театром.
--
-- Плюс практическое: график рисует полосу на клиенте, но границы нужны рядом
-- с данными в том же запросе. Защита — та же, что у остальных таблиц: RLS по
-- user_id = auth.uid(), TLS в пути, encryption at rest у Supabase.
--
-- ----------------------------------------------------------------------------
-- Форма: один коридор на (юзер × показатель)
-- ----------------------------------------------------------------------------
-- Коридор принадлежит ПОКАЗАТЕЛЮ, а не замеру. Положить его в lab_results
-- значило бы дублировать одни и те же границы в каждой строке эстрадиола —
-- ровно та двойная запись, которую вычистил подшаг 6. В profiles он тоже не
-- помещается: та строго 1:1 с юзером, а показателей много.
--
-- Образец схемы и политик — push_subscriptions (20260604120000), ближайший в
-- проекте аналог «на юзера × на сущность, с дедупликацией по естественному
-- ключу».
--
-- ----------------------------------------------------------------------------
-- КАК ПРИМЕНИТЬ
-- ----------------------------------------------------------------------------
-- Supabase Dashboard → SQL Editor → New query → вставить файл целиком → Run.
-- Плейсхолдеров нет, править перед запуском нечего.
--
-- От миграций уборки A/B/C (20260808*) НЕ ЗАВИСИТ: другая таблица, общих
-- колонок нет. Порядок применения относительно них любой.
--
-- Идемпотентна: create table if not exists, create index if not exists,
-- политики через drop policy if exists + create (как в 20260805120000).
-- Повторный прогон ничего не сломает и данные не тронет.
--
-- Проверки ПОСЛЕ применения — в конце файла.
--
-- ОТКАТ (таблица новая, поэтому чистый):
--   drop table if exists public.lab_ranges;
-- Политики и индексы уйдут вместе с ней. Пострадают только сами границы —
-- замеры, сдачи и всё остальное эта миграция не трогает.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Таблица
-- ----------------------------------------------------------------------------

create table if not exists public.lab_ranges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Код показателя из каталога в коде (lib/labs/catalog.ts). Каталога в БД
  -- нет — он правится кодом, — поэтому здесь просто text без FK и без CHECK
  -- на конкретный список. Ровно как analyte в lab_results.
  analyte text not null,

  -- Границы КАК ВВЁЛ ЮЗЕР, вместе с единицей, в которой он их вводил.
  min_value numeric not null check (min_value >= 0),
  max_value numeric not null check (max_value >= 0),

  -- Единица КОРИДОРА, а не «текущая единица отображения». Это принципиально:
  -- единица графика живёт в useState компонента (lab-chart.tsx), не
  -- персистится и сбрасывается на базовую при каждом открытии экрана. Храни
  -- мы границы «в единице отображения» — юзер задал бы 100–160 в пмоль/л, а
  -- назавтра те же числа читались бы как пг/мл, то есть коридор молча уехал
  -- бы в 3.67 раза.
  --
  -- Поэтому направление приведения именно такое: коридор — точка отсчёта,
  -- ЗНАЧЕНИЕ приводится к его единице. Так и устроен positionInRange.
  -- Тот же принцип, что у lab_results: исходник не искажаем.
  unit text not null,

  created_at timestamptz not null default now(),

  -- ВНИМАНИЕ, отличие от остальных таблиц проекта: updated_at здесь первый, и
  -- триггера, который бы его двигал, в проекте НЕТ (ни одного на весь
  -- supabase/migrations, кроме on_auth_user_created). Значит default now()
  -- сработает только при INSERT, а при UPDATE колонка сама НЕ обновится.
  -- Пишущий код обязан передавать updated_at явно в каждом upsert, иначе поле
  -- будет тихо врать. Заводить триггер ради одной таблицы не стали — но
  -- забыть об этом в lib/labs нельзя.
  updated_at timestamptz not null default now(),

  -- Перевёрнутый коридор невозможен на уровне БД, а не только в UI. Тот же
  -- инвариант, что positionInRange проверяет в рантайме (там min > max даёт
  -- null): дублируется намеренно, БД — последний рубеж.
  constraint lab_ranges_min_le_max check (min_value <= max_value),

  -- 'other' ПОКА БЕЗ КОРИДОРА, сознательно. Уникальный ключ ниже —
  -- (user_id, analyte), и для 'other' он склеил бы все кастомные показатели
  -- юзера в один коридор: витамин D и ферритин получили бы общие границы.
  -- Настоящий ключ для них двухсоставной — история группирует их как
  -- other:${analyte_custom_name} (labs-history.tsx). Расширим добавлением
  -- custom_name в ключ, когда понадобится; обратный порядок (сначала
  -- разрешить, потом чинить ключ) потребовал бы миграции данных.
  constraint lab_ranges_analyte_not_other check (analyte <> 'other')
);


-- ----------------------------------------------------------------------------
-- 2. Уникальность = ключ upsert'а
-- ----------------------------------------------------------------------------
-- Один коридор на показатель. Правка границ — это upsert по (user_id,
-- analyte), а не «найти id и обновить»: клиенту не нужно знать id строки,
-- он знает, чей это показатель.
--
-- Отдельный индекс по user_id НЕ нужен: user_id здесь ведущая колонка, и
-- запрос «все коридоры юзера» этот же индекс и обслужит. (В образце
-- push_subscriptions индексов два только потому, что уникальность там по
-- endpoint, без user_id впереди.)

create unique index if not exists idx_lab_ranges_user_analyte_uniq
  on public.lab_ranges (user_id, analyte);


-- ----------------------------------------------------------------------------
-- 3. RLS
-- ----------------------------------------------------------------------------

alter table public.lab_ranges enable row level security;

drop policy if exists "lab_ranges_select_own" on public.lab_ranges;
create policy "lab_ranges_select_own"
  on public.lab_ranges for select
  using (user_id = auth.uid());

drop policy if exists "lab_ranges_insert_own" on public.lab_ranges;
create policy "lab_ranges_insert_own"
  on public.lab_ranges for insert
  with check (user_id = auth.uid());

-- ОБЕ половины обязательны. using говорит, какие строки видно для правки;
-- with check — какими им позволено стать. Только с using строку можно было бы
-- переписать на чужой user_id и подарить свой коридор другому аккаунту.
drop policy if exists "lab_ranges_update_own" on public.lab_ranges;
create policy "lab_ranges_update_own"
  on public.lab_ranges for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- DELETE нужен: «убрать коридор» — нормальное действие юзера. (В profiles
-- DELETE-политики нет намеренно, но там другой случай — профиль без аккаунта
-- бессмыслен и уходит каскадом.)
drop policy if exists "lab_ranges_delete_own" on public.lab_ranges;
create policy "lab_ranges_delete_own"
  on public.lab_ranges for delete
  using (user_id = auth.uid());


-- ----------------------------------------------------------------------------
-- 4. GRANT
-- ----------------------------------------------------------------------------
-- Обязателен и НЕЗАВИСИМ от RLS: таблица, созданная raw SQL, привилегий не
-- получает, и без GRANT будет "permission denied" при идеально верных
-- политиках. Проект спотыкался об это дважды — 20260526120000 (authenticated)
-- и 20260613120000 (service_role) — и один раз недавно, на lab_sessions
-- (20260807120000).
--
-- Обе роли, как в path_entries, lab_results и lab_sessions. В самом образце
-- push_subscriptions в файле только authenticated — но лишь потому, что
-- service_role там забыли и дошивали отдельной миграцией; повторять эту
-- половину образца смысла нет.
--
-- anon НЕ выдаём: все эндпоинты за auth (см. концовку 20260526120000).

grant select, insert, update, delete on public.lab_ranges to authenticated;
grant select, insert, update, delete on public.lab_ranges to service_role;


-- ============================================================================
-- ПРОВЕРКИ ПОСЛЕ ПРИМЕНЕНИЯ (прогнать отдельно, не вместе с миграцией)
-- ============================================================================
--
-- 1. Таблица и её форма
--
-- select column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'lab_ranges'
-- order by ordinal_position;
--
-- Ждём 8 строк: id, user_id, analyte, min_value, max_value, unit, created_at,
-- updated_at. Все is_nullable = NO, кроме… ничего — nullable здесь нет вовсе.
--
--
-- 2. Четыре политики и GRANT
--
-- select policyname, cmd from pg_policies
-- where schemaname = 'public' and tablename = 'lab_ranges'
-- order by policyname;
-- -- ждём ровно 4: delete / insert / select / update
--
-- select grantee, privilege_type from information_schema.role_table_grants
-- where table_schema = 'public' and table_name = 'lab_ranges'
--   and grantee in ('authenticated', 'service_role')
-- order by grantee, privilege_type;
-- -- ждём 8 строк: по DELETE/INSERT/SELECT/UPDATE на каждую из двух ролей
--
--
-- 3. RLS РАБОТАЕТ: своя строка проходит, чужая падает
--
-- ⚠️ SQL Editor выполняет запросы служебной ролью, которая RLS ОБХОДИТ.
-- Простой insert здесь пройдёт всегда и не докажет ничего. Чтобы проверить
-- политики, надо представиться обычным юзером — set local role + JWT-клеймы.
-- Всё в транзакции с rollback, поэтому в базе ничего не останется.
--
-- Свой user_id взять так (в auth.users и email не ходим — незачем):
--   select distinct user_id from public.lab_sessions limit 5;
--
-- begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"ВСТАВЬ-СВОЙ-USER-ID","role":"authenticated"}';
--
--   -- (а) своя строка — ДОЛЖНА пройти
--   insert into public.lab_ranges (user_id, analyte, min_value, max_value, unit)
--   values ('ВСТАВЬ-СВОЙ-USER-ID', 'estradiol', 100, 160, 'pmol_l');
--
--   -- (б) чужой user_id — ДОЛЖНА упасть:
--   --     "new row violates row-level security policy for table lab_ranges"
--   insert into public.lab_ranges (user_id, analyte, min_value, max_value, unit)
--   values ('00000000-0000-0000-0000-000000000000', 'testosterone', 1, 2, 'nmol_l');
-- rollback;
--
-- Если (а) упала — смотри GRANT. Если (б) ПРОШЛА — политика insert не
-- применилась, дальше идти нельзя.
--
--
-- 4. Констрейнты (по желанию, тем же приёмом в транзакции)
--
-- begin;
--   -- перевёрнутый коридор — ДОЛЖЕН упасть на lab_ranges_min_le_max
--   insert into public.lab_ranges (user_id, analyte, min_value, max_value, unit)
--   values ('ВСТАВЬ-СВОЙ-USER-ID', 'prolactin', 500, 100, 'ng_ml');
-- rollback;
--
-- begin;
--   -- 'other' — ДОЛЖЕН упасть на lab_ranges_analyte_not_other
--   insert into public.lab_ranges (user_id, analyte, min_value, max_value, unit)
--   values ('ВСТАВЬ-СВОЙ-USER-ID', 'other', 1, 2, 'мкг/л');
-- rollback;
-- ============================================================================
