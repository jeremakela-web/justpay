-- =============================================================
-- Just.Pay – migraatio 002: jp_addon_services (kumppanipalvelukatalog)
-- HUOM: migration_001:ssä on jp_addon_services eri skeemalla
-- (org-kohtainen integrointirekisteri). Se pudotetaan tässä ja
-- korvataan globaalilla kumppanipalvelukatalogilla.
-- =============================================================

DROP TABLE IF EXISTS public.jp_addon_services CASCADE;

CREATE TABLE public.jp_addon_services (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  category          text        NOT NULL
                                  CHECK (category IN ('insurance', 'collection', 'financing')),
  provider_name     text        NOT NULL,
  url               text        NOT NULL,
  pricing_notes     text,
  eligibility_notes text,
  active            boolean     NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX jp_addon_services_category_idx
  ON public.jp_addon_services(category) WHERE active = true;

ALTER TABLE public.jp_addon_services ENABLE ROW LEVEL SECURITY;

-- Kaikki kirjautuneet voivat lukea katalogia (kuten jp_vat_rules)
CREATE POLICY "addon_services: authenticated read"
  ON public.jp_addon_services FOR SELECT
  USING (auth.role() = 'authenticated');

-- Kirjoitusoikeus vain service_role-adminille
GRANT SELECT ON public.jp_addon_services TO authenticated;


-- ================================================================
-- ALKUDATA: kumppanipalvelut (muokkaa Supabase-hallintapaneelissa)
-- ================================================================
INSERT INTO public.jp_addon_services
  (category, provider_name, url, pricing_notes, eligibility_notes)
VALUES
  ('insurance', 'If Vahinkovakuutus',
   'https://www.if.fi/yritykset',
   'Maksetaan kuukausittain laskutuksen mukaan',
   'Soveltuu yrityksille ja kevytyrittäjille'),

  ('insurance', 'LähiTapiola Yrittäjävakuutus',
   'https://www.lahitapiola.fi/yritys',
   'Kiinteä kuukausimaksu 19–49 €/kk',
   'Vaatii Y-tunnuksen tai toiminimen'),

  ('collection', 'Intrum Suomi',
   'https://www.intrum.fi',
   'Ei perintäkuluja lähettäjälle — velallinen maksaa',
   'Yli 30 pv erääntyneet laskut, yritys- tai kuluttajasaatavat'),

  ('collection', 'Lindorff',
   'https://www.lindorff.fi/yrityksille',
   'Provisiopohjainen, ei kiinteitä kuluja',
   'Soveltuu sekä yritys- että kuluttajasaataviin'),

  ('financing', 'Puro Finance Laskurahoitus',
   'https://www.purofinance.fi',
   '1–3 % laskun summasta',
   'Laskut yli 500 €, yritysasiakkaat'),

  ('financing', 'Svea Laskurahoitus',
   'https://www.svea.com/fi',
   'Räätälöity hinnoittelu yli 5 000 €/kk laskuttajille',
   'B2B-laskut, yritys toiminut yli 6 kuukautta');
