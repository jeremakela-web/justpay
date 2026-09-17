import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options as Parameters<typeof supabaseResponse.cookies.set>[2])
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const url = request.nextUrl.clone()
  const isAuthRoute =
    url.pathname.startsWith('/login') ||
    url.pathname.startsWith('/auth/') ||
    url.pathname.startsWith('/terms')

  // Bink calls this server-to-server with no session cookie at all — the
  // !user redirect below would send every real webhook delivery straight
  // to /login, 307, never reaching the route's own signature verification.
  // Found while diagnosing why a signed document could never actually
  // land: even a perfect signature confirmation would never have reached
  // the handler. The route itself is the real gate (HMAC signature check,
  // service-role client) — this middleware has no business touching it.
  if (url.pathname === '/api/contract/webhook') {
    return supabaseResponse
  }

  if (!user && url.pathname === '/') {
    return NextResponse.rewrite(new URL('/landing.html', request.url))
  }

  if (!user && !isAuthRoute) {
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (user && url.pathname === '/login') {
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|html)$).*)',
  ],
}
