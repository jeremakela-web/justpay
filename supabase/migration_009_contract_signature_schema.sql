-- =============================================================
-- Just.Pay – migraatio 009: sopimuksen sähköisen allekirjoituksen
-- SKEEMA (taulut, Storage-bucket, contract_signed_at-sarake)
--
-- Tausta: toimeksianto-/laskutuspalvelusopimus pitää esittää joka
-- tekijälle onboardingin jälkeen, ja tekijä ei saa päästä mihinkään
-- muuhun osaan sovellusta ennen kuin sopimus on allekirjoitettu
-- vahvalla tunnistautumisella (Bink.fi, pankkitunnukset/mobiili-
-- varmenne).
--
-- HUOM — tämä on tarkoituksella jaettu kahteen migraatioon:
--   009 (tämä tiedosto) = pelkkä skeema. Pelkästään lisäävä — ei
--     kosketa yhtäkään olemassa olevaa riviä minkään käyttäjän
--     laskuissa/asiakkaissa/maksuissa, joten TÄMÄN voi ajaa jo
--     ennen kuin Bink-allekirjoituspolku on testattu valmiiksi.
--     Tarvitaan juuri sitä testausta varten (jp_contract_templates,
--     jp_contract_signatures ja contract_signed_at-sarake ovat
--     sovelluksen /contract-reitin ja sen API-reittien edellytyksiä).
--   010 (migration_010_contract_signature_rls_gate.sql) = varsinainen
--     esto: kiristää jp_customers/jp_invoices/jp_invoice_lines/
--     jp_payments-käytännöt vaatimaan contract_signed_at IS NOT NULL.
--     TÄTÄ EI SAA AJAA ennen kuin allekirjoituspolku on todistetusti
--     testattu päästä päähän — ks. sen tiedoston oma varoitus.
-- =============================================================

-- ----------------------------------------------------------------
-- 1) Storage-bucket sopimuspohjalle (ei julkinen)
-- ----------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('contract-templates', 'contract-templates', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "contract_templates: authenticated read" ON storage.objects;
CREATE POLICY "contract_templates: authenticated read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'contract-templates');
-- Ei INSERT/UPDATE/DELETE-käytäntöä authenticated-roolille: PDF:n
-- lataus tehdään Supabase-hallintapaneelin kautta (kertaluontoinen
-- käsityö) tai service-role-avaimella, ei sovelluksen kautta.

-- ----------------------------------------------------------------
-- 2) jp_contract_templates — metatieto siitä mikä sopimusversio on
--    voimassa ja missä sen tiedosto sijaitsee Storagessa. Itse
--    tiedoston sisältöä ei tallenneta tietokantaan.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.jp_contract_templates (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  version       text        NOT NULL UNIQUE,
  storage_path  text        NOT NULL,
  content_type  text        NOT NULL DEFAULT 'application/pdf',
  is_active     boolean     NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Vain yksi aktiivinen sopimusversio kerrallaan.
CREATE UNIQUE INDEX IF NOT EXISTS jp_contract_templates_active_idx
  ON public.jp_contract_templates(is_active)
  WHERE is_active = true;

ALTER TABLE public.jp_contract_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contract_templates: authenticated read" ON public.jp_contract_templates;
CREATE POLICY "contract_templates: authenticated read"
  ON public.jp_contract_templates FOR SELECT
  USING (auth.role() = 'authenticated');
-- Ei kirjoituskäytäntöä tavalliselle käyttäjälle — uusi versio
-- lisätään käsin SQL-editorissa (sama malli kuin jp_vat_rules /
-- jp_addon_services-viitedatan siemennys).

-- RLS-käytäntö ei riitä yksin — Postgres tarkistaa perus-GRANTin
-- ENNEN kuin RLS-lauseke edes arvioidaan, joten ilman tätä
-- authenticated-rooli saa "permission denied for table" -virheen
-- käytännöstä riippumatta. Sama malli kuin migration_002:n
-- jp_addon_services.
GRANT SELECT ON public.jp_contract_templates TO authenticated;

-- ----------------------------------------------------------------
-- 3) jp_contract_signatures — todiste allekirjoituksesta
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.jp_contract_signatures (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid          NOT NULL REFERENCES public.jp_organizations(id) ON DELETE CASCADE,
  contract_version      text          NOT NULL,
  provider              text          NOT NULL DEFAULT 'bink',
  method                text          NOT NULL DEFAULT 'strong'
                                        CHECK (method IN ('strong', 'light')),
  provider_document_id  text          NOT NULL,
  status                text          NOT NULL DEFAULT 'in_process'
                                        CHECK (status IN ('draft', 'in_process', 'signed')),
  -- verified_name/verified_identity/signer_ip täyttyvät vasta kun
  -- webhook vahvistaa allekirjoituksen valmiiksi — ks. GET
  -- /api/documents/{id} -kutsu webhook-käsittelijässä. Raaka JSON
  -- talletetaan verified_identity:iin sellaisenaan, koska emme ole
  -- vielä nähneet oikeaa vastausmuotoa sandboxista.
  verified_name         text,
  verified_identity     jsonb,
  signer_ip             text,
  signed_at             timestamptz,
  created_at            timestamptz   NOT NULL DEFAULT now(),
  updated_at            timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS jp_contract_signatures_provider_doc_idx
  ON public.jp_contract_signatures(provider, provider_document_id);
CREATE INDEX IF NOT EXISTS jp_contract_signatures_org_idx
  ON public.jp_contract_signatures(org_id);

ALTER TABLE public.jp_contract_signatures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contract_signatures: org-omistaja voi lukea omansa" ON public.jp_contract_signatures;
CREATE POLICY "contract_signatures: org-omistaja voi lukea omansa"
  ON public.jp_contract_signatures FOR SELECT
  USING (
    org_id IN (SELECT id FROM public.jp_organizations WHERE owner_user_id = auth.uid())
  );

-- Käyttäjä saa käynnistää allekirjoitusprosessin (luoda rivin
-- status='in_process' Bink-dokumentin luonnin yhteydessä), mutta
-- EI voi itse muuttaa sitä — vain webhook-käsittelijä (service-role,
-- ohittaa RLS:n) saa merkitä sen allekirjoitetuksi. Tarkoituksella
-- EI UPDATE/DELETE-käytäntöä tavalliselle käyttäjälle: rivin voi
-- luoda, muttei muokata, mikä tekee itse-hyväksynnästä mahdotonta.
DROP POLICY IF EXISTS "contract_signatures: org-omistaja voi aloittaa" ON public.jp_contract_signatures;
CREATE POLICY "contract_signatures: org-omistaja voi aloittaa"
  ON public.jp_contract_signatures FOR INSERT
  WITH CHECK (
    org_id IN (SELECT id FROM public.jp_organizations WHERE owner_user_id = auth.uid())
  );

-- Sama huomio kuin jp_contract_templatesilla: RLS ei korvaa perus-
-- GRANTia. authenticated saa vain sen minkä yllä olevat käytännöt
-- muutenkin sallisivat (SELECT omaan orgiin, INSERT aloittaakseen);
-- service_role tarvitsee SELECT+UPDATE, koska webhook-käsittelijä
-- (lib/supabase/service.ts) etsii rivin provider_document_id:llä ja
-- päivittää sen status='signed' saatuaan Bink-webhookin — se ohittaa
-- RLS:n (rolbypassrls), muttei perus-GRANTin tarvetta.
GRANT SELECT, INSERT ON public.jp_contract_signatures TO authenticated;
GRANT SELECT, UPDATE ON public.jp_contract_signatures TO service_role;

-- ----------------------------------------------------------------
-- 4) jp_webhook_dedupe — estää Bink-webhookin uudelleenyritysten
--    (max 3, ks. heidän dokumentaationsa) käsittelemisen kahdesti
-- ----------------------------------------------------------------
-- succeeded_at is what actually makes this safe for Bink's retry
-- model (max 3 attempts): a row existing with succeeded_at IS NULL
-- means an earlier attempt for this event id started but never
-- finished (crashed, DB hiccup, etc.) — a retry should be allowed to
-- reprocess it. Only succeeded_at IS NOT NULL means "genuinely
-- already handled, skip". Without this distinction, a transient
-- failure on the first delivery would insert the dedupe row and then
-- every one of Bink's retries would be swallowed as a false
-- duplicate, permanently losing that signature confirmation.
CREATE TABLE IF NOT EXISTS public.jp_webhook_dedupe (
  event_id     text        PRIMARY KEY,
  provider     text        NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now(),
  succeeded_at timestamptz
);

