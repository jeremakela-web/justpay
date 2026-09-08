export interface Organization {
  id: string
  owner_user_id: string
  name: string
  business_id: string | null
  industry: string | null
  country: string
  currency: string
  // Kansallisvarannon palkkio tekijän laskuista, prosentteina verottomasta
  // summasta (ks. migration_007). Oletus 1.00.
  fee_rate_percent: number
  created_at: string
}

export interface Customer {
  id: string
  org_id: string
  name: string
  type: 'company' | 'individual'
  country: string
  business_id: string | null
  vat_number: string | null
  email: string | null
  address: string | null
  city: string | null
  postal_code: string | null
  created_at: string
}

export interface VatRule {
  id: string
  country: string
  category: string
  rate: number
  valid_from: string
  valid_until: string | null
}

export interface Invoice {
  id: string
  org_id: string
  customer_id: string
  invoice_number: string
  reference_number: string
  issue_date: string
  due_date: string
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled'
  subtotal: number
  vat_total: number
  total_amount: number
  currency: string
  notes: string | null
  // Tekijä (kuka teki työn) ja työn ajankohta — erillään laskuttajasta
  // (Kansallisvaranto, ks. lib/kansallisvaranto.ts). Nullable DB-tasolla,
  // pakollisuus lomakevalidoinnissa (ks. migration_004 kommentti).
  worker_name: string | null
  // Pakollinen selite, jos worker_name poikkeaa laskuttavan käyttäjän
  // omasta nimestä (ks. migration_005).
  worker_name_note: string | null
  service_date_start: string | null
  service_date_end: string | null
  // Statusmuutosten jäljitettävyys — asetetaan automaattisesti DB-triggerillä,
  // ei sovelluskoodissa (ks. migration_005).
  updated_by: string | null
  updated_at: string
  // Vaadittu selite/viite kun status muutetaan 'paid':ksi (ks. migration_005).
  paid_confirmation_note: string | null
  created_at: string
  jp_customers?: Customer
}

export interface InvoiceLine {
  id: string
  invoice_id: string
  description: string
  quantity: number
  unit_price: number
  vat_rate: number
  vat_amount: number
  line_total: number
  sort_order: number
  // Rivikohtainen työn ajankohta (ks. migration_011) — erillään
  // Invoice.service_date_start/end:stä, joka kattaa koko laskun.
  // Nullable: manuaalisesti täytetyt laskut eivät käytä tätä.
  service_date: string | null
}

// Tekijän maksun (Kansallisvaranto -> tekijä) seurantarivi. Yksi rivi per
// maksettu lasku (type='worker_payout', ks. migration_007). 'amount' on
// nettosumma tekijälle; fee_amount/fee_vat_amount ovat Kansallisvarannon
// oman (veroton) palkkion ja siitä tilitettävän ALV:n erittely — kaikki
// kolme tallennetaan erikseen auditoitavuuden vuoksi, ei vain yhtenä
// vähennettynä lukuna.
export interface Payment {
  id: string
  org_id: string
  invoice_id: string | null
  type: 'worker_payout' | 'customer_payment'
  amount: number
  fee_amount: number | null
  fee_vat_rate: number | null
  fee_vat_amount: number | null
  currency: string
  payment_date: string
  payment_method: string | null
  reference: string | null
  external_id: string | null
  notes: string | null
  status: 'pending' | 'sent' | 'confirmed'
  sent_at: string | null
  sent_note: string | null
  confirmed_at: string | null
  confirmed_note: string | null
  created_at: string
}

// Kansallisvarannon tekijälle antama kuitti/lasku palvelumaksusta
// (1 % + ALV), jonka tekijä tarvitsee omaan verotukseensa. Luodaan
// automaattisesti DB-triggerillä kun vastaava jp_payments-rivi
// (payout_id) siirtyy tilaan 'confirmed' — ei sovelluskoodissa
// (ks. migration_008).
export interface ServiceFeeDocument {
  id: string
  org_id: string
  source_invoice_id: string
  payout_id: string
  document_number: string
  issue_date: string
  fee_amount: number
  fee_vat_rate: number
  fee_vat_amount: number
  total_amount: number
  currency: string
  created_at: string
}

// Yksi kuvasta-poimittu laskurivi (ks. migration_011). confidence on
// mallin oma 0-100-arvio TÄMÄN rivin lukuvarmuudesta kokonaisuutena —
// ei erikseen per kenttä. Rivin summa (quantity × unit_price) lasketaan
// aina sovelluskoodissa, ei koskaan pyydetä mallilta.
export interface ExtractedDraftLine {
  description: string
  quantity: number
  unit_price: number
  vat_rate: number
  service_date: string | null
  confidence: number
}

export interface ExtractedDraftData {
  lines: ExtractedDraftLine[]
  // Mallin paras arvaus asiakkaasta/tekijästä kuvan tekstin perusteella
  // (esim. kuitin yrityksen nimi, tuntilapun tekijän nimi) — ei
  // sidottu mihinkään olemassa olevaan jp_customers-riviin tässä
  // vaiheessa, vain tarkistusnäkymän esitäyttöä ja
  // new_customer-poikkeamatarkistusta varten.
  customer_suggestion: string | null
  worker_suggestion: string | null
  // Sovelluskoodin laskemat rivien summista, ei koskaan mallin
  // tulostetta.
  computed_subtotal: number
  computed_vat_total: number
  computed_total: number
}

export interface InvoiceDraftFieldConfidence {
  lines: { index: number; confidence: number }[]
}

export interface InvoiceDraftValidationFlags {
  new_customer?: boolean
  // Aiempien laskujen keskiarvoon verrattuna poikkeuksellisen suuri/
  // pieni summa — ks. app/api/invoices/extract/route.ts:n kommentti
  // kynnysarvosta. Puuttuu (ei false) kun vertailuun ei ollut
  // riittävästi historiaa.
  unusual_amount?: boolean
  // Rivi-indeksit, joiden kuvaus ei muistuta mitään aiempaa riviä
  // tässä organisaatiossa — heuristiikka, ei tarkka luokittelija.
  out_of_pattern_lines?: number[]
  // Toisen samansisältöisen (sama content_hash) draftin id samassa
  // organisaatiossa. Lippu, ei esto — kaksoiskappale on laillinen.
  duplicate_of_draft_id?: string | null
}

export interface InvoiceDraft {
  id: string
  org_id: string
  status: 'uploaded' | 'processing' | 'ready_for_review' | 'approved' | 'rejected' | 'failed'
  source_file_path: string
  source_file_name: string
  source_content_type: string
  content_hash: string
  llm_provider: string
  llm_model: string | null
  extracted_data: ExtractedDraftData | null
  field_confidence: InvoiceDraftFieldConfidence | null
  validation_flags: InvoiceDraftValidationFlags | null
  reviewed_at: string | null
  resulting_invoice_id: string | null
  error_message: string | null
  created_at: string
  updated_at: string
}
