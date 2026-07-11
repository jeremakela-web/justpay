import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createClient } from '@/lib/supabase/server'
import type { Invoice, InvoiceLine, Customer, Organization } from '@/types/database'

function formatDate(s: string) {
  return new Date(s).toLocaleDateString('fi-FI')
}

function formatCurrency(n: number, currency = 'EUR') {
  return new Intl.NumberFormat('fi-FI', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(n)
}

function formatRef(ref: string) {
  return ref.replace(/(.{1,5})(?=(.{5})+$)/g, '$1 ').trim()
}

function generateEmailHtml(
  invoice: Invoice,
  lines: InvoiceLine[],
  customer: Customer,
  org: Organization | null
): string {
  const vatGroups = lines.reduce<Record<number, number>>((acc, l) => {
    if (l.vat_rate > 0) acc[l.vat_rate] = (acc[l.vat_rate] || 0) + l.vat_amount
    return acc
  }, {})

  const lineRows = lines
    .map(
      (l) => `
      <tr>
        <td style="padding:10px 8px;border-bottom:1px solid #f1f5f9;color:#1e293b">${l.description}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #f1f5f9;text-align:right;color:#475569">${new Intl.NumberFormat('fi-FI').format(l.quantity)}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #f1f5f9;text-align:right;color:#475569">${formatCurrency(l.unit_price, invoice.currency)}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #f1f5f9;text-align:right;color:#64748b">${l.vat_rate}%</td>
        <td style="padding:10px 8px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:600;color:#1e293b">${formatCurrency(l.line_total, invoice.currency)}</td>
      </tr>`
    )
    .join('')

  const vatRows = Object.entries(vatGroups)
    .map(
      ([rate, amount]) => `
      <tr>
        <td style="padding:4px 0;color:#64748b;font-size:14px">ALV ${rate}%</td>
        <td style="padding:4px 0;text-align:right;color:#64748b;font-size:14px">${formatCurrency(Number(amount), invoice.currency)}</td>
      </tr>`
    )
    .join('')

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
                  ${org ? `<div style="margin-top:8px;font-size:14px;color:#cbd5e1">
                    <div style="font-weight:600;color:#fff">${org.name}</div>
                    ${org.business_id ? `<div>Y-tunnus: ${org.business_id}</div>` : ''}
                  </div>` : ''}
                </td>
                <td style="text-align:right">
                  <div style="font-size:28px;font-weight:800;color:#4ade80">LASKU</div>
                  <div style="margin-top:6px;font-size:13px;color:#94a3b8">
                    <div>Numero: <span style="color:#fff;font-weight:600">${invoice.invoice_number}</span></div>
                    <div>Laskupäivä: <span style="color:#e2e8f0">${formatDate(invoice.issue_date)}</span></div>
                    <div>Eräpäivä: <span style="color:#fde047;font-weight:600">${formatDate(invoice.due_date)}</span></div>
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Recipient -->
        <tr>
          <td style="background:#f1f5f9;padding:20px 32px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0">
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#94a3b8;margin-bottom:6px">Laskutetaan</div>
            <div style="font-size:16px;font-weight:700;color:#1e293b">${customer.name}</div>
            ${customer.business_id ? `<div style="font-size:14px;color:#64748b">Y-tunnus: ${customer.business_id}</div>` : ''}
            ${customer.address ? `<div style="font-size:14px;color:#64748b">${customer.address}</div>` : ''}
            ${customer.postal_code || customer.city ? `<div style="font-size:14px;color:#64748b">${customer.postal_code ?? ''} ${customer.city ?? ''}</div>` : ''}
          </td>
        </tr>

        <!-- Line items -->
        <tr>
          <td style="background:#fff;padding:24px 32px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0">
            <table width="100%" cellpadding="0" cellspacing="0">
              <thead>
                <tr style="border-bottom:2px solid #e2e8f0">
                  <th style="padding:0 8px 10px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#94a3b8">Kuvaus</th>
                  <th style="padding:0 8px 10px;text-align:right;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#94a3b8;width:60px">Määrä</th>
                  <th style="padding:0 8px 10px;text-align:right;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#94a3b8;width:90px">Á-hinta</th>
                  <th style="padding:0 8px 10px;text-align:right;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#94a3b8;width:50px">ALV%</th>
                  <th style="padding:0 8px 10px;text-align:right;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#94a3b8;width:100px">Yhteensä</th>
                </tr>
              </thead>
              <tbody>${lineRows}</tbody>
            </table>

            <!-- Totals -->
            <table style="margin-left:auto;margin-top:16px;min-width:220px" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding:4px 0;color:#64748b;font-size:14px">Veroton yhteensä</td>
                <td style="padding:4px 0;text-align:right;color:#64748b;font-size:14px">${formatCurrency(invoice.subtotal, invoice.currency)}</td>
              </tr>
              ${vatRows}
              <tr>
                <td colspan="2" style="padding-top:8px"><hr style="border:none;border-top:2px solid #e2e8f0;margin:0"></td>
              </tr>
              <tr>
                <td style="padding:8px 0 0;font-size:18px;font-weight:700;color:#1e293b">Yhteensä</td>
                <td style="padding:8px 0 0;text-align:right;font-size:18px;font-weight:700;color:#1e293b">${formatCurrency(invoice.total_amount, invoice.currency)}</td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Payment info -->
        <tr>
          <td style="background:#f8fafc;padding:20px 32px;border:1px solid #e2e8f0;border-top:none">
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#94a3b8;margin-bottom:10px">Maksutiedot</div>
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="font-size:14px;color:#94a3b8;padding-right:16px;padding-bottom:4px">Viitenumero</td>
                <td style="font-size:14px;font-family:monospace;font-weight:700;color:#1e293b;padding-bottom:4px">${formatRef(invoice.reference_number)}</td>
              </tr>
              <tr>
                <td style="font-size:14px;color:#94a3b8;padding-right:16px;padding-bottom:4px">Eräpäivä</td>
                <td style="font-size:14px;font-weight:600;color:#1e293b;padding-bottom:4px">${formatDate(invoice.due_date)}</td>
              </tr>
              <tr>
                <td style="font-size:14px;color:#94a3b8;padding-right:16px">Maksettava summa</td>
                <td style="font-size:16px;font-weight:700;color:#1e293b">${formatCurrency(invoice.total_amount, invoice.currency)}</td>
              </tr>
            </table>
            ${invoice.notes ? `<div style="margin-top:16px;font-size:13px;color:#64748b;white-space:pre-line">${invoice.notes}</div>` : ''}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#0f172a;border-radius:0 0 12px 12px;padding:14px 32px;text-align:center">
            <div style="font-size:12px;color:#64748b">Laskutettu Just.Pay-palvelulla</div>
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
    if (!user) return NextResponse.json({ error: 'Ei oikeuksia' }, { status: 401 })

    const [{ data: invoice }, { data: org }] = await Promise.all([
      supabase.from('jp_invoices').select('*').eq('id', id).maybeSingle(),
      supabase
        .from('jp_organizations')
        .select('*')
        .eq('owner_user_id', user.id)
        .maybeSingle(),
    ])

    if (!invoice) return NextResponse.json({ error: 'Laskua ei löydy' }, { status: 404 })

    const [{ data: lines }, { data: customer }] = await Promise.all([
      supabase
        .from('jp_invoice_lines')
        .select('*')
        .eq('invoice_id', id)
        .order('sort_order'),
      supabase.from('jp_customers').select('*').eq('id', invoice.customer_id).maybeSingle(),
    ])

    if (!customer?.email) {
      return NextResponse.json(
        { error: 'Asiakkaalla ei ole sähköpostiosoitetta' },
        { status: 400 }
      )
    }

    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Sähköpostilähetys ei ole käytössä' },
        { status: 503 }
      )
    }

    const resend = new Resend(apiKey)
    const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'
    const fromName = org?.name || 'Just.Pay'

    const html = generateEmailHtml(
      invoice as Invoice,
      (lines as InvoiceLine[]) || [],
      customer as Customer,
      org as Organization | null
    )

    const { error: sendErr } = await resend.emails.send({
      from: `${fromName} <${fromEmail}>`,
      to: customer.email,
      subject: `Lasku ${invoice.invoice_number} – ${new Intl.NumberFormat('fi-FI', { style: 'currency', currency: invoice.currency }).format(invoice.total_amount)}`,
      html,
    })

    if (sendErr) throw sendErr

    await supabase.from('jp_invoices').update({ status: 'sent' }).eq('id', id)

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Lähetys epäonnistui' }, { status: 500 })
  }
}
