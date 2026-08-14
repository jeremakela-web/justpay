import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createClient } from '@/lib/supabase/server'
import type { ServiceFeeDocument, Organization, Invoice } from '@/types/database'
import { KANSALLISVARANTO } from '@/lib/kansallisvaranto'
import { formatDate, formatCurrency } from '@/lib/utils/invoice-format'

function generateServiceFeeEmailHtml(
  doc: ServiceFeeDocument,
  org: Organization | null,
  sourceInvoice: Invoice | null
): string {
  const invoiceRef = sourceInvoice ? sourceInvoice.invoice_number : doc.source_invoice_id

  return `<!DOCTYPE html>
<html lang="fi">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px">
    <tr><td>
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto">

        <!-- Header -->
        <tr>
          <td style="background:#0f172a;border-radius:12px 12px 0 0;padding:28px 32px">
            <table width="100%">
              <tr>
                <td>
                  <div style="font-size:22px;font-weight:700;color:#fff">Just<span style="color:#4ade80">.</span>Pay</div>
                  <div style="margin-top:8px;font-size:14px;color:#cbd5e1">
                    <div style="font-weight:600;color:#fff">${KANSALLISVARANTO.name}</div>
                    <div>Y-tunnus: ${KANSALLISVARANTO.businessId}</div>
                    <div>${KANSALLISVARANTO.address}</div>
                  </div>
                </td>
                <td style="text-align:right">
                  <div style="font-size:24px;font-weight:800;color:#4ade80">PALVELUMAKSUKUITTI</div>
                  <div style="margin-top:6px;font-size:13px;color:#94a3b8">
                    <div>Numero: <span style="color:#fff;font-weight:600">${doc.document_number}</span></div>
                    <div>Päivämäärä: <span style="color:#e2e8f0">${formatDate(doc.issue_date)}</span></div>
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Recipient -->
        <tr>
          <td style="background:#f1f5f9;padding:20px 32px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0">
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#94a3b8;margin-bottom:6px">Vastaanottaja</div>
            <div style="font-size:16px;font-weight:700;color:#1e293b">${org?.name ?? ''}</div>
            ${org?.business_id ? `<div style="font-size:14px;color:#64748b">Y-tunnus: ${org.business_id}</div>` : ''}
          </td>
        </tr>

        <!-- Reference + line item -->
        <tr>
          <td style="background:#fff;padding:24px 32px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0">
            <p style="font-size:14px;color:#475569;margin:0 0 16px">Viittaus laskuun: <strong style="color:#1e293b">${invoiceRef}</strong></p>
            <table width="100%" cellpadding="0" cellspacing="0">
              <thead>
                <tr style="border-bottom:2px solid #e2e8f0">
                  <th style="padding:0 8px 10px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#94a3b8">Kuvaus</th>
                  <th style="padding:0 8px 10px;text-align:right;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#94a3b8;width:50px">ALV%</th>
                  <th style="padding:0 8px 10px;text-align:right;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#94a3b8;width:100px">Summa</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style="padding:10px 8px;border-bottom:1px solid #f1f5f9;color:#1e293b">Laskutuspalvelun palkkio — lasku ${invoiceRef}</td>
                  <td style="padding:10px 8px;border-bottom:1px solid #f1f5f9;text-align:right;color:#64748b">${doc.fee_vat_rate}%</td>
                  <td style="padding:10px 8px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:600;color:#1e293b">${formatCurrency(doc.fee_amount, doc.currency)}</td>
                </tr>
              </tbody>
            </table>

            <table style="margin-left:auto;margin-top:16px;min-width:220px" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding:4px 0;color:#64748b;font-size:14px">Veroton yhteensä</td>
                <td style="padding:4px 0;text-align:right;color:#64748b;font-size:14px">${formatCurrency(doc.fee_amount, doc.currency)}</td>
              </tr>
              <tr>
                <td style="padding:4px 0;color:#64748b;font-size:14px">ALV ${doc.fee_vat_rate}%</td>
                <td style="padding:4px 0;text-align:right;color:#64748b;font-size:14px">${formatCurrency(doc.fee_vat_amount, doc.currency)}</td>
              </tr>
              <tr>
                <td colspan="2" style="padding-top:8px"><hr style="border:none;border-top:2px solid #e2e8f0;margin:0"></td>
              </tr>
              <tr>
                <td style="padding:8px 0 0;font-size:18px;font-weight:700;color:#1e293b">Yhteensä</td>
                <td style="padding:8px 0 0;text-align:right;font-size:18px;font-weight:700;color:#1e293b">${formatCurrency(doc.total_amount, doc.currency)}</td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Note -->
        <tr>
          <td style="background:#f8fafc;padding:20px 32px;border:1px solid #e2e8f0;border-top:none">
            <p style="margin:0;font-size:13px;color:#64748b">
              Tämä kuitti koskee Kansallisvaranto Oy:n perimää laskutuspalvelun palkkiota
              laskusta ${invoiceRef}, ei itse suoritettua työtä. Säilytä tämä kuitti
              kirjanpitoasi/verotustasi varten.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#0f172a;border-radius:0 0 12px 12px;padding:14px 32px;text-align:center">
            <div style="font-size:12px;color:#64748b">Kansallisvaranto Oy · just.pay</div>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user || !user.email) {
      return NextResponse.json({ error: 'Ei oikeuksia' }, { status: 401 })
    }

    const { data: doc } = await supabase
      .from('jp_service_fee_documents')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (!doc) return NextResponse.json({ error: 'Kuittia ei löydy' }, { status: 404 })

    const [{ data: org }, { data: sourceInvoice }] = await Promise.all([
      supabase.from('jp_organizations').select('*').eq('id', doc.org_id).maybeSingle(),
      supabase.from('jp_invoices').select('*').eq('id', doc.source_invoice_id).maybeSingle(),
    ])

    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            'Sähköpostilähetys ei ole käytössä palvelimella juuri nyt. Voit tulostaa/ladata kuitin PDF:nä, tai yrittää myöhemmin uudelleen.',
        },
        { status: 503 }
      )
    }

    const resend = new Resend(apiKey)
    const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'

    const html = generateServiceFeeEmailHtml(
      doc as ServiceFeeDocument,
      (org as Organization) || null,
      (sourceInvoice as Invoice) || null
    )

    const { error: sendErr } = await resend.emails.send({
      from: `${KANSALLISVARANTO.name} <${fromEmail}>`,
      to: user.email,
      subject: `Palvelumaksukuitti ${doc.document_number} – ${new Intl.NumberFormat('fi-FI', { style: 'currency', currency: doc.currency }).format(doc.total_amount)}`,
      html,
    })

    if (sendErr) throw sendErr

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Lähetys epäonnistui' }, { status: 500 })
  }
}
