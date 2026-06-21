import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'

export interface AddonSuggestion {
  provider_name: string
  category: 'insurance' | 'collection' | 'financing'
  reasoning: string
  url: string
}

interface AddonService {
  provider_name: string
  category: string
  url: string
  pricing_notes: string | null
  eligibility_notes: string | null
}

export async function POST(request: NextRequest) {
  try {
    const { total_amount, due_date, customer_type } = (await request.json()) as {
      total_amount: number
      due_date: string
      customer_type: 'company' | 'individual'
    }

    const supabase = await createClient()
    const { data: services, error } = await supabase
      .from('jp_addon_services')
      .select('provider_name, category, url, pricing_notes, eligibility_notes')
      .eq('active', true)

    if (error) throw error
    if (!services || services.length === 0) {
      return NextResponse.json({ recommendations: [] })
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return NextResponse.json(
        { recommendations: [], error: 'AI-suositukset eivät ole käytössä' },
        { status: 503 }
      )
    }

    const client = new Anthropic({ apiKey })

    const serviceList = (services as AddonService[])
      .map(
        (s) =>
          `- ${s.provider_name} [${s.category}]: hinnoittelu: ${s.pricing_notes ?? '—'} | soveltuvuus: ${s.eligibility_notes ?? '—'} | url: ${s.url}`
      )
      .join('\n')

    const prompt = `Olet Just.Pay-laskutusalustan AI-assistentti. Analysoi lasku ja suosittele sopivia lisäpalveluita.

Laskun tiedot:
- Summa: ${total_amount} EUR
- Eräpäivä: ${due_date}
- Asiakastyyppi: ${customer_type === 'company' ? 'yritys' : 'kuluttaja'}

Saatavilla olevat lisäpalvelut:
${serviceList}

Valitse enintään 3 sopivinta palvelua tähän laskuun soveltuvuuden ja laskun tietojen perusteella.
Perustele jokainen suositus lyhyesti suomeksi (1–2 lausetta).

Vastaa AINOASTAAN seuraavassa JSON-muodossa ilman lisätekstejä:
{"recommendations":[{"provider_name":"...","category":"...","reasoning":"...","url":"..."}]}`

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = message.content[0].type === 'text' ? message.content[0].text : ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('Virheellinen AI-vastaus')

    const parsed = JSON.parse(jsonMatch[0]) as { recommendations: AddonSuggestion[] }
    return NextResponse.json(parsed)
  } catch {
    return NextResponse.json(
      { recommendations: [], error: 'Suositusten haku epäonnistui' },
      { status: 500 }
    )
  }
}
