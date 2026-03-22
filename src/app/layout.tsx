import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'HomeHive — ASU Student Housing in Tempe',
  description: 'Find your perfect home and roommates near ASU. No broker fees, transparent pricing, flexible move-in.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#f5f4f0' }}>
        {children}
      </body>
    </html>
  )
}