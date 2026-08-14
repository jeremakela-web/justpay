-- =============================================================
-- Just.Pay – migraatio 006: laskunumeroinnin kilpajuoksukorjaus
--
-- Tausta: generateInvoiceNumber() (lib/utils/invoice-number.ts) luki
-- suurimman olemassa olevan numeron ja kasvatti sitä sovelluspuolella
-- — kaksi samanaikaista laskun tallennusta samalle organisaatiolle
-- pystyivät laskemaan saman "seuraavan" numeron. jp_invoices_unique_number
-- (UNIQUE org_id, invoice_number) esti hiljaisen tuplan, mutta
-- käyttäjä näki vain yleisen tallennusvirheen eikä kilpajuoksu ollut
-- rakenteellisesti mahdotonta, vain kiinni jäävä.
--
-- Korjaus: erillinen laskuri per (org_id, year), jota kasvatetaan
-- yhdellä atomisella INSERT ... ON CONFLICT DO UPDATE ... RETURNING
-- -lauseella. Rivilukko tekee samanaikaisista kutsuista turvallisesti
-- sarjallisia ilman erillistä transaktiokäsittelyä sovelluspuolella.
-- =============================================================

CREATE TABLE public.jp_invoice_counters (
  org_id      uuid    NOT NULL REFERENCES public.jp_organizations(id) ON DELETE CASCADE,
  year        integer NOT NULL,
  last_number integer NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, year)
);

ALTER TABLE public.jp_invoice_counters ENABLE ROW LEVEL SECURITY;
-- Ei suoria client-politiikkoja: ainoa pääsy tähän tauluun kulkee
-- alla olevan SECURITY DEFINER -funktion kautta.

CREATE OR REPLACE FUNCTION public.next_invoice_number(p_org_id uuid, p_year integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_next  integer;
BEGIN
  SELECT owner_user_id INTO v_owner
  FROM public.jp_organizations
  WHERE id = p_org_id;

  IF v_owner IS NULL OR v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'Ei oikeuksia organisaatioon %', p_org_id;
  END IF;

  INSERT INTO public.jp_invoice_counters (org_id, year, last_number)
  VALUES (p_org_id, p_year, 1)
  ON CONFLICT (org_id, year)
  DO UPDATE SET last_number = jp_invoice_counters.last_number + 1
  RETURNING last_number INTO v_next;

  RETURN v_next;
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_invoice_number(uuid, integer) TO authenticated;
