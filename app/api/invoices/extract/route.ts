import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export interface ExtractedLine {
  description: string
  quantity: number
  unit_price: number
  vat_rate: number
}

export interface ExtractResponse {
  lines: ExtractedLine[]
  error?: string
}

const ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const
type AllowedMediaType = (typeof ALLOWED_MEDIA_TYPES)[number]

function isAllowedMediaType(v: string): v is AllowedMediaType {
  return (ALLOWED_MEDIA_TYPES as readonly string[]).includes(v)
}

export async function POST(request: NextRequest): Promise<NextResponse<ExtractResponse>> {
  try {
    const { image_base64, media_type } = (await request.json()) as {
      image_base64: string
      media_type: string
    }

    if (!image_base64 || !isAllowedMediaType(media_type)) {
      return NextResponse.json({ lines: [], error: 'Virheellinen kuva tai tiedostomuoto' }, { status: 400 })
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return NextResponse.json({ lines: [], error: 'AI-poisto ei ole käytössä' }, { status: 503 })
    }

    const client = new Anthropic({ apiKey })

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type, data: image_base64 },
            },
            {
              type: 'text',
              text: `Olet laskurivien poimija. Analysoi kuva (kuitti, hinnasto, tuntilomake tai muu taloushallintodokumentti) ja tunnista laskurivit.

Palauta VAIN seuraava JSON ilman selityksiä tai muuta tekstiä:
{"lines":[{"description":"...","quantity":1,"unit_price":0.00,"vat_rate":0}]}

Säännöt:
- description: lyhyt kuvaus suomeksi tai alkuperäiskielellä (max 80 merkkiä)
- quantity: numero (esim. 2 tai 1.5), oletus 1 jos ei selvä
- unit_price: yksikköhinta ilman ALV:a, desimaalipiste (esim. 49.90)
- vat_rate: ALV-prosentti numerona (0, 10, 13.5 tai 25.5), oletus 25.5 jos ei selvä
- Jos kuvassa ei ole tunnistettavia laskurivejä, palauta: {"lines":[],"error":"tarkista rivit manuaalisesti"}
- Älä keksi tietoja — kirjaa vain mitä kuvassa selvästi näkyy`,
            },
          ],
        },
      ],
    })

    const text = message.content[0].type === 'text' ? message.content[0].text : ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return NextResponse.json({ lines: [], error: 'tarkista rivit manuaalisesti' })
    }

    const parsed = JSON.parse(jsonMatch[0]) as ExtractResponse
    return NextResponse.json({
      lines: parsed.lines ?? [],
      ...(parsed.error ? { error: parsed.error } : {}),
    })
  } catch {
    return NextResponse.json({ lines: [], error: 'tarkista rivit manuaalisesti' }, { status: 500 })
  }
}
