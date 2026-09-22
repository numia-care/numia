-- ============================================================================
-- profiles.recovery_anchor_version — защита якоря восстановления от затирания
-- ============================================================================
--
-- Проблема. Якорь восстановления (dek_wrapped_recovery + recovery_salt +
-- recovery_kdf_iterations) — единственная обёртка DEK на сервере. Если его
-- перезаписать чужим DEK, весь E2E-контент, зашифрованный старым, становится
-- нечитаемым НАВСЕГДА. Сценарии:
--   • два устройства одновременно проходят первую настройку: каждое генерит
--     свой DEK и пишет якорь — выигрывает последний;
--   • смена фразы: человек записал фразу A, другое устройство тем временем
--     записало B — A молча перестаёт работать.
--
-- Решение — оптимистическая блокировка. У якоря есть версия, запись условная:
-- «записать, только если версия всё ещё N» (BFF, PUT /e2e/recovery). Проверка и
-- запись — один UPDATE ... WHERE recovery_anchor_version = N: Postgres берёт
-- блокировку строки и перепроверяет WHERE на свежей версии строки, так что из
-- двух одновременных записей проходит ровно одна.
--
-- Почему версию ведёт ТРИГГЕР, а не BFF:
--   • веб пишет в profiles напрямую (lib/crypto/vault.ts, writeRecoveryAnchor)
--     и о версии не знает. Без триггера его запись не сдвинула бы версию, и
--     iOS не заметил бы, что якорь сменился;
--   • у authenticated есть UPDATE на всю таблицу — клиент мог бы сам записать
--     любую версию. Триггер ИГНОРИРУЕТ присланное значение и всегда считает
--     версию от старой строки.
--
-- Семантика: 0 — якоря никогда не было. Любое изменение трёх полей якоря
-- увеличивает версию на 1. Версия только растёт: если якорь когда-нибудь
-- обнулят, версия останется > 0 (BFF создаёт якорь по признаку «обёртки нет»,
-- а не «версия 0»).
-- ============================================================================

alter table public.profiles
  add column if not exists recovery_anchor_version integer not null default 0
  check (recovery_anchor_version >= 0);

comment on column public.profiles.recovery_anchor_version is
  'Версия якоря восстановления для условной записи. Ведётся триггером profiles_recovery_anchor_version, клиентское значение игнорируется.';

-- Бэкфилл ДО триггера. Якоря, записанные вебом раньше, получают версию 1.
-- Без этого у существующих пользователей якорь есть, а версия 0 — и запись
-- «создать, если якоря нет» затёрла бы живой якорь.
update public.profiles
  set recovery_anchor_version = 1
  where dek_wrapped_recovery is not null
    and recovery_anchor_version = 0;

-- search_path = '' — функция не зависит от пути поиска вызывающего.
create or replace function public.profiles_recovery_anchor_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.recovery_anchor_version := case
      when new.dek_wrapped_recovery is null
        and new.recovery_salt is null
        and new.recovery_kdf_iterations is null
      then 0
      else 1
    end;
  else
    new.recovery_anchor_version := old.recovery_anchor_version + case
      when (new.dek_wrapped_recovery, new.recovery_salt, new.recovery_kdf_iterations)
        is distinct from (old.dek_wrapped_recovery, old.recovery_salt, old.recovery_kdf_iterations)
      then 1
      else 0
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_recovery_anchor_version on public.profiles;
create trigger profiles_recovery_anchor_version
  before insert or update on public.profiles
  for each row execute function public.profiles_recovery_anchor_version();
