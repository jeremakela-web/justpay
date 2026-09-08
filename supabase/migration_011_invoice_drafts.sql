-- =============================================================
-- Just.Pay – migraatio 011: kuvasta-lasku-putken persistenssikerros
-- (jp_invoice_drafts)
--
-- Tausta: nykyinen kuvasta-lasku-ominaisuus (migration_001 asti,
-- app/api/invoices/extract/route.ts) lukee kuvan suoraan base64:nä,
-- kutsuu Claude vision -mallia ja täyttää laskulomakkeen sillä
-- paikanpäällä — mitään ei tallenneta, ei alkuperäistä kuvaa eikä
-- poiminnan tulosta. Tämä migraatio lisää oikean putken: kuva
-- Storageen ensin, draft-rivi luodaan, poiminta ajetaan sitä vasten,
-- ja käyttäjä tarkistaa/korjaa tulokset ennen kuin niistä syntyy
-- oikea jp_invoices-rivi (ks. app/api/invoices/drafts/[id]/approve).
--
-- Alkuperäinen kuva säilytetään toistaiseksi (ei automaattista
-- poistoa) — se on ainoa todiste siitä mistä laskurivit on luettu,
-- jos poiminta myöhemmin kyseenalaistetaan.
-- =============================================================

-- ----------------------------------------------------------------
-- 1) Storage-bucket alkuperäisille kuville (ei julkinen)
-- ----------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('invoice-draft-sources', 'invoice-draft-sources', false)
ON CONFLICT (id) DO NOTHING;

