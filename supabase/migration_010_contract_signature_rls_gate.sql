-- =============================================================
-- Just.Pay – migraatio 010: sopimusportin todellinen esto (RLS)
--
-- Vaatii migration_009_contract_signature_schema.sql:n ajetuksi
-- ensin (tämä käyttää sen contract_signed_at-saraketta).
--
-- jp_customers/jp_invoices/jp_invoice_lines/jp_payments vaativat
-- tästä lähtien contract_signed_at IS NOT NULL omistajuuden lisäksi.
-- Tämä on se rakenteellinen esto — suora API-kutsu ei enää pysty
-- ohittamaan porttia, koska tietokanta itse kieltäytyy palauttamasta/
-- kirjoittamasta rivejä allekirjoittamattomalle organisaatiolle.
--
-- ⚠️⚠️⚠️ TÄRKEÄ AJOITUSHUOMIO ENNEN TÄMÄN AJAMISTA ⚠️⚠️⚠️
-- Heti kun nämä RLS-käytännöt astuvat voimaan, JOKAINEN jo olemassa
-- oleva organisaatio (myös pilottiasiakkaan, jos onboarding on jo
-- tehty ja dataa on jo luotu) menettää pääsyn omiin laskuihinsa/
-- asiakkaisiinsa/maksuihinsa VÄLITTÖMÄSTI, koska contract_signed_at
-- on NULL kaikilla vanhoilla riveillä. ÄLÄ aja tätä migraatiota
-- ennen kuin koko allekirjoituspolku (Bink-sandbox-tunnukset
-- asetettu, oikea sopimus-PDF ladattu Storageen, webhook testattu
-- päästä päähän) on todistetusti toimiva — muuten lukitset olemassa
-- olevan datan ilman keinoa päästä siitä läpi.
-- =============================================================

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
