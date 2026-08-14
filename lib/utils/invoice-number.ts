import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Generates the next invoice number for an org in format YYYY-NNNN.
 *
 * Uses the next_invoice_number(org_id, year) DB function (see
 * migration_006_invoice_number_sequence.sql), which atomically
 * increments a per-(org, year) counter via a single
 * INSERT ... ON CONFLICT DO UPDATE ... RETURNING statement. This
 * replaces the previous read-highest-then-increment approach, which
 * had a real (if rare) race condition: two invoices saved concurrently
 * for the same org could compute the same "next" number. The
 * jp_invoices_unique_number constraint caught that as a hard insert
 * failure, but didn't prevent it from happening.
 */
export async function generateInvoiceNumber(
  supabase: SupabaseClient,
  orgId: string
): Promise<string> {
  const year = new Date().getFullYear()

  const { data, error } = await supabase.rpc('next_invoice_number', {
    p_org_id: orgId,
    p_year: year,
  })

  if (error) throw error

  return `${year}-${String(data as number).padStart(4, '0')}`
}
