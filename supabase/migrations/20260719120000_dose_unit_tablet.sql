-- ============================================================================
-- Единица дозировки «таблетка» (фидбек первого бета-тестера, 2026-07-19)
-- ============================================================================
--
-- 'tablet' существовал только как лекарственная ФОРМА (medications.form),
-- а как единицы дозы («принять 1 таблетку», когда мг считать неудобно) его
-- не было никогда — проверено по истории. Добавляем в CHECK.
--
-- Как применить:
-- Supabase Dashboard → SQL Editor → New query → вставить → Run.
-- ============================================================================

alter table public.medications
  drop constraint if exists medications_dose_unit_check;

alter table public.medications
  add constraint medications_dose_unit_check check (dose_unit in (
    'mg', 'mcg', 'ml', 'iu', 'drop', 'puff', 'tablet'
  ));
