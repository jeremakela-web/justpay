-- =============================================================
-- Just.Pay – täydellinen tietokantamigraatio
-- Aja Supabase SQL Editorissa: https://supabase.com/dashboard
-- =============================================================

-- ----------------------------------------------------------------
-- 0. Esivalmistelut
-- ----------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- ----------------------------------------------------------------
-- 1. jp_organizations
--    Yksi organisaatio per käyttäjä (owner_user_id = auth.uid())
-- ----------------------------------------------------------------
CREATE TABLE public.jp_organizations (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id   uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  business_id     text,
  country         text        NOT NULL DEFAULT 'FI',
  currency        text        NOT NULL DEFAULT 'EUR',
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Yksi org per käyttäjä (sovellus käyttää .maybeSingle())
CREATE UNIQUE INDEX jp_organizations_owner_idx  ON public.jp_organizations(owner_user_id);
CREATE INDEX        jp_organizations_country_idx ON public.jp_organizations(country);

ALTER TABLE public.jp_organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org: owner voi lukea ja muokata omaa"
  ON public.jp_organizations FOR ALL
  USING     (owner_user_id = auth.uid())
  WITH CHECK(owner_user_id = auth.uid());


-- ----------------------------------------------------------------
-- 2. jp_customers
-- ----------------------------------------------------------------
CREATE TABLE public.jp_customers (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid        NOT NULL REFERENCES public.jp_organizations(id) ON DELETE CASCADE,
  name          text        NOT NULL,
  type          text        NOT NULL DEFAULT 'company'
                              CHECK (type IN ('company', 'individual')),
  country       text        NOT NULL DEFAULT 'FI',
  business_id   text,
  vat_number    text,
  email         text,
  address       text,
  city          text,
  postal_code   text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX jp_customers_org_idx  ON public.jp_customers(org_id);
CREATE INDEX jp_customers_name_idx ON public.jp_customers(org_id, name);

ALTER TABLE public.jp_customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "customers: org-omistaja pääsee käsiksi"
  ON public.jp_customers FOR ALL
  USING (
    org_id IN (SELECT id FROM public.jp_organizations WHERE owner_user_id = auth.uid())
  )
  WITH CHECK (
    org_id IN (SELECT id FROM public.jp_organizations WHERE owner_user_id = auth.uid())
  );


-- ----------------------------------------------------------------
-- 3. jp_vat_rules
--    Julkinen lukuoikeus kaikille kirjautuneille käyttäjille.
--    Kirjoitusoikeus vain palveluadminille (service_role).
-- ----------------------------------------------------------------
CREATE TABLE public.jp_vat_rules (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  country     text        NOT NULL,
  category    text        NOT NULL,
  rate        numeric(5,2) NOT NULL CHECK (rate >= 0 AND rate <= 100),
  valid_from  date        NOT NULL,
  valid_until date,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX jp_vat_rules_unique_idx    ON public.jp_vat_rules(country, category, valid_from);
CREATE INDEX        jp_vat_rules_lookup_idx    ON public.jp_vat_rules(country, valid_from, valid_until);

ALTER TABLE public.jp_vat_rules ENABLE ROW LEVEL SECURITY;

-- Kaikki kirjautuneet voivat lukea ALV-sääntöjä
CREATE POLICY "vat_rules: authenticated read"
  ON public.jp_vat_rules FOR SELECT
  USING (auth.role() = 'authenticated');


-- ----------------------------------------------------------------
-- 4. jp_invoices
-- ----------------------------------------------------------------
CREATE TABLE public.jp_invoices (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid         NOT NULL REFERENCES public.jp_organizations(id) ON DELETE CASCADE,
  customer_id      uuid         NOT NULL REFERENCES public.jp_customers(id),
  invoice_number   text         NOT NULL,
  reference_number text         NOT NULL,
  issue_date       date         NOT NULL,
  due_date         date         NOT NULL,
  status           text         NOT NULL DEFAULT 'draft'
                                  CHECK (status IN ('draft','sent','paid','overdue','cancelled')),
  subtotal         numeric(12,2) NOT NULL DEFAULT 0,
  vat_total        numeric(12,2) NOT NULL DEFAULT 0,
  total_amount     numeric(12,2) NOT NULL DEFAULT 0,
  currency         text         NOT NULL DEFAULT 'EUR',
  notes            text,
  created_at       timestamptz  NOT NULL DEFAULT now(),

  -- Varmistaa ettei samaa laskunumeroa synny kahdesti (kilpajuoksutilanteissa)
  CONSTRAINT jp_invoices_unique_number UNIQUE (org_id, invoice_number)
);

CREATE INDEX jp_invoices_org_idx        ON public.jp_invoices(org_id, created_at DESC);
CREATE INDEX jp_invoices_org_status_idx ON public.jp_invoices(org_id, status);
CREATE INDEX jp_invoices_customer_idx   ON public.jp_invoices(customer_id);

ALTER TABLE public.jp_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invoices: org-omistaja pääsee käsiksi"
  ON public.jp_invoices FOR ALL
  USING (
    org_id IN (SELECT id FROM public.jp_organizations WHERE owner_user_id = auth.uid())
  )
  WITH CHECK (
    org_id IN (SELECT id FROM public.jp_organizations WHERE owner_user_id = auth.uid())
  );


-- ----------------------------------------------------------------
-- 5. jp_invoice_lines
-- ----------------------------------------------------------------
CREATE TABLE public.jp_invoice_lines (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id   uuid          NOT NULL REFERENCES public.jp_invoices(id) ON DELETE CASCADE,
  description  text          NOT NULL,
  quantity     numeric(12,4) NOT NULL DEFAULT 1,
  unit_price   numeric(12,4) NOT NULL DEFAULT 0,
  vat_rate     numeric(5,2)  NOT NULL DEFAULT 0,
  vat_amount   numeric(12,2) NOT NULL DEFAULT 0,
  line_total   numeric(12,2) NOT NULL DEFAULT 0,
  sort_order   integer       NOT NULL DEFAULT 0,
  created_at   timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX jp_invoice_lines_invoice_idx ON public.jp_invoice_lines(invoice_id, sort_order);

ALTER TABLE public.jp_invoice_lines ENABLE ROW LEVEL SECURITY;

-- Pääsy laskuriveihin laskun → organisaation kautta
CREATE POLICY "invoice_lines: org-omistaja pääsee käsiksi"
  ON public.jp_invoice_lines FOR ALL
  USING (
    invoice_id IN (
      SELECT i.id FROM public.jp_invoices i
      JOIN   public.jp_organizations o ON o.id = i.org_id
      WHERE  o.owner_user_id = auth.uid()
    )
  )
  WITH CHECK (
    invoice_id IN (
      SELECT i.id FROM public.jp_invoices i
      JOIN   public.jp_organizations o ON o.id = i.org_id
      WHERE  o.owner_user_id = auth.uid()
    )
  );


-- ----------------------------------------------------------------
-- 6. jp_payments
--    Tulevaisuutta varten (Stripe-integraatio ym.)
-- ----------------------------------------------------------------
CREATE TABLE public.jp_payments (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid          NOT NULL REFERENCES public.jp_organizations(id) ON DELETE CASCADE,
  invoice_id     uuid          REFERENCES public.jp_invoices(id),
  amount         numeric(12,2) NOT NULL,
  currency       text          NOT NULL DEFAULT 'EUR',
  payment_date   date          NOT NULL DEFAULT CURRENT_DATE,
  payment_method text,         -- 'stripe', 'bank_transfer', 'cash', ...
  reference      text,
  external_id    text,         -- Stripe payment intent id tms.
  notes          text,
  created_at     timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX jp_payments_org_idx     ON public.jp_payments(org_id);
CREATE INDEX jp_payments_invoice_idx ON public.jp_payments(invoice_id);

ALTER TABLE public.jp_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payments: org-omistaja pääsee käsiksi"
  ON public.jp_payments FOR ALL
  USING (
    org_id IN (SELECT id FROM public.jp_organizations WHERE owner_user_id = auth.uid())
  )
  WITH CHECK (
    org_id IN (SELECT id FROM public.jp_organizations WHERE owner_user_id = auth.uid())
  );


-- ----------------------------------------------------------------
-- 7. jp_payroll_rulesets
--    Palkanlaskentasäännöt (myöhempää vaihetta varten)
-- ----------------------------------------------------------------
CREATE TABLE public.jp_payroll_rulesets (
  id                      uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  uuid          NOT NULL REFERENCES public.jp_organizations(id) ON DELETE CASCADE,
  name                    text          NOT NULL,
  country                 text          NOT NULL DEFAULT 'FI',
  tax_rate                numeric(5,2)  NOT NULL DEFAULT 0,
  pension_rate            numeric(5,2)  NOT NULL DEFAULT 0,
  unemployment_rate       numeric(5,2)  NOT NULL DEFAULT 0,
  health_insurance_rate   numeric(5,2)  NOT NULL DEFAULT 0,
  is_default              boolean       NOT NULL DEFAULT false,
  valid_from              date          NOT NULL DEFAULT CURRENT_DATE,
  valid_until             date,
  created_at              timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX jp_payroll_rulesets_org_idx ON public.jp_payroll_rulesets(org_id);

ALTER TABLE public.jp_payroll_rulesets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payroll_rulesets: org-omistaja pääsee käsiksi"
  ON public.jp_payroll_rulesets FOR ALL
  USING (
    org_id IN (SELECT id FROM public.jp_organizations WHERE owner_user_id = auth.uid())
  )
  WITH CHECK (
    org_id IN (SELECT id FROM public.jp_organizations WHERE owner_user_id = auth.uid())
  );


-- ----------------------------------------------------------------
-- 8. jp_payroll_entries
--    Palkkasuoritteet per työntekijä per palkkakuukausi
-- ----------------------------------------------------------------
CREATE TABLE public.jp_payroll_entries (
  id                        uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                    uuid          NOT NULL REFERENCES public.jp_organizations(id) ON DELETE CASCADE,
  ruleset_id                uuid          REFERENCES public.jp_payroll_rulesets(id),
  employee_name             text          NOT NULL,
  employee_id               text,         -- sisäinen tunniste
  period_start              date          NOT NULL,
  period_end                date          NOT NULL,
  gross_salary              numeric(12,2) NOT NULL,
  tax_amount                numeric(12,2) NOT NULL DEFAULT 0,
  pension_amount            numeric(12,2) NOT NULL DEFAULT 0,
  unemployment_amount       numeric(12,2) NOT NULL DEFAULT 0,
  health_insurance_amount   numeric(12,2) NOT NULL DEFAULT 0,
  net_salary                numeric(12,2) NOT NULL DEFAULT 0,
  status                    text          NOT NULL DEFAULT 'draft'
                                            CHECK (status IN ('draft','approved','paid')),
  notes                     text,
  created_at                timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX jp_payroll_entries_org_idx    ON public.jp_payroll_entries(org_id);
CREATE INDEX jp_payroll_entries_period_idx ON public.jp_payroll_entries(org_id, period_start);

ALTER TABLE public.jp_payroll_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payroll_entries: org-omistaja pääsee käsiksi"
  ON public.jp_payroll_entries FOR ALL
  USING (
    org_id IN (SELECT id FROM public.jp_organizations WHERE owner_user_id = auth.uid())
  )
  WITH CHECK (
    org_id IN (SELECT id FROM public.jp_organizations WHERE owner_user_id = auth.uid())
  );


-- ----------------------------------------------------------------
-- 9. jp_addon_services
--    Lisäpalvelujen aktivointirekisteri (Stripe, Resend ym.)
-- ----------------------------------------------------------------
CREATE TABLE public.jp_addon_services (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES public.jp_organizations(id) ON DELETE CASCADE,
  service_type    text        NOT NULL,   -- 'stripe', 'resend', 'maventa_einvoice', ...
  is_active       boolean     NOT NULL DEFAULT true,
  config          jsonb,                  -- palvelukohtainen konfiguraatio
  activated_at    timestamptz NOT NULL DEFAULT now(),
  deactivated_at  timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX jp_addon_services_org_idx ON public.jp_addon_services(org_id);
-- Vain yksi aktiivinen instanssi per palvelutyyppi per organisaatio
CREATE UNIQUE INDEX jp_addon_services_active_unique_idx
  ON public.jp_addon_services(org_id, service_type)
  WHERE is_active = true;

ALTER TABLE public.jp_addon_services ENABLE ROW LEVEL SECURITY;

CREATE POLICY "addon_services: org-omistaja pääsee käsiksi"
  ON public.jp_addon_services FOR ALL
  USING (
    org_id IN (SELECT id FROM public.jp_organizations WHERE owner_user_id = auth.uid())
  )
  WITH CHECK (
    org_id IN (SELECT id FROM public.jp_organizations WHERE owner_user_id = auth.uid())
  );


-- ================================================================
-- ALKUDATA: Suomen ALV-kannat
-- ================================================================

-- Nykyiset kannat 2024–2025 alkaen (voimassa 2026)
INSERT INTO public.jp_vat_rules (country, category, rate, valid_from, valid_until) VALUES
  -- Yleinen kanta korotettiin 24 % → 25,5 % 1.9.2024
  ('FI', 'Yleinen',              25.5, '2024-09-01', NULL),
  -- Elintarvikkeet, ravintolat: 14 % → 13,5 % 1.1.2025
  ('FI', 'Elintarvikkeet',       13.5, '2025-01-01', NULL),
  -- Kirjat, lääkkeet, liikunta, kulttuuri: 10 % (ei muutosta)
  ('FI', 'Kirjat ja lääkkeet',   10.0, '2024-09-01', NULL),
  -- Verovapaa / nollavero
  ('FI', 'Verovapaa',             0.0, '1994-01-01', NULL);

-- Historialliset kannat vanhojen laskujen kirjauksille
INSERT INTO public.jp_vat_rules (country, category, rate, valid_from, valid_until) VALUES
  ('FI', 'Yleinen',              24.0, '2013-01-01', '2024-08-31'),
  ('FI', 'Elintarvikkeet',       14.0, '2013-01-01', '2024-12-31'),
  ('FI', 'Kirjat ja lääkkeet',   10.0, '2013-01-01', '2024-08-31');
