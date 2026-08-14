-- =============================================================
-- Just.Pay – migraatio 004: tekijä (worker_name) ja työn ajankohta
-- jp_invoices-tauluun
--
-- Tausta: Kansallisvaranto Oy on laskujen laskuttava osapuoli
-- (kevytyrittäjä-/tekijämalli, sama rakenne kuin Ukko.fi/
-- Kassavirtanen). Laskulla pitää silti näkyä selkeästi KUKA
-- teki työn — erillään laskuttajasta. worker_name kirjataan
-- laskun luontihetkellä (oletusarvo tekijän oman organisaation
-- nimestä, muokattavissa per lasku).
--
-- worker_name on jätetty NULLABLE tietokantatasolla ja
-- pakollisuus toteutetaan sovelluksessa (lomakevalidointi).
-- Syy: B2B-laskutukselle (yritykseltä yritykselle, ei
-- tekijämalli) ei ole vielä omaa skeemaerottelua/lippua missään
-- — jos/kun sellainen rakennetaan, se ei saa käyttää näitä
-- samoja kenttiä ikään kuin ne olisivat tekijälaskuja. Nullable
-- sarake välttää turhan migraation kun tuo erottelu joskus
-- tehdään.
--
-- Aja Supabase SQL Editorissa: https://supabase.com/dashboard
-- =============================================================

ALTER TABLE public.jp_invoices
  ADD COLUMN worker_name text,
  ADD COLUMN service_date_start date,
  ADD COLUMN service_date_end date;
