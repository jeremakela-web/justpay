import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Generates the next invoice number for an org in format YYYY-NNNN.
 * Queries the highest existing number for the current year and increments.
 */
export async function generateInvoiceNumber(
  supabase: SupabaseClient,
  orgId: string
): Promise<string> {
  const year = new Date().getFullYear()
  const prefix = `${year}-`

  const { data } = await supabase
    .from('jp_invoices')
    .select('invoice_number')
    .eq('org_id', orgId)
    .like('invoice_number', `${prefix}%`)
    .order('invoice_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data?.invoice_number) {
    return `${year}-0001`
  }

  const parts = data.invoice_number.split('-')
  const lastNum = parseInt(parts[parts.length - 1]) || 0
  return `${year}-${String(lastNum + 1).padStart(4, '0')}`
}
