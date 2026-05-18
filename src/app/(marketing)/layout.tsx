import Nav from '@/components/Nav'
import Footer from '@/components/Footer'
import UtmCapture from '@/components/UtmCapture'

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <UtmCapture />
      <Nav />
      {children}
      <Footer />
    </>
  )
}
