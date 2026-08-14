-- =============================================================
-- Just.Pay – migraatio 005: laskun statusmuutosten jäljitettävyys,
-- maksuvahvistuksen syy, tekijän nimen poikkeamaperuste, ja
-- työn ajanjakson eheystarkistus
--
-- Tausta: pilottiasiakkaan käyttöönottoa edeltävä auditointi
-- (go-live-riskiraportti) tunnisti nämä puutteet:
--
-- 1) Laskun statusmuutoksia (draft->sent->paid/overdue/cancelled)
--    ei kirjattu kenenkään tekemäksi eikä ajallisesti — pelkkä
--    yhden napin painallus riitti minkä tahansa laskun merkitsemiseen
--    maksetuksi ilman jälkeä siitä kuka teki muutoksen tai milloin.
-- 2) "Merkitse maksetuksi" ei vaatinut mitään perustelua/viitettä
--    siitä miten maksu oikeasti vahvistettiin.
-- 3) worker_name (ks. migration_004) on vapaata tekstiä ilman mitään
--    perustelua, jos se poikkeaa laskuttavan käyttäjän omasta nimestä.
-- 4) service_date_start/service_date_end (ks. migration_004) eheys
--    varmistettiin vain sovellustasolla — suora API/DB-kirjoitus
--    pystyi ohittamaan tarkistuksen.
-- =============================================================

-- ----------------------------------------------------------------
-- 1) Jäljitettävyys: kuka muutti laskua ja milloin
-- ----------------------------------------------------------------
ALTER TABLE public.jp_invoices
  ADD COLUMN updated_by uuid REFERENCES auth.users(id),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

-- Trigger asettaa updated_at/updated_by automaattisesti JOKAISELLA
-- UPDATE-lauseella — sovelluskoodi ei voi unohtaa täyttää näitä,
-- eikä niitä voi väärentää lähettämällä oma arvo mukana.
-- auth.uid() lukee kirjautuneen käyttäjän JWT:stä (sama mekanismi
-- kuin RLS-politiikoissa).
CREATE OR REPLACE FUNCTION public.set_invoice_updated_meta()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$$;

CREATE TRIGGER jp_invoices_set_updated_meta
  BEFORE UPDATE ON public.jp_invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.set_invoice_updated_meta();

-- ----------------------------------------------------------------
-- 2) Maksuvahvistuksen syy ("miten maksu vahvistettiin")
-- ----------------------------------------------------------------
ALTER TABLE public.jp_invoices
  ADD COLUMN paid_confirmation_note text;

-- ----------------------------------------------------------------
-- 3) Tekijän nimen poikkeamaperuste
-- ----------------------------------------------------------------
ALTER TABLE public.jp_invoices
  ADD COLUMN worker_name_note text;

-- ----------------------------------------------------------------
-- 4) Työn ajanjakson eheys tietokantatasolla
-- ----------------------------------------------------------------
ALTER TABLE public.jp_invoices
  ADD CONSTRAINT jp_invoices_service_date_range
  CHECK (
    service_date_start IS NULL
    OR service_date_end IS NULL
    OR service_date_end >= service_date_start
  );
