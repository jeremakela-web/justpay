-- =============================================================
-- Just.Pay – migraatio 009: sopimuksen sähköinen allekirjoitus
-- + vahva tunnistautuminen -portti ennen dashboardia
--
-- Tausta: toimeksianto-/laskutuspalvelusopimus pitää esittää joka
-- tekijälle onboardingin jälkeen, ja tekijä ei saa päästä mihinkään
-- muuhun osaan sovellusta ennen kuin sopimus on allekirjoitettu
-- vahvalla tunnistautumisella (Bink.fi, pankkitunnukset/mobiili-
-- varmenne). Portti on toteutettava RLS-tasolla, ei vain UI:ssa —
-- nykyinen /onboarding-portti on vain (dashboard)/layout.tsx:n
-- client-puolen tarkistus, jonka suora API-kutsu pystyy ohittamaan.
--
-- ⚠️⚠️⚠️ TÄRKEÄ AJOITUSHUOMIO ENNEN TÄMÄN AJAMISTA ⚠️⚠️⚠️
-- Heti kun tämän migraation lopussa olevat RLS-käytännöt astuvat
-- voimaan, JOKAINEN jo olemassa oleva organisaatio (myös pilotti-
-- asiakkaan, jos onboarding on jo tehty ja dataa on jo luotu)
-- menettää pääsyn omiin laskuihinsa/asiakkaisiinsa/maksuihinsa
-- VÄLITTÖMÄSTI, koska contract_signed_at on NULL kaikilla vanhoilla
-- riveillä. ÄLÄ aja tätä migraatiota ennen kuin koko allekirjoitus-
-- polku (Bink-sandbox-tunnukset asetettu, oikea sopimus-PDF ladattu
-- Storageen, webhook testattu päästä päähän) on todistetusti
-- toimiva — muuten lukitset olemassa olevan datan ilman keinoa
-- päästä siitä läpi.
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

-- ----------------------------------------------------------------
-- 6) Sopimusportin todellinen esto: jp_customers/jp_invoices/
--    jp_invoice_lines/jp_payments vaativat nyt contract_signed_at
--    IS NOT NULL omistajuuden lisäksi. Tämä on se rakenteellinen
--    esto — suora API-kutsu ei enää pysty ohittamaan porttia, koska
--    tietokanta itse kieltäytyy palauttamasta/kirjoittamasta rivejä
--    allekirjoittamattomalle organisaatiolle.
-- ----------------------------------------------------------------
DROP POLICY IF EXISTS "customers: org-omistaja pääsee käsiksi" ON public.jp_customers;
CREATE POLICY "customers: org-omistaja pääsee käsiksi"
  ON public.jp_customers FOR ALL
  USING (
    org_id IN (
      SELECT id FROM public.jp_organizations
      WHERE owner_user_id = auth.uid() AND contract_signed_at IS NOT NULL
    )
  )
  WITH CHECK (
    org_id IN (
      SELECT id FROM public.jp_organizations
      WHERE owner_user_id = auth.uid() AND contract_signed_at IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "invoices: org-omistaja pääsee käsiksi" ON public.jp_invoices;
CREATE POLICY "invoices: org-omistaja pääsee käsiksi"
  ON public.jp_invoices FOR ALL
  USING (
    org_id IN (
      SELECT id FROM public.jp_organizations
      WHERE owner_user_id = auth.uid() AND contract_signed_at IS NOT NULL
    )
  )
  WITH CHECK (
    org_id IN (
      SELECT id FROM public.jp_organizations
      WHERE owner_user_id = auth.uid() AND contract_signed_at IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "invoice_lines: org-omistaja pääsee käsiksi" ON public.jp_invoice_lines;
CREATE POLICY "invoice_lines: org-omistaja pääsee käsiksi"
  ON public.jp_invoice_lines FOR ALL
  USING (
    invoice_id IN (
      SELECT i.id FROM public.jp_invoices i
      JOIN   public.jp_organizations o ON o.id = i.org_id
      WHERE  o.owner_user_id = auth.uid() AND o.contract_signed_at IS NOT NULL
    )
  )
  WITH CHECK (
    invoice_id IN (
      SELECT i.id FROM public.jp_invoices i
      JOIN   public.jp_organizations o ON o.id = i.org_id
      WHERE  o.owner_user_id = auth.uid() AND o.contract_signed_at IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "payments: org-omistaja pääsee käsiksi" ON public.jp_payments;
CREATE POLICY "payments: org-omistaja pääsee käsiksi"
  ON public.jp_payments FOR ALL
  USING (
    org_id IN (
      SELECT id FROM public.jp_organizations
      WHERE owner_user_id = auth.uid() AND contract_signed_at IS NOT NULL
    )
  )
  WITH CHECK (
    org_id IN (
      SELECT id FROM public.jp_organizations
      WHERE owner_user_id = auth.uid() AND contract_signed_at IS NOT NULL
    )
  );
