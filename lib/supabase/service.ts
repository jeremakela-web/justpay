import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// Service-role client — bypasses RLS entirely. This is the ONE new
// trust boundary this codebase introduces (every other Supabase call
// in the app uses the anon key + the logged-in user's session, which
// naturally respects RLS). Import this ONLY from the Bink webhook
// receiver (app/api/contract/webhook/route.ts) — nowhere else.
//
// Why it's needed there specifically: Bink's webhook is called
// server-to-server, with no user session on the request at all, so
// there's no auth.uid() for RLS to key off of. The webhook route
// verifies Bink's HMAC signature on every request before using this
// client, so an unauthenticated caller can't reach the service-role
// path just by hitting the endpoint.
//
// SUPABASE_SERVICE_ROLE_KEY must be a server-only env var (never
// NEXT_PUBLIC_*) — find it in Supabase dashboard → Project Settings
// → API → service_role key, and set it in Netlify's environment
// variables, not committed anywhere.
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY (or NEXT_PUBLIC_SUPABASE_URL) is not set — the contract webhook cannot write signature results without it.'
    )
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
