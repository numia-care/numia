-- ============================================================================
-- Анализы: гибкий ввод (фидбек тестера, 2026-07-23)
-- ============================================================================
--
-- Два послабления, чтобы не заставлять юзера выдумывать данные:
--   1) ФОТО БЛАНКА без чисел — «сохраню снимок сейчас, числа впишу потом».
--      Значит value/unit/analyte становятся необязательными.
--   2) БЕЗ ТОЧНОЙ ДАТЫ — если не помнит, measured_at можно не указывать.
--
-- Целостность держим на CHECK, а не на NOT NULL:
--   • ряд не пустой: есть числа ИЛИ фото;
--   • числовой ряд корректен: если есть value, есть и единица, и показатель.
--
-- Как применить:
-- Supabase Dashboard → SQL Editor → New query → вставить → Run.
-- ============================================================================

alter table public.lab_results alter column value drop not null;
alter table public.lab_results alter column unit drop not null;
alter table public.lab_results alter column analyte drop not null;
alter table public.lab_results alter column measured_at drop not null;

alter table public.lab_results
  add constraint lab_numeric_or_photo
    check (value is not null or blank_photo_path is not null),
  add constraint lab_numeric_well_formed
    check (value is null or (unit is not null and analyte is not null));
