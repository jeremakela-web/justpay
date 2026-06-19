'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { FileText, Users, LogOut, Menu, X, Building2 } from 'lucide-react'

const navItems = [
  { href: '/', label: 'Laskut', icon: FileText },
  { href: '/customers', label: 'Asiakkaat', icon: Users },
]

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const supabase = createClient()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [orgName, setOrgName] = useState<string | null>(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    const init = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        router.push('/login')
        return
      }

      const { data: org } = await supabase
        .from('jp_organizations')
        .select('id, name')
        .eq('owner_user_id', user.id)
        .maybeSingle()

      if (!org && pathname !== '/onboarding') {
        router.push('/onboarding')
        return
      }

      setOrgName(org?.name ?? null)
      setChecking(false)
    }
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  if (checking && pathname !== '/onboarding') {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-zinc-950">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex lg:flex-col w-60 bg-zinc-900 border-r border-zinc-800">
        <div className="flex items-center h-16 px-6 border-b border-zinc-800">
          <span className="text-xl font-bold tracking-tight">
            Just<span className="text-green-500">.</span>Pay
          </span>
        </div>

        {orgName && (
          <div className="px-4 py-3 border-b border-zinc-800">
            <div className="flex items-center gap-2 px-2">
              <Building2 size={14} className="text-zinc-500 shrink-0" />
              <span className="text-xs text-zinc-400 truncate">{orgName}</span>
            </div>
          </div>
        )}

        <nav className="flex-1 p-3 space-y-0.5">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive =
              item.href === '/'
                ? pathname === '/' || pathname.startsWith('/invoices')
                : pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-green-500/10 text-green-400'
                    : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
                }`}
              >
                <Icon size={16} />
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="p-3 border-t border-zinc-800">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-zinc-400 hover:text-white hover:bg-zinc-800 w-full transition-colors"
          >
            <LogOut size={16} />
            Kirjaudu ulos
          </button>
        </div>
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/60 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="fixed inset-y-0 left-0 z-50 w-60 flex flex-col bg-zinc-900 border-r border-zinc-800 lg:hidden">
            <div className="flex items-center justify-between h-16 px-6 border-b border-zinc-800">
              <span className="text-xl font-bold">
                Just<span className="text-green-500">.</span>Pay
              </span>
              <button
                onClick={() => setSidebarOpen(false)}
                className="text-zinc-400 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-0.5">
              {navItems.map((item) => {
                const Icon = item.icon
                const isActive =
                  item.href === '/'
                    ? pathname === '/' || pathname.startsWith('/invoices')
                    : pathname.startsWith(item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setSidebarOpen(false)}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                      isActive
                        ? 'bg-green-500/10 text-green-400'
                        : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
                    }`}
                  >
                    <Icon size={16} />
                    {item.label}
                  </Link>
                )
              })}
            </nav>
            <div className="p-3 border-t border-zinc-800">
              <button
                onClick={handleLogout}
                className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-zinc-400 hover:text-white hover:bg-zinc-800 w-full"
              >
                <LogOut size={16} />
                Kirjaudu ulos
              </button>
            </div>
          </aside>
        </>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile header */}
        <header className="lg:hidden flex items-center h-14 px-4 border-b border-zinc-800 bg-zinc-900">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-zinc-400 hover:text-white mr-4"
          >
            <Menu size={20} />
          </button>
          <span className="text-lg font-bold">
            Just<span className="text-green-500">.</span>Pay
          </span>
        </header>

        <main className="flex-1 overflow-auto p-4 lg:p-6">{children}</main>
      </div>
    </div>
  )
}
