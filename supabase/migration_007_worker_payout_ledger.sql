-- =============================================================
-- Just.Pay – migraatio 007: tekijän maksun (payout) tosiasiallinen
-- seuranta jp_payments-tauluun
--
-- Tausta: Kansallisvaranto -> tekijä -rahaliikettä ei seurattu
-- lainkaan. jp_payments oli tyhjä "tulevaisuutta varten" -kanta,
-- eikä sillä ollut RLS-käytäntöä lainkaan (turvaton nyt kun taulua
-- oikeasti käytetään — korjataan tässä samalla).
--
-- Maksun laskentamalli (vahvistettu käyttäjältä):
--   fee_amount      = jp_invoices.subtotal * jp_organizations.fee_rate_percent / 100
--                      (Kansallisvarannon oma palkkio, veroton)
--   fee_vat_amount  = fee_amount * (Suomen yleinen ALV-kanta / 100)
--                      (ALV, jonka Kansallisvaranto tilittää valtiolle
--                      omasta palkkiostaan — HUOM: aina Suomen kanta,
--                      koska Kansallisvaranto on suomalainen yhtiö,
--                      riippumatta tekijän organisaation maasta)
--   amount          = jp_invoices.subtotal - fee_amount - fee_vat_amount
--                      (nettosumma tekijälle — tallennetaan olemassa
--                      olevaan amount-sarakkeeseen)
--
-- KORJATTU (tuotannon virheen jälkeen): CREATE POLICY ei ole
-- idempotentti Postgresissa (ei ole IF NOT EXISTS -muotoa), ja
-- tämä migraatio ehti jo ajautua kertaalleen läpi tuotannossa ennen
-- kuin sitä yritettiin ajaa toistamiseen — CREATE POLICY törmäsi
-- "already exists" -virheeseen ja koko skripti keskeytyi siihen.
-- Jokainen lause tässä on nyt turvallinen ajaa uudelleen riippumatta
-- siitä, mikä osa on jo olemassa (DROP POLICY IF EXISTS + CREATE
-- POLICY, ADD COLUMN IF NOT EXISTS, CREATE ... IF NOT EXISTS).
-- =============================================================

-- ----------------------------------------------------------------
-- 1) RLS jp_payments-taululle — puuttui kokonaan aiemmin
-- ----------------------------------------------------------------
ALTER TABLE public.jp_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payments: org-omistaja pääsee käsiksi" ON public.jp_payments;

CREATE POLICY "payments: org-omistaja pääsee käsiksi"
  ON public.jp_payments FOR ALL
  USING (
    org_id IN (SELECT id FROM public.jp_organizations WHERE owner_user_id = auth.uid())
  )
  WITH CHECK (
    org_id IN (SELECT id FROM public.jp_organizations WHERE owner_user_id = auth.uid())
  );

-- ----------------------------------------------------------------
-- 2) Palkkioprosentti per organisaatio (oletus 1 %, muokattavissa
--    myöhempää tasoportaikkoa varten ilman uutta migraatiota)
-- ----------------------------------------------------------------
ALTER TABLE public.jp_organizations
  ADD COLUMN IF NOT EXISTS fee_rate_percent numeric(5,2) NOT NULL DEFAULT 1.00;

-- ----------------------------------------------------------------
-- 3) jp_payments: maksutapahtuman tyyppi + palkkioerittely + status
-- ----------------------------------------------------------------
ALTER TABLE public.jp_payments
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'worker_payout'
    CHECK (type IN ('worker_payout', 'customer_payment')),
  ADD COLUMN IF NOT EXISTS fee_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS fee_vat_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'confirmed')),
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS sent_note text,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_note text;

COMMENT ON COLUMN public.jp_payments.amount IS
  'worker_payout-riveille: nettosumma tekijälle (subtotal - fee_amount - fee_vat_amount). customer_payment-riveille (ei vielä käytössä): asiakkaan maksama summa.';

-- Yksi payout-rivi per lasku — estää tuplarivit jos "merkitse maksetuksi"
-- -toiminto jostain syystä laukeaisi useasti samalle laskulle.
CREATE UNIQUE INDEX IF NOT EXISTS jp_payments_worker_payout_unique_idx
  ON public.jp_payments(invoice_id)
  WHERE type = 'worker_payout';
