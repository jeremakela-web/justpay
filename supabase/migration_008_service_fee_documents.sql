-- =============================================================
-- Just.Pay – migraatio 008: Kansallisvarannon palvelumaksukuitti
-- tekijälle (service-fee document)
--
-- Tausta: käyttäjä vahvisti, että Kansallisvarannon on annettava
-- tekijälle erillinen kuitti/lasku 1 % + ALV -palkkiosta, koska
-- tekijä tarvitsee sen omaan verotukseensa vähennyskelpoisena
-- kuluna — pelkkä nettotilitys ei riitä.
--
-- Tätä EI toteuteta lisäämällä rivejä jp_invoices-tauluun: se
-- mallintaa "org laskuttaa omaa asiakastaan" (org_id -> customer_id,
-- molemmat saman vuokralaisen alla). Tässä suunta on päinvastainen
-- (Kansallisvaranto laskuttaa tekijän organisaatiota), eikä
-- Kansallisvaranto ole jp_organizations-rivi/vuokralainen tässä
-- monivuokralaisjärjestelmässä. Erillinen, suppea taulu pitää roolit
-- selkeinä sekaantumatta jp_invoicesin omaan (tekijä -> asiakas)
-- numerointiin tai listauksiin.
--
-- Numerointi on oma, "KV-VVVV-NNNNN" -muotoinen, YKSI globaali
-- Kansallisvarannon juokseva sarja (ei per-org, koska Kansallisvaranto
-- on yksi oikeushenkilö — sen omalla kirjanpidolla pitää olla yksi
-- juokseva numerointi, ei per-tekijä). Muoto on tarkoituksella
-- täysin erilainen kuin tekijä-laskujen "VVVV-NNNN", joten numerot
-- eivät voi koskaan törmätä edes sattumalta.
--
-- Rivi luodaan automaattisesti triggerillä kun jp_payments-rivin
-- status muuttuu ensimmäistä kertaa 'confirmed':ksi — ei
-- sovelluskoodin vastuulla, jottei kuittia voi unohtaa luoda tai
-- luoda kahdesti samalle maksulle.
-- =============================================================

-- jp_payments tarvitsee tallennetun ALV-kannan (ei vain euromäärän),
-- jotta kuitille voidaan näyttää "ALV 25,5 %" kuten pääl askulla,
-- eikä sitä tarvitse laskea uudelleen kuitin luontihetkellä.
ALTER TABLE public.jp_payments
  ADD COLUMN fee_vat_rate numeric(5,2);

CREATE SEQUENCE public.jp_service_fee_document_seq START 1;

CREATE TABLE public.jp_service_fee_documents (
  id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid          NOT NULL REFERENCES public.jp_organizations(id) ON DELETE CASCADE,
  source_invoice_id  uuid          NOT NULL REFERENCES public.jp_invoices(id),
  payout_id          uuid          NOT NULL REFERENCES public.jp_payments(id),
  document_number    text          NOT NULL UNIQUE,
  issue_date         date          NOT NULL DEFAULT CURRENT_DATE,
  fee_amount         numeric(12,2) NOT NULL,
  fee_vat_rate       numeric(5,2)  NOT NULL,
  fee_vat_amount     numeric(12,2) NOT NULL,
  total_amount       numeric(12,2) NOT NULL,
  currency           text          NOT NULL DEFAULT 'EUR',
  created_at         timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX jp_service_fee_documents_payout_idx ON public.jp_service_fee_documents(payout_id);
CREATE INDEX        jp_service_fee_documents_org_idx    ON public.jp_service_fee_documents(org_id);

ALTER TABLE public.jp_service_fee_documents ENABLE ROW LEVEL SECURITY;

-- Vain luku omalle organisaatiolle — ei INSERT/UPDATE/DELETE-käytäntöä,
-- ainoa kirjoitusreitti on alla oleva SECURITY DEFINER-trigger.
CREATE POLICY "service_fee_documents: org-omistaja voi lukea omansa"
  ON public.jp_service_fee_documents FOR SELECT
  USING (
    org_id IN (SELECT id FROM public.jp_organizations WHERE owner_user_id = auth.uid())
  );

CREATE OR REPLACE FUNCTION public.create_service_fee_document()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_number text;
BEGIN
  IF NEW.type = 'worker_payout'
     AND NEW.status = 'confirmed'
     AND OLD.status IS DISTINCT FROM 'confirmed'
     AND NOT EXISTS (
       SELECT 1 FROM public.jp_service_fee_documents WHERE payout_id = NEW.id
     )
  THEN
    v_number := 'KV-' || EXTRACT(YEAR FROM now())::text || '-' ||
                LPAD(nextval('public.jp_service_fee_document_seq')::text, 5, '0');

    INSERT INTO public.jp_service_fee_documents (
      org_id, source_invoice_id, payout_id, document_number,
      fee_amount, fee_vat_rate, fee_vat_amount, total_amount, currency
    ) VALUES (
      NEW.org_id, NEW.invoice_id, NEW.id, v_number,
      COALESCE(NEW.fee_amount, 0),
      COALESCE(NEW.fee_vat_rate, 0),
      COALESCE(NEW.fee_vat_amount, 0),
      COALESCE(NEW.fee_amount, 0) + COALESCE(NEW.fee_vat_amount, 0),
      NEW.currency
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER jp_payments_create_service_fee_document
  AFTER UPDATE ON public.jp_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.create_service_fee_document();
