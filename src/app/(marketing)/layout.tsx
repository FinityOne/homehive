import Nav from '@/components/Nav'
import Footer from '@/components/Footer'
import UtmCapture from '@/components/UtmCapture'
import VisitTracker from '@/components/VisitTracker'
import GoogleOneTap from '@/components/GoogleOneTap'
import EmailGate from '@/components/EmailGate'

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <UtmCapture />
      <VisitTracker />
      <GoogleOneTap />
      <Nav />
      {children}
      <Footer />
      <EmailGate />
    </>
  )
}
