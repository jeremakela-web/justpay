import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Just.Pay',
  description: 'Laskutusalusta',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="fi">
      <body
        className={`${inter.className} bg-zinc-950 text-white antialiased`}
      >
        {children}
      </body>
    </html>
  )
}
