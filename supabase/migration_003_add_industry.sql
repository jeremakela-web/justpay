-- =============================================================
-- Just.Pay – migraatio 003: toimiala (industry) organisaatioihin
-- Aja Supabase SQL Editorissa: https://supabase.com/dashboard
-- =============================================================

ALTER TABLE public.jp_organizations
  ADD COLUMN industry text;