ALTER TABLE public.jp_webhook_dedupe ENABLE ROW LEVEL SECURITY;
-- Ei policyja lainkaan: default-deny kaikelta paitsi service-role-
-- yhteydeltä, joka ohittaa RLS:n. Tähän ei koskaan pitäisi kirjoittaa
-- suoraan clientistä.

-- rolbypassrls ohittaa RLS:n mutta ei perus-GRANTin tarvetta — ilman
-- tätä webhook-käsittelijän dedupe-tarkistus/-kirjaus epäonnistuisi
-- "permission denied" -virheeseen jokaisella Bink-webhook-kutsulla.
-- Ei GRANTia authenticated-roolille: tähän ei koskaan pitäisi
-- kirjoittaa clientistä, ks. yllä.
GRANT SELECT, INSERT, UPDATE ON public.jp_webhook_dedupe TO service_role;

-- ----------------------------------------------------------------
-- 5) jp_organizations.contract_signed_at + suojaustriggeri
-- ----------------------------------------------------------------
ALTER TABLE public.jp_organizations
  ADD COLUMN IF NOT EXISTS contract_signed_at timestamptz;

-- Estää sen, että käyttäjä asettaisi contract_signed_at:n itse
-- suoralla .update()-kutsulla selaimesta (mikä muuten olisi
-- mahdollista, koska jp_organizations-taulun omistaja saa jo
-- päivittää oman rivinsä muita kenttiä). Vain service-role
-- (webhook-käsittelijä vahvistetun allekirjoituksen jälkeen) saa
-- muuttaa tätä yhtä saraketta.
CREATE OR REPLACE FUNCTION public.protect_contract_signed_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.contract_signed_at IS DISTINCT FROM OLD.contract_signed_at
     AND auth.role() <> 'service_role'
  THEN
    RAISE EXCEPTION 'contract_signed_at voidaan asettaa vain vahvistetun allekirjoitusprosessin kautta';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS jp_organizations_protect_contract_signed_at ON public.jp_organizations;
CREATE TRIGGER jp_organizations_protect_contract_signed_at
  BEFORE UPDATE ON public.jp_organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_contract_signed_at();

-- migration_001 never granted service_role any base privilege on
-- jp_organizations (it had never needed to write here before this
-- feature). The trigger above already restricts which role may
-- change contract_signed_at; this is the separate, lower-level
-- privilege service_role needs just to run an UPDATE at all.
GRANT UPDATE ON public.jp_organizations TO service_role;

-- Tämä migraatio päättyy tähän tarkoituksella. Sopimusportin
-- todellinen esto (RLS jp_customers/jp_invoices/jp_invoice_lines/
-- jp_payments-tauluille) on migration_010_contract_signature_rls_gate.sql
-- — katso sen tiedoston varoitus ennen ajamista.
