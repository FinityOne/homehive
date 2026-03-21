'use client'

export default function Nav() {
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@300;400;500;600&display=swap');
        .nav {
          background: #fff;
          border-bottom: 1px solid #e8e5de;
          padding: 0 32px;
          height: 60px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          position: sticky;
          top: 0;
          z-index: 100;
          font-family: 'DM Sans', sans-serif;
        }
        .nav-logo { font-family: 'DM Serif Display', serif; font-size: 20px; color: #1a1a1a; text-decoration: none; }
        .nav-logo span { color: #d4a843; }
        .nav-links { display: flex; align-items: center; gap: 28px; }
        .nav-link { font-size: 13px; color: #6b6b6b; text-decoration: none; }
        .nav-link:hover { color: #1a1a1a; }
        .nav-cta {
          background: #1a1a1a; color: #fff; font-size: 13px; font-weight: 500;
          padding: 8px 18px; border-radius: 6px; border: none; cursor: pointer;
          font-family: 'DM Sans', sans-serif; text-decoration: none;
        }
        .nav-cta:hover { background: #333; }
      `}</style>
      <nav className="nav">
        <a href="/" className="nav-logo">Home<span>Hive</span></a>
        <div className="nav-links">
          <a href="/" className="nav-link">Our Homes</a>
          <a href="#how-it-works" className="nav-link">How it works</a>
          <a href="/roommates" className="nav-link">Find roommates</a>
          <a href="/#homes" className="nav-cta">View available homes</a>
        </div>
      </nav>
    </>
  )
}