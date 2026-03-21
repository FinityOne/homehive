import type { Metadata } from 'next'
import './globals.css'
import Nav from '@/components/Nav'
import Footer from '@/components/Footer'

export const metadata: Metadata = {
  title: 'HomeHive — ASU Student Housing in Tempe',
  description: 'Find your perfect home and roommates near ASU. No broker fees, transparent pricing, flexible move-in.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#f5f4f0' }}>
        <Nav />
        {children}
        <Footer />
      </body>
    </html>
  )
}