-- Tiedostopolku on aina muotoa {org_id}/{draft_id}/{tiedostonimi} —
-- käytäntö tarkistaa polun ensimmäisen segmentin siksi, ei erillistä
-- metadataa. Sama malli kuin migration_009:n contract-templates,
-- mutta org-kohtaisesti eroteltu (jokainen org saa vain omansa,
-- toisin kuin yksi jaettu sopimuspohja kaikille).
DROP POLICY IF EXISTS "invoice_draft_sources: org-omistaja pääsee käsiksi" ON storage.objects;
CREATE POLICY "invoice_draft_sources: org-omistaja pääsee käsiksi"
  ON storage.objects FOR ALL
  TO authenticated
  USING (
    bucket_id = 'invoice-draft-sources'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.jp_organizations WHERE owner_user_id = auth.uid()
    )
  )
  WITH CHECK (
    bucket_id = 'invoice-draft-sources'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.jp_organizations WHERE owner_user_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------
-- 2) jp_invoice_drafts
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.jp_invoice_drafts (
  id                   uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid          NOT NULL REFERENCES public.jp_organizations(id) ON DELETE CASCADE,
  status               text          NOT NULL DEFAULT 'uploaded'
                                       CHECK (status IN (
                                         'uploaded', 'processing', 'ready_for_review',
                                         'approved', 'rejected', 'failed'
                                       )),

  source_file_path     text          NOT NULL,
  source_file_name     text          NOT NULL,
  source_content_type  text          NOT NULL,
  -- sha256 hex alkuperäisen tiedoston tavuista. Käytetään vain
  -- duplikaattivaroitukseen (sama org lataa saman kuitin kahdesti) —
  -- lippu, ei esto: kaksoiskappale on täysin laillinen tilanne
  -- (esim. sama hinnasto käytössä kahdessa eri laskussa).
  content_hash         text          NOT NULL,

  -- Ei ocr_provider/ocr_raw_result-sarakkeita: poiminta tehdään
  -- suoraan Claude visionilla, ei erillisellä OCR-vaiheella, joten
  -- sarakkeet olisivat aina tyhjiä. llm_model tallennetaan silti aina
  -- riville, jotta vanhat draftit pysyvät jäljitettävinä jos mallia
  -- vaihdetaan myöhemmin.
  llm_provider         text          NOT NULL DEFAULT 'anthropic',
  llm_model            text,

  -- extracted_data: { lines: [{description, quantity, unit_price,
  --   vat_rate, service_date, confidence}], customer_suggestion,
  --   worker_suggestion, computed_subtotal, computed_vat_total,
  --   computed_total } — ks. app/api/invoices/extract/route.ts.
  -- Rivikohtaiset summat (quantity × unit_price) lasketaan aina
  -- sovelluskoodissa, ei koskaan pyydetä mallilta.
  extracted_data        jsonb,
  -- field_confidence: { lines: [{index, confidence}] } — 0-100,
  -- kopio extracted_data.lines[].confidence:sta erillään, jotta
  -- tarkistusnäkymä voi suodattaa/korostaa alle 85%:n rivit
  -- lukematta koko extracted_data-rakennetta uudelleen.
  field_confidence       jsonb,
  -- validation_flags: { new_customer, unusual_amount,
  --   out_of_pattern_lines: [index], duplicate_of_draft_id } —
  -- sovelluskoodin laskemia poikkeamahavaintoja, ei mallin tulostetta.
  validation_flags       jsonb,

  reviewed_at             timestamptz,
  resulting_invoice_id    uuid          REFERENCES public.jp_invoices(id),
  error_message           text,

  created_at              timestamptz   NOT NULL DEFAULT now(),
  updated_at               timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jp_invoice_drafts_org_idx
  ON public.jp_invoice_drafts(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS jp_invoice_drafts_org_status_idx
  ON public.jp_invoice_drafts(org_id, status);
-- Dedup-tarkistuksen hakupolku: sama org + sama sisältö.
CREATE INDEX IF NOT EXISTS jp_invoice_drafts_org_hash_idx
  ON public.jp_invoice_drafts(org_id, content_hash);

ALTER TABLE public.jp_invoice_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invoice_drafts: org-omistaja pääsee käsiksi" ON public.jp_invoice_drafts;
CREATE POLICY "invoice_drafts: org-omistaja pääsee käsiksi"
  ON public.jp_invoice_drafts FOR ALL
  USING (
    org_id IN (SELECT id FROM public.jp_organizations WHERE owner_user_id = auth.uid())
  )
  WITH CHECK (
    org_id IN (SELECT id FROM public.jp_organizations WHERE owner_user_id = auth.uid())
  );

-- RLS-käytäntö ei yksin riitä (ks. migration_009:n vastaava korjaus,
-- opittu kantapään kautta live-testissä) — Postgres tarkistaa
-- perus-GRANTin ennen RLS:n arviointia. Ei tarvetta service_role-
-- oikeuksille: koko putki (lataus, poiminta, hyväksyntä) ajetaan aina
-- kirjautuneen käyttäjän omalla sessiolla, ei ulkoisen webhookin kautta.
GRANT SELECT, INSERT, UPDATE ON public.jp_invoice_drafts TO authenticated;

CREATE OR REPLACE FUNCTION public.set_invoice_draft_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS jp_invoice_drafts_set_updated_at ON public.jp_invoice_drafts;
CREATE TRIGGER jp_invoice_drafts_set_updated_at
  BEFORE UPDATE ON public.jp_invoice_drafts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_invoice_draft_updated_at();

-- ----------------------------------------------------------------
-- 3) jp_invoice_lines.service_date — rivikohtainen työn ajankohta
--
-- jp_invoices.service_date_start/end (migration_004) kattaa koko
-- laskun yhden ajanjakson, mutta kuvasta poimitulla rivillä voi olla
-- oma päivämäärä (esim. tuntilappu jolla eri päivien tunnit omilla
-- riveillään). Nullable ja valinnainen — manuaalisesti täytetyt
-- laskut käyttävät edelleen vain invoice-tason ajankohtaa.
-- ----------------------------------------------------------------
ALTER TABLE public.jp_invoice_lines
  ADD COLUMN IF NOT EXISTS service_date date;
