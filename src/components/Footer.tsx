export default function Footer() {
  return (
    <>
      <style>{`
        .footer {
          background: #1a1a1a;
          color: #9b9b9b;
          padding: 40px 32px 24px;
          font-family: 'DM Sans', sans-serif;
          margin-top: 80px;
        }
        .footer-inner {
          max-width: 1100px;
          margin: 0 auto;
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 32px;
          margin-bottom: 32px;
        }
        .footer-logo { font-family: 'DM Serif Display', serif; font-size: 22px; color: #fff; margin-bottom: 8px; }
        .footer-logo span { color: #d4a843; }
        .footer-tagline { font-size: 13px; line-height: 1.6; color: #6b6b6b; }
        .footer-heading { font-size: 11px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; color: #d4a843; margin-bottom: 12px; }
        .footer-link { display: block; font-size: 13px; color: #9b9b9b; text-decoration: none; margin-bottom: 8px; }
        .footer-link:hover { color: #fff; }
        .footer-bottom { border-top: 1px solid #2a2a2a; padding-top: 20px; text-align: center; font-size: 12px; color: #4a4a4a; }
      `}</style>
      <footer className="footer">
        <div className="footer-inner">
          <div>
            <div className="footer-logo">Home<span>Hive</span></div>
            <p className="footer-tagline">Connecting ASU students with great homes and compatible roommates in Tempe.</p>
          </div>
          <div>
            <div className="footer-heading">Homes</div>
            <a href="/homes/mill-ave-residence" className="footer-link">The Mill Ave Residence</a>
            <a href="/homes/apache-house" className="footer-link">The Apache House</a>
          </div>
          <div>
            <div className="footer-heading">Contact</div>
            <a href="mailto:hello@homehive.co" className="footer-link">hello@homehive.co</a>
            <a href="#find-roommates" className="footer-link">Find roommates</a>
          </div>
        </div>
        <div className="footer-bottom">
          © 2025 HomeHive · Tempe, AZ · Built for Sun Devils
        </div>
      </footer>
    </>
  )
}