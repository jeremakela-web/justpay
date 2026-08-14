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
