export interface Organization {
  id: string
  owner_user_id: string
  name: string
  business_id: string | null
  country: string
  currency: string
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
