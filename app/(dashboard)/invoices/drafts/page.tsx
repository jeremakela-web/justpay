'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { InvoiceDraft } from '@/types/database'
import { ScanLine, Upload, Loader2 } from 'lucide-react'

const STATUS_LABEL: Record<InvoiceDraft['status'], string> = {
  uploaded: 'Ladattu',
  processing: 'Luetaan...',
  ready_for_review: 'Tarkistettavana',
  approved: 'Hyväksytty',
  rejected: 'Hylätty',
  failed: 'Epäonnistui',
}

const STATUS_STYLE: Record<InvoiceDraft['status'], string> = {
  uploaded: 'bg-zinc-700 text-zinc-300',
  processing: 'bg-blue-500/10 text-blue-400',
  ready_for_review: 'bg-amber-500/10 text-amber-400',
  approved: 'bg-green-500/10 text-green-400',
  rejected: 'bg-zinc-700 text-zinc-400',
  failed: 'bg-red-500/10 text-red-400',
}

export default function InvoiceDraftsPage() {
  const router = useRouter()
  const supabase = createClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [drafts, setDrafts] = useState<InvoiceDraft[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const fetchDrafts = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return

    const { data: org } = await supabase
      .from('jp_organizations')
      .select('id')
      .eq('owner_user_id', user.id)
      .maybeSingle()
    if (!org) return

    const { data } = await supabase
      .from('jp_invoice_drafts')
      .select('*')
      .eq('org_id', org.id)
      .order('created_at', { ascending: false })

    setDrafts(data || [])
    setLoading(false)
  }

  useEffect(() => {
    fetchDrafts()
  }, [] ) // eslint-disable-line react-hooks/exhaustive-deps

  const handleFile = async (file: File) => {
    setUploading(true)
    setUploadError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/invoices/extract', { method: 'POST', body: formData })
      const data = (await res.json()) as { draft?: InvoiceDraft; error?: string }

      if (!res.ok || data.error || !data.draft) {
        setUploadError(data.error ?? 'Kuvan käsittely epäonnistui.')
        setUploading(false)
        return
      }

      router.push(`/invoices/drafts/${data.draft.id}`)
    } catch {
      setUploadError('Kuvan käsittely epäonnistui. Yritä uudelleen.')
      setUploading(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <ScanLine className="text-green-500" size={24} />
          <h1 className="text-xl font-semibold">Kuvista poimitut laskut</h1>
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
          {uploading ? 'Luetaan kuvaa...' : 'Lataa kuva'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) handleFile(file)
            e.target.value = ''
          }}
        />
      </div>

      <p className="text-sm text-zinc-400 mb-6">
        Lataa kuva kuitista, hinnastosta tai tuntilapusta — Claude lukee siitä laskurivit,
        mutta mitään ei viedä oikeaksi laskuksi ennen kuin tarkistat ja hyväksyt sen.
      </p>

      {uploadError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2.5 text-sm text-red-400 mb-4">
          {uploadError}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : drafts.length === 0 ? (
        <div className="text-center py-16 text-zinc-500 text-sm">
          Ei vielä ladattuja kuvia.
        </div>
      ) : (
        <div className="space-y-2">
          {drafts.map((d) => (
            <Link
              key={d.id}
              href={`/invoices/drafts/${d.id}`}
              className="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 hover:border-zinc-700 transition-colors"
            >
              <div className="min-w-0">
                <p className="text-sm text-white truncate">{d.source_file_name}</p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {new Date(d.created_at).toLocaleString('fi-FI')}
                  {d.extracted_data?.computed_total
                    ? ` · ${d.extracted_data.computed_total.toFixed(2)} ${'€'}`
                    : ''}
                </p>
              </div>
              <span
                className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_STYLE[d.status]}`}
              >
                {STATUS_LABEL[d.status]}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
